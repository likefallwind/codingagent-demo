/**
 * Shared pieces of the browser tests: a server to test against, and helpers
 * that drive the page the way a learner does.
 *
 * By default the server runs with LEARNAI_FAKE_LLM=1 — a deterministic stand-in
 * for the model — so every path runs without a key and in minutes.
 * E2E_REAL_LLM=1 uses the real model instead (needs MINIMAX_API_KEY), which is
 * what the grading-quality and figure checks are really for.
 * BASE_URL=… tests an already running app; SKIP_BUILD=1 reuses dist/.
 */

import { spawn, execSync } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { courseList } from '../src/courses/index.js'
import { resolvePractice, generateVerifyItem } from '../src/labs/practice.js'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const course = courseList.find((c) => c.id === 'decision-tree')
export const REAL = process.env.E2E_REAL_LLM === '1'
export const STORE_KEY = `learnai:v2:${course.id}`

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export async function startServer() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, stop: () => {} }
  if (process.env.SKIP_BUILD !== '1') execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' })
  const port = await freePort()
  const env = { ...process.env, PORT: String(port) }
  // A short model deadline, so the timeout path can be tested in seconds.
  if (!REAL) Object.assign(env, { LEARNAI_FAKE_LLM: '1', LEARNAI_FAKE_DELAY_MS: env.LEARNAI_FAKE_DELAY_MS ?? '120', LEARNAI_MODEL_DEADLINE_MS: env.LEARNAI_MODEL_DEADLINE_MS ?? '6000' })
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: 'ignore' })
  const base = `http://localhost:${port}`
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/health`)
      if (r.ok) {
        const h = await r.json()
        if (REAL && !h.hasKey) { proc.kill(); throw new Error('E2E_REAL_LLM=1 needs MINIMAX_API_KEY') }
        return { base, stop: () => proc.kill() }
      }
    } catch (e) {
      if (e.message.includes('MINIMAX')) throw e
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  proc.kill()
  throw new Error('server did not start')
}

/** A new page with console errors collected. */
export async function newPage(browser, base, { path = '/', viewport = { width: 1440, height: 950 }, seed } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true })
  if (seed) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v) }, seed)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  const requests = []
  page.on('request', (r) => {
    if (!r.url().includes('/api/')) return
    try { requests.push({ path: new URL(r.url()).pathname, body: JSON.parse(r.postData() ?? '{}'), at: Date.now() }) } catch { /* ignore */ }
  })
  await page.goto(`${base}${path}`)
  await page.waitForSelector('[data-testid="save-state"]')
  return { page, ctx, errors, requests }
}

export const card = (page, title) => page.locator('.panel', { hasText: title }).first()

/** Move a range input the way a drag does: React listens for native input events. */
export async function setRange(page, label, value) {
  await page.locator(`input[type=range][aria-label="${label}"]`).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await page.waitForTimeout(60)
}

/** The learner record as saved — after any pending debounced write has landed. */
export async function readStore(page) {
  await page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.dataset.status !== 'saving', null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(80)
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), STORE_KEY)
}

/** Wait until nothing in the tutor panel is still being written. */
export async function tutorSettled(page, timeout = 90000) {
  await page.waitForTimeout(200)
  await page.waitForFunction(() => !document.querySelector('[data-streaming="1"]'), null, { timeout })
}

export const statusOf = (page, id) => page.getAttribute(`[data-concept="${id}"]`, 'data-status')

export async function tutorMessages(page) {
  return page.$$eval('[data-tag]', (els) => els.map((e) => ({ tag: e.dataset.tag, text: e.innerText, context: e.dataset.context })))
}

export function questionFor(concept, id) {
  return concept.checks.find((c) => c.id === id) ?? resolvePractice(concept, id)
}

/** The questions of the open verification, rebuilt from the seeds stored on its attempt. */
export async function openVerifyItems(page, concept) {
  const store = await readStore(page)
  const a = Object.values(store.attempts).find((x) => x.conceptId === concept.id && x.activity === 'verify' && x.status === 'open')
  if (!a) return null
  return { attempt: a, items: a.items.map((it) => ({ ...it, q: generateVerifyItem(concept, it.index, it.seed) })) }
}

/** Written answers: what a right and a wrong learner would write. */
export const ANSWERS = {
  'rt-2': {
    good: '继续分确实能让训练集全对，但那一刀只是为了照顾那 1 个苹果，学到的是这批数据的偶然性而不是规律，会过拟合，到新数据上泛化反而变差。',
    bad: '叶子必须是纯的才算建好，混着的叶子说明树还没建完，应该继续往下分。',
  },
  'pu-3': {
    good: '不能删。果香在根节点上增益低，但特征的价值取决于它作用在哪批样本上：果皮切开之后，右边那 9 个样本里「无果香」一刀就能分干净，算法建树时会在子节点选它。',
    bad: '可以删，它的增益最低，说明这个特征没用。',
  },
  'gr-1': {
    good: '不能完全补回来。第一刀决定了两个子问题各自面对哪些样本，后面只能在这个划分内部做局部优化，贪心算法也从不回头修改第一刀。',
    bad: '能补回来，后面每一步都选最好的，最后整棵树还是最优的。',
  },
  'dc-2': {
    good: '训练误差会继续下降，从 6.3% 降到 2.9%；验证误差反而会上升，从 10.0% 升到 13.3%。',
    bad: '两个都会下降，树越深越准。',
  },
  'of-2': {
    good: '不能这么下结论。验证集只有 60 个样本，一个样本就是 1.67 个百分点，这点差异在噪声范围内，应该看整体趋势，或者用交叉验证。',
    bad: '是的，depth 2 的验证误差更低，所以 depth 2 更好。',
  },
  'pr-2': {
    good: '剪过头会欠拟合：模型容量不足以表达真实规律。比如 min_samples_leaf 调到 12 时，验证误差从 10.0% 恶化到 16.7%。',
    bad: '树越小越好，应该尽量把 min_samples_leaf 调大。',
  },
  'in-2': {
    good: '越深的节点里样本越少，几个样本的偶然波动就能改变哪一刀胜出；而且上面一刀一变，下面整棵子树都跟着变，所以方差大。',
    bad: '不会变大，算法是确定的，同样的设置总会得到同一棵树。',
  },
  'eg-2': {
    good: '熵是 0。因为这个分支是纯的，4 天全都打球，只有一个类别，没有任何不确定性。',
    bad: '熵是 1，因为这个分支有 4 天。',
  },
  'mv-2': {
    good: '它只是把 14 行一行一行记住了。遇到没见过的新一天（比如 D15），它找不到这个编号，没法根据天气做出任何有依据的预测，没有学到能泛化的规律。',
    bad: '因为它过拟合了。',
  },
  'grl-2': {
    good: '要靠结构性的判断：检测那些分支几乎全是单个样本的特征并拒绝它，比如要求每个分支平均至少 2 个样本；或者一开始就不把行号这种标识符列当作特征。',
    bad: '换成增益率就能挡住它。',
  },
}

/** With the fake model, a marker makes the verdict explicit; the real model reads the text. */
export const written = (id, kind) => {
  const a = ANSWERS[id]
  if (!a) return null
  if (REAL) return kind === 'good' ? a.good : a.bad
  return kind === 'good' ? `【对】${a.good}` : `【误解】${a.bad}`
}

/** Submit a written answer and wait for a settled grading status. */
export async function submitWritten(el, text) {
  await el.locator('textarea').fill(text)
  await el.getByRole('button', { name: /^(提交|重新提交|重试批改)$/ }).first().click()
  await el.page().waitForFunction((node) => {
    const s = node.querySelector('[data-testid="grading-status"]')
    return !s || s.dataset.status !== '批改中'
  }, await el.elementHandle(), { timeout: 90000 })
  await el.page().waitForTimeout(150)
  return (await el.getByRole('button', { name: '继续', exact: true }).count()) > 0
}

export class Log {
  constructor(name) { this.name = name; this.findings = []; this.notes = [] }
  fail(m) { this.findings.push(m) }
  note(m) { this.notes.push(m) }
  check(cond, m) { if (!cond) this.fail(m); return Boolean(cond) }
}

export function report(logs) {
  let failed = 0
  for (const l of logs) {
    const mark = l.findings.length ? '✗' : '✓'
    console.log(`${mark} ${l.name}${l.notes.length ? ` — ${l.notes.join('; ')}` : ''}`)
    for (const f of l.findings) console.log(`    - ${f}`)
    failed += l.findings.length
  }
  return failed
}
