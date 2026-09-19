/**
 * Walk the whole decision-tree course in a real browser, twice.
 *
 *   good — every lab action right, every answer right the first time
 *   bad  — every lab judgement wrong first, every question answered wrong
 *          first; plus asking the tutor a question and for a hint on every step
 *
 * then a short third run for the tutor's unprompted remarks (stalls). It fails on
 * the things a learner would hit and the unit tests cannot see:
 *
 *   - a dead end: a concept that is not mastered but offers nothing to answer
 *   - the same question put in front of the learner more than twice
 *   - a number in anything the tutor said that is neither in the course text nor
 *     on the learner's screen
 *   - a tutor request that does not carry the learner's screen
 *   - a remark the lab should have prompted that never appeared
 *   - console errors
 *
 * It talks to the real model, so it needs MINIMAX_API_KEY and takes minutes.
 * Usage: npm run e2e            (builds, starts its own server on a free port)
 *        BASE_URL=http://localhost:5173 npm run e2e   (against a running app)
 *        E2E_PATHS=good npm run e2e                   (one path only)
 */

import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { courseList } from '../src/courses/index.js'
import { resolvePractice } from '../src/labs/practice.js'
import { unknownQuantities } from '../server/factcheck.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const course = courseList.find((c) => c.id === 'decision-tree')
const PATHS = (process.env.E2E_PATHS ?? 'good,bad,idle').split(',')

/**
 * Reference answers for the written questions: `good` in order of preference
 * (a second, fuller phrasing in case the grader wants more), `bad` holding the
 * concept's catalogued misconception where there is one.
 */
const ANSWERS = {
  'rt-2': {
    good: ['继续分确实能让训练集全对，但那一刀只是为了照顾那 1 个苹果，学到的是这批数据的偶然性而不是规律，会过拟合，到新数据上泛化反而变差。'],
    bad: '叶子必须是纯的才算建好，混着的叶子说明树还没建完，应该继续往下分。',
  },
  'pu-3': {
    good: ['不能删。果香在根节点上增益低，但特征的价值取决于它作用在哪批样本上：果皮切开之后，右边那 9 个样本里「无果香」一刀就能分干净，算法建树时会在子节点选它。'],
    bad: '可以删，它的增益最低，说明这个特征没用。',
  },
  'gr-1': {
    good: ['不能完全补回来。第一刀决定了两个子问题各自面对哪些样本，后面只能在这个划分内部做局部优化，贪心算法也从不回头修改第一刀。'],
    bad: '能补回来，后面每一步都选最好的，最后整棵树还是最优的。',
  },
  'dc-2': {
    good: ['训练误差会继续下降，从 6.3% 降到 2.9%；验证误差反而会上升，从 10.0% 升到 13.3%。'],
    bad: '两个都会下降，树越深越准。',
  },
  'of-2': {
    good: ['不能这么下结论。验证集只有 60 个样本，一个样本就是 1.67 个百分点，这点差异在噪声范围内，应该看整体趋势，或者用交叉验证。'],
    bad: '是的，depth 2 的验证误差更低，所以 depth 2 更好。',
  },
  'pr-2': {
    good: ['剪过头会欠拟合：模型容量不足以表达真实规律。比如 min_samples_leaf 调到 12 时，验证误差从 10.0% 恶化到 16.7%。'],
    bad: '树越小越好，应该尽量把 min_samples_leaf 调大。',
  },
  'in-2': {
    good: ['越深的节点里样本越少，几个样本的偶然波动就能改变哪一刀胜出；而且上面一刀一变，下面整棵子树都跟着变，所以方差大。'],
    bad: '不会变大，算法是确定的，同样的设置总会得到同一棵树。',
  },
  'eg-2': {
    good: ['熵是 0。因为这个分支是纯的，4 天全都打球，只有一个类别，没有任何不确定性。'],
    bad: '熵是 1，因为这个分支有 4 天。',
  },
  'mv-2': {
    good: ['它只是把 14 行一行一行记住了。遇到没见过的新一天（比如 D15），它找不到这个编号，没法根据天气做出任何有依据的预测，没有学到能泛化的规律。'],
    bad: '因为它过拟合了。',
  },
  'grl-2': {
    good: ['要靠结构性的判断：检测那些分支几乎全是单个样本的特征并拒绝它，比如要求每个分支平均至少 2 个样本；或者一开始就不把行号这种标识符列当作特征。'],
    bad: '换成增益率就能挡住它。',
  },
}

/** A remark each lab should prompt, found by a phrase in its text. */
const MOMENTS = {
  'depth-explorer': '拖过了',
  'prune-explorer': '剪到了',
  'instability-explorer': '已经摘了',
  'entropy-explorer': '各 7 天',
  'id-trap-explorer': '改了',
  'gain-ratio-explorer': '出局',
}

// --- server -------------------------------------------------------------------

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function startServer() {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, stop: () => {} }
  execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' })
  const port = await freePort()
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
  const base = `http://localhost:${port}`
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/api/health`)
      if (r.ok) {
        const h = await r.json()
        if (!h.hasKey) throw new Error('MINIMAX_API_KEY is not set — the walkthrough exercises the real tutor')
        return { base, stop: () => proc.kill() }
      }
    } catch (e) {
      if (e.message.includes('MINIMAX')) { proc.kill(); throw e }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  proc.kill()
  throw new Error('server did not start')
}

// --- page helpers ---------------------------------------------------------------

const card = (page, title) => page.locator('.panel', { hasText: title }).first()

/** Move a range input the way a drag does: React listens for native input events. */
async function setRange(page, label, value) {
  await page.locator(`input[type=range][aria-label="${label}"]`).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await page.waitForTimeout(60)
}

/** Wait until nothing in the tutor panel is still being written. */
async function tutorSettled(page, timeout = 90000) {
  await page.waitForTimeout(250)
  await page.waitForFunction(() => !document.querySelector('[data-streaming="1"]'), null, { timeout })
}

const statusOf = (page, id) => page.getAttribute(`[data-concept="${id}"]`, 'data-status')

async function tutorMessages(page) {
  return page.$$eval('[data-tag]', (els) => els.map((e) => ({ tag: e.dataset.tag, text: e.innerText })))
}

// --- lab drivers ------------------------------------------------------------------

const labDrivers = {
  'tree-reader': async (page, mode) => {
    if (mode === 'bad') {
      await page.click('[data-node="rL"] circle')
      await tutorSettled(page)
      await page.getByRole('button', { name: '再试一次' }).click()
    }
    await page.click('[data-node="rRR"] circle')
  },
  'split-explorer': async (page, mode) => {
    await card(page, '按哪个特征切一刀？').getByRole('button', { name: '果皮厚度', exact: true }).click()
    await setRange(page, '阈值', 1)
    await card(page, '先猜一下').getByRole('button', { name: mode === 'bad' ? '重量' : '果皮厚度', exact: true }).click()
  },
  'tree-builder': async (page, mode) => {
    if (mode === 'bad') {
      await card(page, '第一刀：你要问哪个问题？').getByRole('button', { name: /^果香/ }).click()
      await tutorSettled(page)
      await page.getByRole('button', { name: '重新开始' }).click()
    }
    await card(page, '第一刀：你要问哪个问题？').getByRole('button', { name: /^果皮厚度/ }).click()
    await card(page, '第二刀').getByRole('button', { name: /^果香/ }).click()
  },
  'depth-explorer': async (page, mode, log) => {
    await card(page, '先预测').getByRole('button', { name: mode === 'bad' ? '256 个（2⁸）' : '大约 40 个' }).click()
    await setRange(page, 'max_depth', 6)
    if (mode === 'bad') {
      // Drag back and forth: the tutor should notice the searching.
      for (const d of [3, 6, 3, 6, 3, 6, 3]) await setRange(page, 'max_depth', d)
      try {
        await page.locator('[data-tag="nudge"]', { hasText: '来回拖' }).waitFor({ timeout: 25000 })
        log.note('thrash nudge appeared')
      } catch {
        log.fail('dragging max_depth back and forth never drew the "来回拖" remark')
      }
    }
  },
  'curve-explorer': async (page, mode) => {
    await page.locator(`[data-depth="${mode === 'bad' ? 8 : 5}"] rect`).click()
  },
  'prune-explorer': async (page, mode) => {
    if (mode === 'bad') {
      await setRange(page, 'min_samples_leaf', 12)
      await tutorSettled(page)
    }
    await setRange(page, 'min_samples_leaf', 4)
    const quiz = card(page, '小测验：新来一个水果')
    if (mode === 'bad') {
      await quiz.getByRole('button', { name: '是', exact: true }).click()
      await tutorSettled(page)
      await quiz.getByRole('button', { name: '再走一遍' }).click()
    }
    await quiz.getByRole('button', { name: '否', exact: true }).click()
    await quiz.getByRole('button', { name: '否', exact: true }).click()
  },
  'instability-explorer': async (page, mode) => {
    await card(page, '先预测').getByRole('button', { name: mode === 'bad' ? /^几乎从不/ : /^大约 13%/ }).click()
    await page.getByRole('button', { name: '再摘一批' }).click()
    await page.getByRole('button', { name: '再摘一批' }).click()
  },
  'entropy-explorer': async (page, mode) => {
    await setRange(page, '14 天里打球的天数', 7)
    await card(page, '先猜').getByRole('button', { name: mode === 'bad' ? '湿度' : '天气', exact: true }).click()
  },
  'id-trap-explorer': async (page, mode) => {
    await card(page, '第 15 天来了').getByRole('button', { name: mode === 'bad' ? /^第 15 天的天气/ : /^什么都不看/ }).click()
    await page.selectOption('select[aria-label="第 15 天的天气"]', 'Sunny')
    await page.selectOption('select[aria-label="第 15 天的风力"]', 'Weak')
  },
  'gain-ratio-explorer': async (page, mode) => {
    await card(page, '先预测').getByRole('button', { name: mode === 'bad' ? /^不能——/ : /^能——/ }).click()
    await setRange(page, '每个分支平均至少要有的样本数', 2)
  },
}

// --- questions ------------------------------------------------------------------------

/**
 * Submit a written answer and wait for the verdict. A grader failure shows the
 * learner a retry button and scores nothing; the walkthrough uses that button
 * once, as a learner would, and only gives up if the retry fails too.
 */
async function submitWritten(el, text, log) {
  await el.locator('textarea').fill(text)
  await el.getByRole('button', { name: /^(提交|重新提交)$/ }).click()
  const accepted = el.getByRole('button', { name: '继续', exact: true })
  const resubmit = el.getByRole('button', { name: '重新提交' })
  const failed = el.getByText('没能批改')
  for (let attempt = 0; attempt < 2; attempt++) {
    await Promise.race([
      accepted.waitFor({ timeout: 90000 }),
      resubmit.waitFor({ timeout: 90000 }),
      failed.waitFor({ timeout: 90000 }),
    ])
    if (!(await failed.count())) return (await accepted.count()) > 0
    log.note('the grader failed once; the retry button was used')
    await el.getByRole('button', { name: '重试' }).click()
    await failed.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  }
  throw new Error('grader failed twice in a row')
}

/** Answer whatever the page asks until the concept is mastered. */
async function answerUntilMastered(page, concept, mode, log) {
  const presented = new Map()
  const wrongDone = new Set()
  // The bad path errs on every authored question and on the first generated
  // one. Erring on every generated question too would describe a learner who
  // never learns — mastery settles around 0.7 and correctly never unlocks.
  let practiceMistakes = 0
  for (let step = 0; step < 30; step++) {
    if ((await statusOf(page, concept.id)) === 'mastered') return presented
    const el = page.locator('[data-check-id]').first()
    if (!(await el.count())) {
      log.fail(`dead end: not mastered, and no question on screen (policy says: ${await page.textContent('[data-testid="policy-why"]')})`)
      return presented
    }
    const id = await el.getAttribute('data-check-id')
    const kind = await el.getAttribute('data-check-kind')
    presented.set(id, (presented.get(id) ?? 0) + 1)
    const check = concept.checks.find((c) => c.id === id) ?? resolvePractice(concept, id)
    if (!check) { log.fail(`question ${id} is neither authored nor a resolvable practice id`); return presented }

    if (kind === 'mcq') {
      const right = check.options.findIndex((o) => o.correct)
      const errHere = mode === 'bad' && !wrongDone.has(id) && (!check.generated || practiceMistakes === 0)
      if (errHere) {
        wrongDone.add(id)
        if (check.generated) practiceMistakes++
        await el.locator(`[data-option="${check.options.findIndex((o) => !o.correct)}"]`).click()
        await tutorSettled(page)
      }
      await el.locator(`[data-option="${right}"]`).click()
    } else {
      const a = ANSWERS[id]
      if (!a) { log.fail(`no reference answer for written question ${id}`); return presented }
      if (mode === 'bad' && !wrongDone.has(id)) {
        wrongDone.add(id)
        if (await submitWritten(el, a.bad, log)) log.fail(`grader accepted the wrong answer to ${id}: "${a.bad}"`)
        await tutorSettled(page)
      }
      let ok = false
      for (const text of a.good) {
        ok = await submitWritten(el, text, log)
        if (ok) break
      }
      if (!ok) { log.fail(`grader rejected every reference answer to ${id}`); return presented }
    }
    await el.getByRole('button', { name: '继续', exact: true }).click()
    await page.waitForTimeout(150)
  }
  log.fail('dead end: 30 questions without reaching mastery')
  return presented
}

// --- one run through the course ---------------------------------------------------------

async function run(browser, base, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1460, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  const requests = []
  // A failed fetch also logs a bare "Failed to load resource" line; the request
  // that failed is reported by the check that made it, with its reason.
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (!r.url().includes('/api/tutor/')) return
    try { requests.push({ path: new URL(r.url()).pathname, body: JSON.parse(r.postData() ?? '{}') }) } catch { /* ignore */ }
  })

  await page.goto(base)
  await page.waitForSelector('[data-testid="tutor-sees"]')
  const results = []

  for (const concept of course.concepts) {
    const t0 = Date.now()
    const findings = []
    const notes = []
    const log = { fail: (m) => findings.push(m), note: (m) => notes.push(m) }
    const reqStart = requests.length

    if ((await statusOf(page, concept.id)) === 'locked') {
      log.fail('still locked when its turn came')
      results.push({ concept: concept.id, findings, notes, secs: 0 })
      continue
    }
    await page.click(`[data-concept="${concept.id}"]`)
    await page.waitForTimeout(200)

    try {
      await labDrivers[concept.lab.type](page, mode, log)
      await tutorSettled(page)

      const want = MOMENTS[concept.lab.type]
      if (want) {
        try {
          await page.locator('[data-tag="nudge"]', { hasText: want }).waitFor({ timeout: 20000 })
          notes.push('moment remark appeared')
        } catch {
          log.fail(`the lab never prompted its "${want}" remark`)
        }
      }

      const sees = await page.textContent('[data-testid="tutor-sees"]')
      if (!sees || sees.includes('的讲解')) log.fail(`after working in the lab the tutor still says: ${sees}`)

      if (mode === 'bad') {
        // Ask a question and ask for a hint, while looking at the lab.
        await page.locator('[data-testid="lab"]').click({ position: { x: 5, y: 5 } })
        const suggestion = page.locator('aside button', { hasText: concept.suggestions[0] })
        await suggestion.click()
        await tutorSettled(page)
        await page.locator('aside button', { hasText: '给我一个提示' }).first().click()
        await tutorSettled(page)
        const msgs = await tutorMessages(page)
        if (!msgs.some((m) => m.tag === 'answer' && m.text.length > 10)) log.fail('asked a question, got no answer')
        if (!msgs.some((m) => m.tag === 'hint' && m.text.length > 10)) log.fail('asked for a hint, got none')
      }

      const presented = await answerUntilMastered(page, concept, mode, log)
      for (const [id, n] of presented) if (n > 2) log.fail(`question ${id} was put in front of the learner ${n} times`)
      await tutorSettled(page)

      // Everything the tutor said on this step, checked against what it was allowed to know.
      const mine = requests.slice(reqStart)
      for (const r of mine) {
        if (!r.body.screen) log.fail(`${r.path} was sent without the learner's screen`)
        if ((r.path.endsWith('/ask') || r.path.endsWith('/hint')) && r.body.screen?.focus === 'lab' && !r.body.screen?.doing) {
          log.fail(`${r.path} said the learner was in the lab but carried nothing the lab showed`)
        }
      }
      const generated = [...presented.keys()].map((id) => resolvePractice(concept, id)).filter(Boolean)
      const allowed = [
        concept.explain.intuition, concept.explain.example, concept.explain.formal,
        ...(concept.misconceptions ?? []).map((m) => m.correction),
        ...(concept.checks ?? []).flatMap((c) => [c.prompt, c.explain, c.rubric, ...(c.options ?? []).map((o) => o.text)]),
        ...generated.flatMap((g) => [g.prompt, g.explain, ...g.options.map((o) => o.text), ...(g.table?.rows ?? []).map((r) => r.join(' ')), ...(g.facts ?? [])]),
        ...mine.flatMap((r) => [
          r.body.screen?.doing, ...(r.body.screen?.facts ?? []), r.body.screen?.check?.prompt,
          ...(r.body.screen?.check?.table ?? []), ...(r.body.action?.facts ?? []), r.body.action?.description,
          r.body.answer, r.body.question,
        ]),
      ].filter(Boolean).join('\n')
      const msgs = await tutorMessages(page)
      for (const m of msgs) {
        const bad = unknownQuantities(m.text, allowed)
        if (bad.length) log.fail(`tutor (${m.tag}) cited ${bad.map((q) => q.raw).join('、')} — on neither the screen nor the page: "${m.text.slice(0, 120)}"`)
        if (/没能回应/.test(m.text)) log.fail(`tutor failed: ${m.text.slice(0, 120)}`)
      }
      notes.push(`${msgs.length} tutor messages, ${mine.length} tutor requests, questions: ${[...presented].map(([id, n]) => (n > 1 ? `${id}×${n}` : id)).join(' ')}`)
    } catch (err) {
      log.fail(`crashed: ${err.message.split('\n')[0]}`)
      await page.screenshot({ path: `${ROOT}/e2e/failure-${mode}-${concept.id}.png` }).catch(() => {})
    }

    if ((await statusOf(page, concept.id)) !== 'mastered') log.fail('not mastered at the end of its turn')
    results.push({ concept: concept.id, findings, notes, secs: Math.round((Date.now() - t0) / 1000) })
  }

  if (errors.length) results.push({ concept: '(console)', findings: [...new Set(errors)].map((e) => `console error: ${e}`), notes: [], secs: 0 })
  await ctx.close()
  return results
}

/** A learner who starts, then stops: the tutor should offer help, once, and deliver it. */
async function idleRun(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1460, height: 1000 } })
  const page = await ctx.newPage()
  const findings = []
  await page.goto(`${base}/?idle=4`)
  await page.waitForSelector('[data-testid="tutor-sees"]')
  await page.locator('main').click({ position: { x: 30, y: 30 } })
  try {
    const n = page.locator('[data-tag="nudge"]', { hasText: '停了一会儿' })
    await n.waitFor({ timeout: 15000 })
    await n.getByRole('button', { name: '给我一个提示' }).click()
    await tutorSettled(page)
    const msgs = await tutorMessages(page)
    if (!msgs.some((m) => m.tag === 'hint' && m.text.length > 10)) findings.push('the stall remark offered a hint that never arrived')
    await page.waitForTimeout(9000)
    const again = await page.locator('[data-tag="nudge"]', { hasText: '停了一会儿' }).count()
    if (again > 1) findings.push('the stall remark repeated without any new activity')
  } catch (err) {
    findings.push(`no stall remark after 4 s of inactivity (${err.message.split('\n')[0]})`)
  }
  await ctx.close()
  return [{ concept: '(stall)', findings, notes: [], secs: 0 }]
}

// --- main ---------------------------------------------------------------------------------

const { base, stop } = await startServer()
const browser = await chromium.launch()
let failed = 0
try {
  for (const mode of PATHS) {
    const t0 = Date.now()
    const results = mode === 'idle' ? await idleRun(browser, base) : await run(browser, base, mode)
    console.log(`\n=== ${mode} path (${Math.round((Date.now() - t0) / 1000)} s)`)
    for (const r of results) {
      const mark = r.findings.length ? '✗' : '✓'
      console.log(`${mark} ${r.concept}${r.secs ? ` (${r.secs} s)` : ''}${r.notes.length ? ` — ${r.notes.join('; ')}` : ''}`)
      for (const f of r.findings) console.log(`    - ${f}`)
      failed += r.findings.length
    }
  }
} finally {
  await browser.close()
  stop()
}
console.log(failed ? `\n${failed} problem(s) found.` : '\nNo problems found.')
process.exit(failed ? 1 : 0)
