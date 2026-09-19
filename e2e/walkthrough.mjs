/**
 * Walk the whole course in a real browser, twice.
 *
 *   good — every lab judgement right, every answer right the first time
 *   bad  — every lab judgement wrong first, every question answered wrong
 *          first, the first verification of every step failed; plus asking the
 *          tutor a question and for a hint on every step
 *
 * It fails on what a learner would hit and the unit tests cannot see:
 *
 *   - a dead end: a step not done, and nothing on screen to answer
 *   - the all-correct path skipping the unseen-instance verification (AC-04)
 *   - a verification instance issued twice, or one that was already met as
 *     practice; the same question put in front of the learner more than twice
 *   - a tutor request that does not carry the learner's screen
 *   - (with the real model) a number the tutor said that is neither in the
 *     course text nor on the learner's screen
 *   - console errors
 *
 * Usage: npm run e2e:walk                       (fake tutor, own server)
 *        E2E_REAL_LLM=1 npm run e2e:walk        (real model, needs MINIMAX_API_KEY)
 *        E2E_PATHS=good npm run e2e:walk        (one path only)
 */

import { chromium } from 'playwright'
import { unknownQuantities } from '../server/factcheck.js'
import {
  ROOT, REAL, course, startServer, newPage, card, setRange, readStore, tutorSettled, statusOf, tutorMessages,
  questionFor, openVerifyItems, written, submitWritten, Log, report,
} from './lib.mjs'

const PATHS = (process.env.E2E_PATHS ?? 'good,bad').split(',')

/** A remark each lab should prompt, found by a phrase in its text. */
const MOMENTS = {
  'depth-explorer': '拖过了',
  'prune-explorer': '剪',
  'instability-explorer': '已经摘了',
  'entropy-explorer': '各 7 天',
  'id-trap-explorer': '改了',
  'gain-ratio-explorer': '出局',
}

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
      await page.getByRole('button', { name: '重新开始' }).first().click()
    }
    await card(page, '第一刀：你要问哪个问题？').getByRole('button', { name: /^果皮厚度/ }).click()
    await card(page, '第二刀').getByRole('button', { name: /^果香/ }).click()
  },
  'depth-explorer': async (page, mode, log) => {
    await card(page, '先预测').getByRole('button', { name: mode === 'bad' ? '256 个（2⁸）' : '大约 40 个' }).click()
    await setRange(page, 'max_depth', 6)
    if (mode === 'bad') {
      // Back and forth: the tutor may offer to help, and must not claim anything.
      for (const d of [3, 6, 3, 6, 3, 6, 3]) await setRange(page, 'max_depth', d)
      try {
        const n = page.locator('[data-tag="nudge"]', { hasText: '在比较' })
        await n.waitFor({ timeout: 25000 })
        log.note('comparing invitation appeared')
        const text = await n.innerText()
        if (/卡住|误解|不懂/.test(text)) log.fail(`the invitation claims something about the learner: ${text}`)
      } catch {
        log.fail('dragging max_depth back and forth never drew an invitation')
      }
    }
  },
  'curve-explorer': async (page, mode) => {
    await page.locator(`[data-depth="${mode === 'bad' ? 8 : 5}"] rect`).first().click()
  },
  'prune-explorer': async (page, mode) => {
    if (mode === 'bad') {
      await setRange(page, 'min_samples_leaf', 12)
      await page.waitForTimeout(300)
    }
    await setRange(page, 'min_samples_leaf', 4)
    await page.locator('[data-testid="adopt-setting"]').click()
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

const isDone = (s) => s === 'verified' || s === 'transfer' || s === 'done'

/** Answer whatever the step asks — questions and verifications — until it is done. */
async function workUntilDone(page, concept, mode, log) {
  const presented = new Map()
  const wrongDone = new Set()
  let practiceMistakes = 0
  let verifyRounds = 0
  let sawVerifyBeforeDone = false
  for (let step = 0; step < 45; step++) {
    if (isDone(await statusOf(page, concept.id))) break

    const verify = page.locator('[data-testid="verify-card"]')
    if (await verify.count()) {
      sawVerifyBeforeDone = true
      const cont = verify.getByRole('button', { name: '继续', exact: true })
      if (await cont.count()) { await cont.click(); await page.waitForTimeout(150); continue }
      const start = page.locator('[data-testid="verify-start"]')
      if (await start.count()) { await start.click(); await page.waitForTimeout(200) }
      const open = await openVerifyItems(page, concept)
      if (!open) { log.fail('verification card on screen, but no open verification on record'); break }
      verifyRounds++
      const failFirst = mode === 'bad' && verifyRounds === 1
      for (const it of open.items) {
        const right = it.q.options.findIndex((o) => o.correct)
        const pick = failFirst && it.index === 0 ? it.q.options.findIndex((o) => !o.correct) : right
        await page.locator(`[data-verify-item="${it.index}"] [data-option="${pick}"]`).click()
      }
      await page.locator('[data-testid="verify-submit"]').click()
      await page.waitForTimeout(200)
      continue
    }

    const el = page.locator('[data-check-id]').first()
    if (!(await el.count())) {
      log.fail(`dead end: not done, and nothing to answer (policy: ${(await page.textContent('[data-testid="policy-why"]'))?.replace(/\s+/g, ' ')})`)
      return { presented, verifyRounds, sawVerifyBeforeDone }
    }
    const id = await el.getAttribute('data-check-id')
    const kind = await el.getAttribute('data-check-kind')
    presented.set(id, (presented.get(id) ?? 0) + 1)
    const check = questionFor(concept, id)
    if (!check) { log.fail(`question ${id} is neither authored nor rebuildable`); break }

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
      if (!written(id, 'good')) { log.fail(`no reference answer for ${id}`); break }
      if (mode === 'bad' && !wrongDone.has(id)) {
        wrongDone.add(id)
        if (await submitWritten(el, written(id, 'bad'))) log.fail(`the grader accepted the wrong answer to ${id}`)
        await tutorSettled(page)
      }
      if (!(await submitWritten(el, written(id, 'good')))) {
        const status = await el.locator('[data-testid="grading-status"]').getAttribute('data-status').catch(() => '')
        log.fail(`the grader did not accept the reference answer to ${id} (${status || 'rejected'})`)
        break
      }
    }
    await el.getByRole('button', { name: '继续', exact: true }).click()
    await page.waitForTimeout(150)
  }
  return { presented, verifyRounds, sawVerifyBeforeDone }
}

async function run(browser, base, mode) {
  const { page, ctx, errors, requests } = await newPage(browser, base)
  const logs = []

  for (const concept of course.concepts) {
    const log = new Log(concept.id)
    const t0 = Date.now()
    const reqStart = requests.length
    try {
      const dialog = page.locator('[role="dialog"]')
      if (await dialog.count()) log.fail(`a dialog was left open: ${(await dialog.first().innerText()).slice(0, 80)}`)
      await page.click(`[data-concept="${concept.id}"]`, { timeout: 10000 })
      await page.waitForTimeout(200)
      await labDrivers[concept.lab.type](page, mode, log)
      await tutorSettled(page)

      const want = MOMENTS[concept.lab.type]
      if (want) {
        try {
          await page.locator('[data-tag="moment"]', { hasText: want }).first().waitFor({ timeout: 20000 })
          log.note('moment remark')
        } catch {
          log.fail(`the lab never prompted its "${want}" remark`)
        }
      }
      const sees = await page.textContent('[data-testid="tutor-sees"]')
      if (!sees || sees.includes('的讲解')) log.fail(`after working in the lab the tutor still says: ${sees}`)

      if (mode === 'bad') {
        await page.locator('[data-testid="lab"]').click({ position: { x: 5, y: 5 } })
        await page.locator('aside button', { hasText: concept.suggestions[0] }).click()
        await tutorSettled(page)
        await page.locator('[data-testid="hint"]').click()
        await tutorSettled(page)
        const msgs = await tutorMessages(page)
        log.check(msgs.some((m) => m.tag === 'answer' && m.text.length > 10), 'asked a question, got no answer')
        log.check(msgs.some((m) => m.tag === 'hint' && m.text.length > 10), 'asked for a hint, got none')
      }

      const { presented, verifyRounds, sawVerifyBeforeDone } = await workUntilDone(page, concept, mode, log)
      if (mode === 'bad') {
        // Every submitted mistake gets its explanation, and none is cut off by
        // the click that made the mistake also moving the focus.
        await tutorSettled(page)
        const alerts = (await tutorMessages(page)).filter((m) => m.tag.startsWith('alert'))
        log.check(alerts.length > 0, 'no explanation after a submitted mistake')
        log.check(!alerts.some((m) => m.text.includes('没有继续')), 'an explanation after a mistake was cut off')
      }
      for (const [id, n] of presented) if (n > 2) log.fail(`question ${id} was put in front of the learner ${n} times`)
      if (concept.verify) {
        log.check(sawVerifyBeforeDone && verifyRounds >= 1, 'the step was done without an unseen-instance verification (AC-04)')
        if (mode === 'bad') log.check(verifyRounds >= 2, `a failed verification should need a second, fresh round (rounds: ${verifyRounds})`)
      }

      // No verification instance is ever issued twice, or after being met as practice.
      const store = await readStore(page)
      const mine = Object.values(store.attempts).filter((a) => a.conceptId === concept.id)
      const verifyParts = mine.filter((a) => a.activity === 'verify').flatMap((a) => a.parts ?? [])
      log.check(new Set(verifyParts).size === verifyParts.length, 'a verification question was issued twice')
      const practiceKeys = new Set(mine.filter((a) => a.activity === 'practice').map((a) => a.instanceKey))
      log.check(!verifyParts.some((k) => practiceKeys.has(k)), 'a verification question had already been met as practice')
      const js = store.judgements.filter((j) => j.conceptId === concept.id)
      const pass = js.find((j) => j.activity === 'verify' && j.correct && j.independent)
      if (concept.verify) log.check(pass, 'no independent verification pass on record')
      if (mode === 'bad' && concept.verify) {
        log.check(js.some((j) => j.activity === 'verify' && j.correct === false), 'the failed verification is not on record')
      }

      // Every tutor request carried the screen and the task.
      for (const r of requests.slice(reqStart).filter((x) => x.path.startsWith('/api/tutor/'))) {
        if (!r.body.screen) log.fail(`${r.path} was sent without the learner's screen`)
        if (!r.body.contextKey) log.fail(`${r.path} was sent without its task context`)
      }

      if (REAL) {
        const allowed = [
          concept.explain.intuition, concept.explain.example, concept.explain.formal,
          ...(concept.misconceptions ?? []).map((m) => m.correction),
          ...(concept.checks ?? []).flatMap((c) => [c.prompt, c.explain, c.rubric, ...(c.options ?? []).map((o) => o.text)]),
          ...[...presented.keys()].map((id) => questionFor(concept, id)).filter((q) => q?.generated)
            .flatMap((g) => [g.prompt, g.explain, ...g.options.map((o) => o.text), ...(g.table?.rows ?? []).map((r) => r.join(' ')), ...(g.facts ?? [])]),
          ...requests.slice(reqStart).flatMap((r) => [
            r.body.screen?.doing, ...(r.body.screen?.facts ?? []), r.body.screen?.check?.prompt,
            ...(r.body.screen?.check?.table ?? []), ...(r.body.action?.facts ?? []), r.body.action?.description,
            r.body.answer, r.body.question, ...(r.body.history ?? []).map((m) => m.text),
            ...(r.body.screen?.previous ?? []).flatMap((p) => [p.doing, ...p.facts]),
          ]),
        ].filter(Boolean).join('\n')
        for (const m of await tutorMessages(page)) {
          const bad = unknownQuantities(m.text, allowed)
          if (bad.length) log.fail(`tutor (${m.tag}) cited ${bad.map((q) => q.raw).join('、')}: "${m.text.slice(0, 100)}"`)
        }
      }
      log.note(`${presented.size} questions, ${verifyRounds} verification round(s), ${Math.round((Date.now() - t0) / 1000)} s`)
    } catch (err) {
      log.fail(`crashed: ${err.message.split('\n')[0]}`)
      await page.screenshot({ path: `${ROOT}/e2e/failure-${mode}-${concept.id}.png` }).catch(() => {})
    }
    log.check(isDone(await statusOf(page, concept.id)), `not done at the end of its turn (${await statusOf(page, concept.id)})`)
    logs.push(log)
  }

  const summary = new Log('(course)')
  const header = await page.textContent('[data-testid="open-profile"]')
  summary.check(/已独立验证\s*9\s*\/\s*9/.test(header ?? ''), `header should show all 9 verifiable capabilities verified: ${header}`)
  if (errors.length) for (const e of [...new Set(errors)]) summary.fail(`console error: ${e}`)
  logs.push(summary)
  await ctx.close()
  return logs
}

const { base, stop } = await startServer()
const browser = await chromium.launch()
let failed = 0
try {
  for (const mode of PATHS) {
    const t0 = Date.now()
    const logs = await run(browser, base, mode)
    console.log(`\n=== ${mode} path (${Math.round((Date.now() - t0) / 1000)} s, ${REAL ? 'real model' : 'fake tutor'})`)
    failed += report(logs)
  }
} finally {
  await browser.close()
  stop()
}
console.log(failed ? `\n${failed} problem(s) found.` : '\nNo problems found.')
process.exit(failed ? 1 : 0)
