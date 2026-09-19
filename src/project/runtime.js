/**
 * The page's side of the Python sandbox (see public/pyworker.js).
 *
 * One worker at a time. A run is always settled with one of five states —
 * ok, error, timeout, cancelled, unavailable — so the page never waits without
 * saying why. Timeout and stop terminate the worker; the next run starts a
 * fresh one. A crash in the worker only fails that run; the page keeps going.
 */

/** `?runTimeout=3` (seconds) shortens the per-run limit, for testing the timeout path. */
function runTimeoutOverride() {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('runTimeout'))
    return v > 0 ? v * 1000 : null
  } catch {
    return null
  }
}

export const RUNTIME_LIMITS = Object.freeze({
  version: 'runtime-2026.09-1',
  /** Per-run wall clock. Provisional: to be set from measurements during the pilot. */
  runTimeoutMs: runTimeoutOverride() ?? 30000,
  /** Loading Python and scikit-learn the first time can take a while on a slow link. */
  initTimeoutMs: 240000,
  maxOutputChars: 20000,
  note: '运行时间与内存上限为初始设置，将在试点的运行环境验证中测量后确定。内存受浏览器 WebAssembly 限制。',
})

const WORKER_URL = '/pyworker.js'
const MODULE_URL = '/pyruntime/learnai.py'

class PyRuntime {
  constructor() {
    this.worker = null
    this.state = { status: 'idle', text: '运行环境还没有加载', versions: null, error: null }
    this.listeners = new Set()
    this.ready = null
    this.pending = null
  }

  subscribe(fn) {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  set(patch) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn(this.state)
  }

  /** Start the worker and load Python, once. Resolves with the versions. */
  ensure() {
    if (this.ready) return this.ready
    this.set({ status: 'loading', text: '正在启动 Python 运行环境…', error: null })
    const worker = new Worker(WORKER_URL)
    this.worker = worker
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.kill()
        this.set({ status: 'failed', text: '运行环境加载超时', error: '加载超时，检查网络后重试' })
        reject(new Error('运行环境加载超时'))
      }, RUNTIME_LIMITS.initTimeoutMs)
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress') this.set({ text: m.text })
        else if (m.type === 'ready') {
          clearTimeout(timer)
          this.set({ status: 'ready', text: '运行环境就绪', versions: m.versions })
          resolve(m.versions)
        } else if (m.type === 'fatal') {
          clearTimeout(timer)
          this.kill()
          this.set({ status: 'failed', text: '运行环境加载失败', error: m.error?.message ?? '未知错误' })
          reject(new Error(m.error?.message ?? '运行环境加载失败'))
        } else if (m.type === 'result') this.settle(m)
      }
      worker.onerror = (e) => {
        clearTimeout(timer)
        const msg = e.message || '运行环境崩溃了'
        this.kill()
        this.set({ status: 'failed', text: '运行环境出错', error: msg })
        if (this.pending) this.settle({ runId: this.pending.runId, status: 'error', error: { type: 'RuntimeError', message: msg, line: null, traceback: '' }, stdout: '', report: null })
        reject(new Error(msg))
      }
      worker.postMessage({ type: 'init', moduleUrl: MODULE_URL })
    })
    this.ready.catch(() => {})
    return this.ready
  }

  kill() {
    try { this.worker?.terminate() } catch { /* already gone */ }
    this.worker = null
    this.ready = null
  }

  settle(m) {
    const p = this.pending
    if (!p || p.runId !== m.runId) return
    this.pending = null
    clearTimeout(p.timer)
    if (this.state.status === 'running') this.set({ status: 'ready', text: '运行环境就绪' })
    p.resolve(m)
  }

  /**
   * Run code with the task's files. Always resolves:
   * { status, stdout, error, report, durationMs, versions }.
   */
  async run({ runId, code, files, timeoutMs = RUNTIME_LIMITS.runTimeoutMs }) {
    if (this.pending) this.stop()
    let versions
    try {
      versions = await this.ensure()
    } catch (err) {
      return { runId, status: 'unavailable', stdout: '', error: { type: 'RuntimeUnavailable', message: err.message, line: null, traceback: '' }, report: null, durationMs: 0 }
    }
    this.set({ status: 'running', text: '正在运行…' })
    const started = performance.now()
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null
        this.kill()
        this.set({ status: 'idle', text: `运行超过 ${Math.round(timeoutMs / 1000)} 秒，已停止；下次运行会重新启动环境` })
        resolve({ runId, status: 'timeout', stdout: '', error: { type: 'Timeout', message: `运行超过 ${Math.round(timeoutMs / 1000)} 秒上限，已经停止`, line: null, traceback: '' }, report: null })
      }, timeoutMs)
      this.pending = { runId, resolve, timer }
      this.worker.postMessage({ type: 'run', runId, code, files, maxOutput: RUNTIME_LIMITS.maxOutputChars })
    })
    return { ...outcome, durationMs: outcome.durationMs ?? Math.round(performance.now() - started), versions }
  }

  /** Stop the run in flight. The worker is discarded; the next run starts a new one. */
  stop() {
    const p = this.pending
    if (!p) return
    this.pending = null
    clearTimeout(p.timer)
    this.kill()
    this.set({ status: 'idle', text: '已停止；下次运行会重新启动环境' })
    p.resolve({ runId: p.runId, status: 'cancelled', stdout: '', error: { type: 'Cancelled', message: '你停止了这次运行', line: null, traceback: '' }, report: null })
  }
}

export const runtime = new PyRuntime()
