/* global loadPyodide, importScripts */
/**
 * The Python sandbox for the capstone project.
 *
 * Runs in a dedicated Web Worker, so learner code is isolated from the page by
 * the browser itself: it cannot reach the DOM, the page's storage, the tutor's
 * conversation or any key (keys live on the server and never reach the
 * browser). After Python and its packages are loaded, the worker's network
 * access is removed, so code cannot fetch anything either.
 *
 * The page enforces time limits and "stop" by terminating the worker — a
 * runaway loop cannot freeze the lesson — and starts a fresh one on the next
 * run.
 *
 * Messages in:  { type: 'init', moduleUrl }
 *               { type: 'run', runId, code, files: [{ path, text }], maxOutput }
 * Messages out: { type: 'progress', text }
 *               { type: 'ready', versions }
 *               { type: 'result', runId, status: 'ok' | 'error', stdout, error, report, durationMs }
 *               { type: 'fatal', error }
 */

const PYODIDE_VERSION = '0.27.7'
const CDN_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
/** A copy vendored by `npm run pyodide`, served by this site: no CDN needed in class. */
const LOCAL_URL = new URL(`/pyodide/v${PYODIDE_VERSION}/`, self.location.href).href
const HOME = '/home/pyodide'

let pyodide = null
let versions = null
const realFetch = self.fetch.bind(self)

const post = (m) => self.postMessage(m)

function cutNetwork() {
  const blocked = () => Promise.reject(new Error('运行环境不允许联网'))
  try { self.fetch = blocked } catch { /* ignore */ }
  try { Object.defineProperty(self.constructor.prototype, 'fetch', { value: blocked, configurable: true }) } catch { /* ignore */ }
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'indexedDB', 'caches', 'importScripts']) {
    try { Object.defineProperty(self, name, { value: undefined, configurable: true }) } catch { /* ignore */ }
  }
}

/** The local copy when it is complete, otherwise the CDN. */
async function pickIndex() {
  try {
    const res = await realFetch(`${LOCAL_URL}VENDORED.json`, { cache: 'no-store' })
    if (res.ok) return { url: LOCAL_URL, source: 'local' }
  } catch { /* not vendored */ }
  return { url: CDN_URL, source: 'cdn' }
}

async function init({ moduleUrl }) {
  const index = await pickIndex()
  post({ type: 'progress', text: index.source === 'local' ? '正在加载本站提供的 Python 运行环境…' : '正在从 CDN 下载 Python 运行环境（第一次大约需要半分钟）…' })
  importScripts(`${index.url}pyodide.js`)
  pyodide = await loadPyodide({ indexURL: index.url })
  post({ type: 'progress', text: '正在加载 numpy、pandas、scikit-learn…' })
  await pyodide.loadPackage(['numpy', 'pandas', 'scikit-learn'])
  const src = await (await realFetch(moduleUrl)).text()
  pyodide.FS.mkdirTree(`${HOME}/data`)
  pyodide.FS.writeFile(`${HOME}/learnai.py`, src)
  pyodide.runPython(`
import sys, os
sys.path.insert(0, "${HOME}")
os.chdir("${HOME}")
import learnai
`)
  versions = JSON.parse(pyodide.runPython(`
import json, sys, sklearn, pandas, numpy
json.dumps({"python": sys.version.split()[0], "sklearn": sklearn.__version__, "pandas": pandas.__version__, "numpy": numpy.__version__})
`))
  versions.pyodide = PYODIDE_VERSION
  versions.source = index.source
  cutNetwork()
  post({ type: 'ready', versions })
}

/** "Traceback … File "project.py", line 12 … ValueError: …" → the parts a learner needs. */
function parseError(message) {
  const text = String(message ?? '')
  const lines = text.trim().split('\n')
  const last = lines.at(-1) ?? text
  const m = last.match(/^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Exit|Interrupt)?):\s?(.*)$/)
  let line = null
  for (const l of lines) {
    const hit = l.match(/File "(?:project\.py|<exec>)", line (\d+)/)
    if (hit) line = Number(hit[1])
  }
  // Keep only the learner's own frames and the error itself.
  const trace = lines.filter((l, i) => i === 0 || /project\.py|<exec>/.test(l) || i >= lines.length - 1 || (i > 0 && /project\.py|<exec>/.test(lines[i - 1] ?? '')))
  return {
    type: m ? m[1] : 'Error',
    message: m ? m[2] : last,
    line,
    traceback: trace.join('\n').slice(-4000),
  }
}

async function run({ runId, code, files, maxOutput = 20000 }) {
  const chunks = []
  let size = 0
  let truncated = false
  const write = (s) => {
    if (size >= maxOutput) { truncated = true; return }
    chunks.push(s)
    size += s.length
  }
  pyodide.setStdout({ batched: (s) => write(`${s}\n`) })
  pyodide.setStderr({ batched: (s) => write(`${s}\n`) })

  // Only this task's data is present: a variant run cannot read the main
  // project's file, and nothing is left over from an earlier run.
  for (const name of pyodide.FS.readdir(`${HOME}/data`)) {
    if (name !== '.' && name !== '..') pyodide.FS.unlink(`${HOME}/data/${name}`)
  }
  for (const f of files ?? []) pyodide.FS.writeFile(`${HOME}/${f.path}`, f.text)
  pyodide.runPython('import os, learnai\nos.chdir("/home/pyodide")\nlearnai._reset()')

  const ns = pyodide.globals.get('dict')()
  const t0 = performance.now()
  let status = 'ok'
  let error = null
  try {
    await pyodide.runPythonAsync(code, { globals: ns, filename: 'project.py' })
  } catch (err) {
    status = 'error'
    error = parseError(err?.message)
  }
  const durationMs = Math.round(performance.now() - t0)
  let report = { splits: [], records: [], reads: [] }
  try { report = JSON.parse(pyodide.runPython('learnai._report()')) } catch { /* keep the empty report */ }
  try { ns.destroy() } catch { /* ignore */ }
  if (truncated) chunks.push('\n…（输出太长，后面的省略了）\n')
  post({ type: 'result', runId, status, stdout: chunks.join(''), error, report, durationMs })
}

self.onmessage = async (e) => {
  const msg = e.data ?? {}
  try {
    if (msg.type === 'init') await init(msg)
    else if (msg.type === 'run') {
      if (!pyodide) throw new Error('运行环境还没有准备好')
      await run(msg)
    }
  } catch (err) {
    post({ type: msg.type === 'run' ? 'result' : 'fatal', runId: msg.runId, status: 'error', error: { type: 'RuntimeError', message: String(err?.message ?? err), line: null, traceback: '' }, report: { splits: [], records: [], reads: [] }, stdout: '' })
  }
}
