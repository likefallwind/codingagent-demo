/**
 * The M2 acceptance paths (需求文档 §10, AC-01 … AC-14), one scenario each, in
 * a real browser against the real app. Each scenario starts from an empty
 * record in its own browser context and checks both what the learner sees and
 * what the record says.
 *
 * The project scenarios run real Python (Pyodide + scikit-learn, loaded from
 * the CDN into a Web Worker), so the first one takes a little longer.
 *
 * Usage: npm run e2e:accept                 (fake tutor, own server)
 *        E2E_ONLY=AC-09,AC-13 npm run e2e:accept
 */

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  course, startServer, newPage, card, setRange, readStore, tutorSettled, statusOf, tutorMessages,
  openVerifyItems, written, submitWritten, Log, report, STORE_KEY,
} from './lib.mjs'

const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null
const concept = (id) => course.concepts.find((c) => c.id === id)

// --- small drivers ------------------------------------------------------------------

async function go(page, id) {
  await page.click(`[data-concept="${id}"]`)
  await page.waitForTimeout(200)
}

async function answerMcq(page, conceptId, right = true) {
  const el = page.locator('[data-check-id]').first()
  const id = await el.getAttribute('data-check-id')
  const c = concept(conceptId).checks.find((x) => x.id === id)
  const idx = c.options.findIndex((o) => (right ? o.correct : !o.correct))
  await el.locator(`[data-option="${idx}"]`).click()
  return id
}

async function continueCard(page) {
  await page.locator('[data-check-id]').first().getByRole('button', { name: '继续', exact: true }).click()
  await page.waitForTimeout(150)
}

/** Press Tab until the focused element matches, then return true. */
async function tabTo(page, match, max = 400) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    const hit = await page.evaluate((m) => {
      const el = document.activeElement
      if (!el || el === document.body || el === document.documentElement) return false
      const labelled = [...(el.labels ?? [])].map((l) => l.innerText).join(' ')
      const label = `${el.getAttribute('aria-label') ?? ''} ${labelled} ${el.getAttribute('data-testid') ?? ''} ${el.innerText ?? ''}`
      return label.includes(m)
    }, match)
    if (hit) return true
  }
  return false
}

async function judgementsOf(page, conceptId) {
  return (await readStore(page)).judgements.filter((j) => j.conceptId === conceptId)
}

// --- scenarios ---------------------------------------------------------------------------

const scenarios = {
  async 'AC-01'(browser, base, log) {
    const { page, ctx, errors } = await newPage(browser, base)
    await go(page, 'pruning')
    const before = await readStore(page)
    await setRange(page, 'min_samples_leaf', 12)
    await page.waitForTimeout(300)
    await setRange(page, 'min_samples_leaf', 1)
    await page.waitForTimeout(1200)
    const s = await readStore(page)
    log.check(!s.judgements.some((j) => j.conceptId === 'pruning'), '调参被记成了作答')
    log.check(Object.keys(s.misconceptions.pruning ?? {}).length === 0, `调参被判成了误解：${JSON.stringify(s.misconceptions.pruning)}`)
    log.check(s.concepts.pruning.mastery === before.concepts.pruning.mastery, '调参改变了内部估计')
    log.check(s.events.some((e) => e.conceptId === 'pruning' && e.object === 'lab' && e.action === 'explore' && e.detail?.labStep === 'over-prune'), '没有留下探索记录')
    log.check(s.events.some((e) => e.object === 'slider:min_samples_leaf'), '滑块的取值没有作为行为事件记录')
    const msgs = await tutorMessages(page)
    log.check(!msgs.some((m) => /误解|你以为/.test(m.text)), 'AI 老师把探索说成了误解')
    log.note(`探索记录 ${s.events.filter((e) => e.conceptId === 'pruning').length} 条，作答 0 条`)
    if (errors.length) log.fail(`console: ${errors[0]}`)
    await ctx.close()
  },

  async 'AC-02'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await answerMcq(page, 'read-tree')
    await continueCard(page)
    const el = page.locator('[data-check-id="rt-2"]')
    await submitWritten(el, written('rt-2', 'bad'))
    await tutorSettled(page)
    const js = await judgementsOf(page, 'read-tree')
    const j = js.find((x) => x.taskId === 'rt-2')
    log.check(j?.verdict === 'misconception', `批改结论不是误解：${j?.verdict}`)
    log.check(Array.isArray(j?.criteria) && j.criteria.length === 2 && j.criteria.every((c) => c.met === false), '评分项没有逐条记录')
    const s = await readStore(page)
    log.check(s.misconceptions['read-tree']?.leaf_must_be_pure?.status === 'supported', '学生自己写出的错误理由没有成为「已有证据支持」的误解')
    const why = await page.getAttribute('[data-testid="policy-why"]', 'data-action')
    const card1 = await page.locator('text=先把这个理清楚').count() + await page.locator('text=有证据支持的误解').count()
    log.check(card1 > 0, '页面没有针对这个理由给出诊断或补练')
    log.note(`下一步：${why}`)
    await ctx.close()
  },

  async 'AC-03'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await go(page, 'purity')
    // A wrong lab judgement with a catalogued belief: a lead, not a finding —
    // and the next question is the one that can confirm or rule it out.
    await card(page, '先猜一下').getByRole('button', { name: '重量', exact: true }).click()
    await page.waitForTimeout(300)
    let s = await readStore(page)
    log.check(s.misconceptions.purity?.more_thresholds_better?.status === 'suspected', '选错被直接当成了确定的误解')
    log.check(await page.locator('[data-check-id]').first().getAttribute('data-check-id') === 'pu-2', '没有先用诊断题核实这个线索')
    // The same belief again, on the diagnostic question: now the evidence supports it.
    const pu2 = concept('purity').checks.find((c) => c.id === 'pu-2')
    await page.locator('[data-check-id="pu-2"] [data-option]').nth(0).waitFor()
    await page.locator(`[data-check-id="pu-2"] [data-option="${pu2.options.findIndex((o) => o.misconception === 'more_thresholds_better')}"]`).click()
    await tutorSettled(page)
    await page.locator(`[data-check-id="pu-2"] [data-option="${pu2.options.findIndex((o) => o.correct)}"]`).click()
    await continueCard(page)
    s = await readStore(page)
    log.check(s.misconceptions.purity?.more_thresholds_better?.status === 'supported', `两次出现后应为「已有证据支持」：${s.misconceptions.purity?.more_thresholds_better?.status}`)
    // AC-03: another question of the same step answered right leaves it as it was.
    const next = await page.locator('[data-check-id]').first().getAttribute('data-check-id')
    if (next === 'pu-1') {
      await answerMcq(page, 'purity')
      await continueCard(page)
    } else {
      await submitWritten(page.locator('[data-check-id]').first(), written(next, 'good'))
      await continueCard(page)
    }
    s = await readStore(page)
    log.check(s.misconceptions.purity?.more_thresholds_better?.status === 'supported', '答对同一概念的另一道题，清除了与它无关的误解')
    log.note(`另一道题：${next}`)
    await ctx.close()
  },

  async 'AC-04'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await answerMcq(page, 'read-tree')
    await continueCard(page)
    await submitWritten(page.locator('[data-check-id="rt-2"]'), written('rt-2', 'good'))
    await continueCard(page)
    const s = await readStore(page)
    log.check(s.concepts['read-tree'].mastery > 0.5, `内部估计应该已经很高（${s.concepts['read-tree'].mastery.toFixed(2)}）`)
    log.check(await page.getAttribute('[data-testid="policy-why"]', 'data-action') === 'verify', '全对之后没有进入新实例验证')
    log.check(await statusOf(page, 'read-tree') !== 'verified', '没做验证就标成了已验证')
    log.check(await page.locator('[data-testid="verify-card"]').count() === 1, '验证卡没有出现')
    await ctx.close()
  },

  async 'AC-05'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await page.locator('[data-check-id="rt-1"]').click({ position: { x: 20, y: 20 } })
    await page.locator('[data-testid="hint"]').click()
    await tutorSettled(page)
    let s = await readStore(page)
    const att = Object.values(s.attempts).find((a) => a.taskId === 'rt-1' && a.status === 'open')
    log.check(att?.assisted, '提示没有记到这道题的尝试上')
    log.check(s.help.some((h) => h.source === 'hint' && h.attemptIds.includes(att?.id)), '帮助记录没有关联到受影响的尝试')
    await page.reload()
    await page.waitForSelector('[data-check-id="rt-1"]')
    log.check(await page.locator('[data-testid="assisted-mark"]').count() === 1, '刷新之后「已用过提示」的标记消失了')
    await answerMcq(page, 'read-tree')
    s = await readStore(page)
    const j = s.judgements.find((x) => x.taskId === 'rt-1')
    log.check(j?.assisted && !j.independent, '看过提示后答对，被记成了独立答对')
    const msgs = await tutorMessages(page)
    log.check(msgs.some((m) => m.tag === 'hint'), '刷新后对话记录丢了')
    await ctx.close()
  },

  async 'AC-06'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await go(page, 'overfitting')
    const styles = () => page.$$eval('[data-depth] text', (els) => els.map((t) => `${t.getAttribute('fill')}|${t.getAttribute('font-weight')}`))
    const before = await styles()
    log.check(new Set(before).size === 1, `作答前各候选深度的样式不一致：${[...new Set(before)].join(' / ')}`)
    const lab = await page.locator('[data-testid="lab"]').innerText()
    log.check(!/最低|最优|验证误差最/.test(lab.split('轮到你了')[0]), '作答前图上出现了指向答案的文字')
    const req = await page.evaluate(() => document.querySelector('[data-testid="tutor-sees"]')?.innerText)
    log.note(`AI 看到：${req}`)
    await page.locator('[data-depth-button="3"]').click()
    const after = await styles()
    log.check(new Set(after).size === 2, '提交后应该标出正确位置')
    await ctx.close()
  },

  async 'AC-09'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await answerMcq(page, 'read-tree')
    await continueCard(page)
    const el = page.locator('[data-check-id="rt-2"]')
    const before = (await readStore(page)).concepts['read-tree'].mastery
    const text = `【故障】${written('rt-2', 'good').replace('【对】', '')}`
    await submitWritten(el, text)
    log.check(await el.locator('text=未评定').count() > 0, 'AI 失联时没有显示「未评定」')
    log.check(await el.locator('textarea').inputValue() === text, '批改失败后回答没有保留')
    let s = await readStore(page)
    const j = s.judgements.filter((x) => x.taskId === 'rt-2')
    log.check(j.length === 1 && j[0].correct === null && j[0].verdict === 'unrated', '失败的批改没有记为未评定')
    log.check(s.concepts['read-tree'].mastery === before, '失败的批改改变了内部估计')
    // An invalid reply is the same: unrated.
    await submitWritten(el, `【无效】${written('rt-2', 'good').replace('【对】', '')}`)
    s = await readStore(page)
    log.check(s.judgements.filter((x) => x.taskId === 'rt-2').every((x) => x.correct === null), '无效的批改被计了分')
    // A model that never answers is stopped by the deadline and shown as such.
    await submitWritten(el, `【超时】${written('rt-2', 'good').replace('【对】', '')}`)
    const timeoutText = await el.innerText()
    log.check(/未评定/.test(timeoutText) && /没有完成|超时/.test(timeoutText), '批改超时没有显示为未评定')
    s = await readStore(page)
    log.check(s.judgements.filter((x) => x.taskId === 'rt-2').every((x) => x.correct === null), '超时的批改被计了分')
    // A retry that works counts as the first rated try; a double click counts once.
    await el.locator('textarea').fill(written('rt-2', 'good'))
    await el.getByRole('button', { name: /^(提交|重新提交|重试批改)$/ }).first().dblclick()
    await page.waitForFunction(() => document.querySelector('[data-testid="grading-status"]')?.dataset.status !== '批改中').catch(() => {})
    await page.waitForTimeout(600)
    s = await readStore(page)
    const rated = s.judgements.filter((x) => x.taskId === 'rt-2' && x.correct !== null)
    log.check(rated.length === 1, `双击提交产生了 ${rated.length} 条有效评分`)
    log.check(rated[0]?.firstTry, '网络故障之后的第一次有效批改没有算作首次作答')
    await ctx.close()
  },

  async 'AC-10'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await page.locator('[data-testid="lab"]').click({ position: { x: 5, y: 5 } })
    await page.fill('input[aria-label="向 AI 老师提问"]', '【慢】为什么这个叶子里有一个苹果？')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    // Switch task right away: the question card.
    await page.locator('[data-check-id="rt-1"]').click({ position: { x: 20, y: 20 } })
    await page.waitForTimeout(5000)
    const msgs = await tutorMessages(page)
    const answer = msgs.filter((m) => m.tag === 'answer')
    log.check(answer.length === 1, `应该有一条回答消息，实际 ${answer.length}`)
    log.check(answer.every((m) => !m.text.includes('这个问题可以从界面上正在显示的结果入手')), '迟到的回答出现在了新任务里')
    log.check(answer.every((m) => /换到了别的任务/.test(m.text)), '被打断的回答没有说明原因')
    log.check(!(await page.locator('[data-testid="inline-tutor"]').count()), '旧回答出现在了题目的反馈位置')
    await ctx.close()
  },

  async 'AC-11'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base, { path: '/?idle=2' })
    await go(page, 'depth-cost')
    await page.locator('aside[data-testid="tutor"] input[role="switch"]').uncheck()
    await card(page, '先预测').getByRole('button', { name: '大约 40 个' }).click()
    for (const d of [3, 6, 3, 6, 3, 6, 3, 7, 3]) await setRange(page, 'max_depth', d)
    await page.waitForTimeout(7000)
    const msgs = await tutorMessages(page)
    log.check(!msgs.some((m) => m.tag === 'nudge' || m.tag === 'moment'), `关掉主动提醒后仍然出现了 ${msgs.filter((m) => m.tag === 'nudge' || m.tag === 'moment').length} 条主动消息`)
    await page.fill('input[aria-label="向 AI 老师提问"]', '叶子数为什么没有翻倍？')
    await page.keyboard.press('Enter')
    await tutorSettled(page)
    log.check((await tutorMessages(page)).some((m) => m.tag === 'answer' && m.text.length > 10), '关掉主动提醒后不能主动提问了')
    const s = await readStore(page)
    log.check(s.settings.proactive === false, '开关状态没有保存')
    log.check(s.events.some((e) => e.action === 'proactive-off'), '关闭提醒没有记录')
    await ctx.close()
  },

  async 'AC-12'(browser, base, log) {
    const v1 = {
      courseId: course.id, version: 1, startedAt: 1, currentConceptId: 'purity', log: [],
      concepts: {
        'read-tree': {
          mastery: 0.97, attempts: 3, correct: 3, seenExplain: true, layersSeen: ['intuition'], completedAt: 5, misconceptions: {},
          evidence: [
            { ts: 2, kind: 'labAction', correct: true, detail: { labStep: 'find-impure-leaf' } },
            { ts: 3, kind: 'mcq', correct: true, detail: { checkId: 'rt-1' } },
            { ts: 4, kind: 'freeResponse', correct: true, detail: { checkId: 'rt-2' } },
          ],
        },
      },
    }
    const { page, ctx } = await newPage(browser, base, { seed: { 'adaptive-learn:decision-tree': JSON.stringify(v1) } })
    log.check(await page.getAttribute('[data-testid="notice"]', 'data-kind') === 'migrated', '没有说明旧存档已升级')
    log.check(await statusOf(page, 'read-tree') === 'learning', `旧版「已掌握」被直接当成了已验证：${await statusOf(page, 'read-tree')}`)
    await go(page, 'read-tree')
    log.check(await page.getAttribute('[data-testid="policy-why"]', 'data-action') === 'verify', '旧版已答对的题又被要求重做，或者没有要求验证')
    const old = await page.evaluate(() => localStorage.getItem('adaptive-learn:decision-tree'))
    log.check(Boolean(old), '旧存档被删除了')
    const s = await readStore(page)
    log.check(s.legacy?.concepts?.['read-tree']?.attempts === 3, '历史进度没有保留')
    await ctx.close()
  },

  async 'AC-14'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base, { viewport: { width: 1280, height: 720 } })
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    const need = async (m, what) => log.check(await tabTo(page, m), `键盘到不了：${what}`)
    if (await need('收起 AI 老师', 'AI 面板的收起按钮')) await page.keyboard.press('Enter')
    log.check(await page.locator('[data-testid="tutor-expand"]').count() === 1, 'AI 面板没有收起')
    if (await need('叶子：7 个样本，判为橙子', '树的叶子')) await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    const rt1 = concept('read-tree').checks[0]
    if (await need(rt1.options.find((o) => o.correct).text, '选择题选项')) await page.keyboard.press('Enter')
    if (await need('继续', '继续按钮')) await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    if (await need('你的回答', '简答框')) await page.keyboard.type(written('rt-2', 'good'))
    if (await need('提交', '提交按钮')) await page.keyboard.press('Enter')
    await page.waitForSelector('[data-check-id="rt-2"] >> text=继续', { timeout: 10000 }).catch(() => {})
    if (await need('继续', '继续按钮')) await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    if (await need('verify-start', '开始独立验证')) await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    const open = await openVerifyItems(page, concept('read-tree'))
    for (const it of open?.items ?? []) {
      const right = it.q.options.find((o) => o.correct).text
      if (await need(right, `验证第 ${it.index + 1} 题的选项`)) await page.keyboard.press('Enter')
    }
    if (await need('verify-submit', '提交验证')) await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    log.check(await page.locator('text=通过独立验证').count() > 0, '看不到验证的反馈')
    if (await need('继续', '验证后的继续')) await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    if (await need('进入「', '进入下一步')) await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    const s = await readStore(page)
    log.check(s.currentConceptId === 'purity', `键盘没能继续导航到下一步（现在在 ${s.currentConceptId}）`)
    log.check(await statusOf(page, 'read-tree') === 'verified', '只用键盘没能完成这一步的验证')
    const focusVisible = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none' || document.activeElement === document.body)
    log.check(focusVisible, '焦点不可见')
    await ctx.close()
  },

  async 'FR-05 后台与前后两次结果'(browser, base, log) {
    const { page, ctx, requests } = await newPage(browser, base, { path: '/?idle=2' })
    await go(page, 'depth-cost')
    await card(page, '先预测').getByRole('button', { name: '大约 40 个' }).click()
    // In a background tab, time does not count as a pause.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(5000)
    log.check(!(await tutorMessages(page)).some((m) => m.tag === 'nudge'), '后台页面触发了停留提醒')
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // Two results of the same task, then "why did that change?".
    await setRange(page, 'max_depth', 4)
    await page.waitForTimeout(300)
    await setRange(page, 'max_depth', 8)
    await page.waitForTimeout(300)
    await page.locator('[data-testid="lab"]').click({ position: { x: 5, y: 5 } })
    await page.fill('input[aria-label="向 AI 老师提问"]', '为什么刚才那个结果会变？')
    await page.keyboard.press('Enter')
    await tutorSettled(page)
    const ask = requests.filter((r) => r.path === '/api/tutor/ask').at(-1)
    const prev = ask?.body?.screen?.previous ?? []
    log.check(prev.length >= 1, '提问没有带上同一任务里之前的结果')
    log.check(prev.some((p) => JSON.stringify(p.facts) !== JSON.stringify(ask.body.screen.facts)), '之前的结果和现在的一样，没法区分两次')
    // A follow-up carries the conversation so far about this task.
    await page.fill('input[aria-label="向 AI 老师提问"]', '那验证准确率呢？')
    await page.keyboard.press('Enter')
    await tutorSettled(page)
    const follow = requests.filter((r) => r.path === '/api/tutor/ask').at(-1)
    log.check((follow?.body?.history ?? []).length >= 2, '追问没有带上前面的对话')
    await ctx.close()
  },

  async 'FR-05 帮助关联到尝试'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await answerMcq(page, 'read-tree', false)
    await tutorSettled(page)
    const s = await readStore(page)
    const att = Object.values(s.attempts).find((a) => a.taskId === 'rt-1')
    const help = s.help.find((h) => h.source === 'check-hint')
    log.check(help && help.attemptIds.includes(att.id), '答错后的解释没有关联到那道题的尝试')
    log.check(help?.policyVersion, '帮助记录没有带提醒策略版本')
    log.check(await page.locator('[data-testid="inline-tutor"]').count() === 1, '解释没有出现在题目旁边')
    // Collapsing the panel keeps the conversation; reopening shows it.
    await page.locator('[data-testid="tutor-collapse"]').click()
    await page.locator('[data-testid="tutor-expand"]').click()
    log.check((await tutorMessages(page)).some((m) => m.tag === 'alert-check'), '收起再打开面板后消息丢了')
    await ctx.close()
  },

  async 'FR-03 跨步骤求助'(browser, base, log) {
    // A verification left open in step 1; help asked for in step 2 may be used there.
    const { page, ctx } = await newPage(browser, base)
    await page.click('[data-node="rRR"] circle')
    await answerMcq(page, 'read-tree')
    await continueCard(page)
    await submitWritten(page.locator('[data-check-id="rt-2"]'), written('rt-2', 'good'))
    await continueCard(page)
    await page.locator('[data-testid="verify-start"]').click()
    await page.waitForTimeout(300)
    await go(page, 'purity')
    await page.locator('[data-testid="hint"]').click()
    const dlg = page.locator('[data-testid="confirm"]')
    await dlg.waitFor({ timeout: 5000 }).catch(() => {})
    log.check(await dlg.count() === 1, '别处还有进行中的独立验证，求助时没有先问')
    log.check((await dlg.innerText().catch(() => '')).includes('能读懂树的预测路径'), '确认框没有说明是哪一次验证')
    await page.getByRole('button', { name: '继续独立完成' }).click()
    await page.waitForTimeout(400)
    let s = await readStore(page)
    const va = () => Object.values(s.attempts).find((a) => a.activity === 'verify')
    log.check(!va().converted && !s.help.some((h) => h.source === 'hint'), '拒绝后仍然给了帮助或转成了辅助')
    await page.locator('[data-testid="hint"]').click()
    await page.getByRole('button', { name: '转为辅助练习并获得帮助' }).click()
    await tutorSettled(page)
    s = await readStore(page)
    log.check(va().converted, '同意后那次验证没有转为辅助练习')
    log.check(s.help.some((h) => h.source === 'hint' && h.attemptIds.includes(va().id)), '这条帮助没有记到那次验证上')
    await ctx.close()
  },

  async 'AC-13b 变式转为辅助后换数据'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await go(page, 'project')
    await page.locator('[data-testid="tab-variant"]').click()
    await page.locator('[data-testid="variant-start"]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-testid="hint"]').click()
    await page.getByRole('button', { name: '转为辅助练习并获得帮助' }).click()
    await tutorSettled(page)
    const next = page.locator('[data-testid="variant-start"]')
    log.check(await next.count() === 1 && (await next.innerText()).includes('C 农场'), '转为辅助后没有办法换另一个农场的数据重新验证')
    await next.click()
    await page.waitForTimeout(300)
    let s = await readStore(page)
    const farmC = Object.values(s.attempts).find((a) => a.taskId === 'farm-c')
    log.check(farmC && farmC.resources === 'independent' && !farmC.assisted, '新的变式不是一次干净的独立验证')
    const farmB = Object.values(s.attempts).find((a) => a.taskId === 'farm-b')
    log.check(farmB?.converted && farmB.status === 'open', '转为辅助的变式应该还能继续当练习做')
    // Help asked for from the main project while C is being verified asks first.
    await page.getByRole('tab', { name: /主项目/ }).click()
    await page.locator('[data-testid="hint"]').click()
    const dlg = page.locator('[data-testid="confirm"]')
    await dlg.waitFor({ timeout: 5000 }).catch(() => {})
    log.check(await dlg.count() === 1, '在主项目里求助时，没有提醒进行中的变式验证')
    await page.getByRole('button', { name: '继续独立完成' }).click()
    s = await readStore(page)
    log.check(!Object.values(s.attempts).find((a) => a.taskId === 'farm-c').converted, '拒绝后变式仍被转成了辅助')
    await ctx.close()
  },

  async 'FR-07'(browser, base, log) {
    const { page, ctx } = await newPage(browser, base)
    await page.evaluate((key) => {
      const orig = Storage.prototype.setItem
      Storage.prototype.setItem = function (k, v) {
        if (window.__failSaves && k === key) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e }
        return orig.call(this, k, v)
      }
      window.__failSaves = true
    }, STORE_KEY)
    await page.click('[data-node="rRR"] circle')
    await page.waitForTimeout(800)
    log.check(await page.getAttribute('[data-testid="save-state"]', 'data-status') === 'failed', '存储失败时没有提示未保存')
    log.check(await page.locator('text=下载当前记录').count() === 1, '存储失败时没有提供下载入口')
    const dl = page.waitForEvent('download')
    await page.locator('text=下载当前记录').click()
    const file = await dl
    const pkg = JSON.parse(readFileSync(await file.path(), 'utf8'))
    log.check(pkg.judgements.length === 1, '下载的记录里没有刚才的作答')
    await page.evaluate(() => { window.__failSaves = false })
    await page.locator('text=重试保存').click()
    await page.waitForTimeout(300)
    log.check(await page.getAttribute('[data-testid="save-state"]', 'data-status') === 'saved', '重试保存后没有恢复')
    await ctx.close()
  },

  async 'AC-07/08/09/13 项目'(browser, base, log) {
    const { page, ctx, errors } = await newPage(browser, base, { path: '/?runTimeout=8' })
    await go(page, 'project')
    const setCode = async (code) => { await page.locator('[data-testid="code-editor"]').fill(code) }
    const run = async (label) => {
      await page.locator('[data-testid="run"]').click()
      await page.waitForFunction(() => {
        const s = document.querySelector('[data-testid="run-output"]')?.dataset.status
        return s && s !== 'running'
      }, null, { timeout: 240000 })
      const st = await page.getAttribute('[data-testid="run-output"]', 'data-status')
      log.note(`${label}：${st}`)
      return st
    }
    // The starter runs as shipped.
    log.check(await run('起始代码') === 'ok', '起始代码没有跑通')

    // A real error, read and fixed (FR-04).
    const header = `import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
from learnai import log_experiment
df = pd.read_csv("data/germination.csv")
target = "germinated"
`
    await setCode(`${header}features = ["tray", "soil_moisture", "temperature"]
X = df[features]
y = df[target]
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, random_state=42)
m = DecisionTreeClassifier(random_state=0).fit(X_train, y_train)
`)
    log.check(await run('带字符串列的代码') === 'error', '把字符串列喂给树应该报错')
    const errText = await page.locator('[data-testid="run-error"]').innerText().catch(() => '')
    log.check(/ValueError/.test(errText) && /第 \d+ 行/.test(errText), `报错没有显示类型和行号：${errText.slice(0, 80)}`)

    const good = (d = 4, leaf = 5) => `${header}features = ["soil_moisture", "temperature", "light_hours", "seed_weight", "sow_depth"]
X = df[features]
y = df[target]
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, random_state=42)
for name, kw in [("基线", {}), ("max_depth=${d}", {"max_depth": ${d}}), ("min_samples_leaf=${leaf}", {"min_samples_leaf": ${leaf}})]:
    m = DecisionTreeClassifier(random_state=0, **kw)
    m.fit(X_train, y_train)
    log_experiment(name, m, X_train, y_train, X_val, y_val)
`
    await setCode(good(4))
    log.check(await run('修好之后') === 'ok', '修好的代码没有跑通')
    // AC-07: change a parameter; the new run is shown with its version, the old rows are marked old.
    await setCode(good(3))
    log.check(await run('改参数之后') === 'ok', '改参数后没有跑通')
    const oldRows = await page.locator('[data-testid="experiments"] tr[data-old="1"]').count()
    const newRows = await page.locator('[data-testid="experiments"] tr[data-old="0"]').count()
    log.check(newRows === 3 && oldRows >= 3, `旧结果没有标成旧版本（当前 ${newRows} 行，旧 ${oldRows} 行）`)
    const out = await page.locator('[data-testid="run-output"]').innerText()
    log.check(/代码 v\d+/.test(out) && out.includes('germination-v1'), '运行结果没有标明代码和数据版本')

    // Timeout, then a clean re-run (AC-09).
    await setCode(`${header}while True:\n    pass\n`)
    log.check(await run('死循环') === 'timeout', '超时没有停止')
    await setCode(good(4))
    log.check(await run('超时后重跑') === 'ok', '超时后不能再次运行')

    // Help from the tutor during the main project: the project becomes assisted.
    await page.locator('[data-testid="hint"]').click()
    await tutorSettled(page)

    const store = await readStore(page)
    const runs = Object.values(store.project.runs).filter((r) => r.taskId === 'main' && r.status === 'ok' && r.report?.records?.length === 3)
    const lastRun = runs.at(-1)
    const rec = lastRun.report.records
    const f3 = (v) => v.toFixed(3)
    const best = rec.reduce((a, b) => (b.val_acc > a.val_acc ? b : a))
    const bestIdx = rec.indexOf(best)

    // AC-08: training score only, no real validation.
    await setCode(`${header}features = ["soil_moisture", "temperature", "light_hours", "seed_weight", "sow_depth"]
X = df[features]
y = df[target]
for name, kw in [("基线", {}), ("max_depth=4", {"max_depth": 4}), ("min_samples_leaf=5", {"min_samples_leaf": 5})]:
    m = DecisionTreeClassifier(random_state=0, **kw).fit(X, y)
    log_experiment(name, m, X, y, X, y)
`)
    log.check(await run('只有训练分数') === 'ok', '只用训练数据的代码没有跑通')
    await page.fill('[data-testid="form-target"]', 'germinated')
    await page.fill('[data-testid="form-roles"]', '都用来训练')
    await page.selectOption('[data-testid="form-chosen"]', '0')
    await page.fill('[data-testid="form-conclusion"]', '基线的训练准确率 1.000 最高，所以选它。')
    await page.locator('[data-testid="submit-project"]').click()
    await page.waitForSelector('[data-testid="grade"]', { timeout: 30000 })
    const dataMet = await page.getAttribute('[data-criterion="data"]', 'data-met')
    const dataText = await page.locator('[data-criterion="data"]').innerText()
    log.check(dataMet === 'false' && /验证/.test(dataText), `只提交训练分数时「数据使用」没有判为不通过并说明原因：${dataText.slice(0, 80)}`)
    log.check(await page.getAttribute('[data-criterion="explanation"]', 'data-met') === 'false', '只凭训练准确率的解释被判为成立')

    // The good submission: the good run, a conclusion that quotes its own records.
    await page.selectOption('select >> nth=0', lastRun.id)
    await page.fill('[data-testid="form-roles"]', '训练集用来拟合模型；验证集留在训练之外，用来在没见过的数据上比较不同设置、选模型。')
    await page.selectOption('[data-testid="form-chosen"]', String(bestIdx))
    const conclusion = `选「${best.name}」：验证准确率 ${f3(best.val_acc)}，是三种设置里最高的。基线训练准确率 ${f3(rec[0].train_acc)}、验证只有 ${f3(rec[0].val_acc)}，差距说明它过拟合了。取舍：复杂度更低、验证表现更好。`
    await page.fill('[data-testid="form-conclusion"]', conclusion)
    await page.locator('[data-testid="submit-project"]').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="grade"]')?.dataset.correct === 'true', null, { timeout: 30000 }).catch(() => {})
    const verdict = await page.getAttribute('[data-testid="grade"]', 'data-correct')
    if (verdict !== 'true') log.fail(`合理的提交没有通过：${(await page.locator('[data-testid="grade"]').innerText()).slice(0, 300)}`)
    log.check((await page.locator('[data-testid="grade"]').innerText()).includes('辅助完成'), '用过 AI 帮助的项目没有标为辅助完成')
    // The same submission again: one grade record.
    await page.locator('[data-testid="submit-project"]').click()
    await page.waitForTimeout(500)
    const graded = (await readStore(page)).judgements.filter((j) => j.activity === 'project')
    log.check(graded.length === 2, `相同提交生成了重复的评分记录（${graded.length} 条）`)

    // The submitted work can be looked at from its grade.
    await page.locator('[data-testid="submitted-work"] summary').click()
    const work = await page.locator('[data-testid="submitted-work"]').innerText()
    log.check(work.includes('germination.csv') && work.includes(conclusion.slice(0, 10)), '评分结果里看不到提交的代码和结论')

    // Reproduce the good run from its stored code.
    await page.locator('[data-testid="experiments"] button', { hasText: '复现' }).first().click()
    await page.waitForFunction(() => document.querySelector('[data-testid="run-output"]')?.dataset.status === 'ok', null, { timeout: 60000 })
    log.check(await page.locator('text=复现一致').count() > 0, '用保存的代码复现，结果不一致或没有比较')

    // AC-13: the independent variant on another farm's data.
    await page.locator('[data-testid="tab-variant"]').click()
    await page.locator('[data-testid="variant-start"]').click()
    await page.waitForTimeout(300)
    // Asking for help first asks; declining keeps the attempt independent.
    await page.locator('[data-testid="hint"]').click()
    await page.waitForSelector('[data-testid="confirm"]')
    await page.getByRole('button', { name: '继续独立完成' }).click()
    await page.waitForTimeout(300)
    let s = await readStore(page)
    const va = Object.values(s.attempts).find((a) => a.activity === 'project-verify')
    log.check(va && !va.converted && !va.assisted, '拒绝求助后，独立验证仍被标成了辅助')
    await setCode(`import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
from learnai import log_experiment
df = pd.read_csv("data/farm_b.csv")
features = ["soil_ph", "rain_mm", "avg_temp", "sun_hours", "seed_mass_mg"]
X = df[features]
y = df["sprouted"]
X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, random_state=42)
for name, kw in [("基线", {}), ("max_depth=4", {"max_depth": 4}), ("min_samples_leaf=10", {"min_samples_leaf": 10})]:
    m = DecisionTreeClassifier(random_state=0, **kw)
    m.fit(X_train, y_train)
    log_experiment(name, m, X_train, y_train, X_val, y_val)
`)
    log.check(await run('变式') === 'ok', '变式代码没有跑通')
    s = await readStore(page)
    const vrun = Object.values(s.project.runs).filter((r) => r.taskId === 'farm-b' && r.status === 'ok').at(-1)
    log.check(vrun?.dataVersion === 'farm-b-v1', '变式运行没有用变式的数据包')
    const vr = vrun.report.records
    const vbest = vr.reduce((a, b) => (b.val_acc > a.val_acc ? b : a))
    await page.fill('[data-testid="form-target"]', 'sprouted')
    await page.fill('[data-testid="form-roles"]', '训练集用来拟合；验证集不参与训练，只用来比较设置、挑模型。')
    await page.selectOption('[data-testid="form-chosen"]', String(vr.indexOf(vbest)))
    await page.fill('[data-testid="form-conclusion"]', `选「${vbest.name}」：验证准确率 ${f3(vbest.val_acc)} 最高。基线训练准确率 ${f3(vr[0].train_acc)}，验证 ${f3(vr[0].val_acc)}，差距说明过拟合。取舍：限制复杂度换来更好的验证表现。`)
    await page.locator('[data-testid="submit-project"]').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="grade"]')?.dataset.correct === 'true', null, { timeout: 30000 }).catch(() => {})
    const vgrade = await page.locator('[data-testid="grade"]').innerText()
    log.check(vgrade.includes('计入独立验证：通过'), `新变式没有独立通过：${vgrade.slice(0, 200)}`)
    log.check(await statusOf(page, 'project') === 'transfer', '导航里的项目状态没有显示新变式独立通过')

    // Export: the work, its runs and its grades, matching.
    const dl = page.waitForEvent('download')
    await page.locator('[data-testid="export"]').click()
    const pkg = JSON.parse(readFileSync(await (await dl).path(), 'utf8'))
    const pj = pkg.judgements.filter((j) => j.activity === 'project')
    const pv = pkg.judgements.filter((j) => j.activity === 'project-verify')
    log.check(pj.some((j) => j.assisted) && pv.some((j) => j.independent && j.correct), '导出里辅助项目和独立变式没有分开记录')
    const gradedRun = pkg.project.runs[pv.at(-1).answer.runId]
    log.check(gradedRun && pkg.project.code[gradedRun.codeHash]?.includes('farm_b.csv'), '导出的评分找不到对应的运行和代码')
    log.check(Boolean(pkg.observationScope) && Boolean(pkg.versions?.runtime), '导出缺少观测范围或版本信息')
    if (errors.length) log.fail(`console: ${errors[0]}`)
    await ctx.close()
  },
}

const { base, stop } = await startServer()
const browser = await chromium.launch()
const logs = []
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (only && !only.some((o) => name.includes(o))) continue
    const log = new Log(name)
    const t0 = Date.now()
    try {
      await fn(browser, base, log)
    } catch (err) {
      log.fail(`crashed: ${err.message.split('\n')[0]}`)
    }
    log.note(`${Math.round((Date.now() - t0) / 1000)} s`)
    logs.push(log)
  }
} finally {
  await browser.close()
  stop()
}
const failed = report(logs)
console.log(failed ? `\n${failed} problem(s) found.` : '\nAll acceptance paths passed.')
process.exit(failed ? 1 : 0)
