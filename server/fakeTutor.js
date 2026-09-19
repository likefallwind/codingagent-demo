/**
 * A stand-in for the model, for tests and offline demos: `LEARNAI_FAKE_LLM=1`.
 *
 * Same functions and shapes as tutor.js, deterministic, no network. It exists
 * so the browser walkthroughs can exercise every path that depends on the
 * tutor — grading, hints, questions, the project's written part, failures and
 * slow replies — without an API key. It says nothing about the real model's
 * grading quality; that is checked with fixed samples and human review.
 *
 * Markers in the learner's text steer it:
 *   【对】 correct   【部分】 partial   【误解】 misconception   【错】 incorrect
 *   【不确定】 low confidence   【故障】 the call fails   【无效】 an invalid reply
 *   【故障一次】 the first call with this text fails, later ones succeed
 *   【慢】 a four-second delay (for "reply arrives after the task changed")
 *   【超时】 no reply until aborted (for the deadline; set LEARNAI_MODEL_DEADLINE_MS low)
 * Without a marker a written answer of 20+ characters is graded correct.
 */

import { HINT_LEVEL_RULES } from './tutor.js'

const DELAY_MS = Number(process.env.LEARNAI_FAKE_DELAY_MS ?? 250)

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) }, { once: true })
  })
}

/** Texts that have already failed once under 【故障一次】. */
const failedOnce = new Set()

async function behave(text, signal) {
  const t = String(text ?? '')
  await wait(t.includes('【超时】') ? 10 * 60 * 1000 : t.includes('【慢】') ? 4000 : DELAY_MS, signal)
  if (t.includes('【故障】')) throw new Error('模拟的模型故障')
  if (t.includes('【无效】')) throw new Error('模型两次都没有返回有效的格式')
  if (t.includes('【故障一次】') && !failedOnce.has(t)) {
    failedOnce.add(t)
    throw new Error('模拟的模型故障（只这一次）')
  }
}

export async function gradeAnswer({ concept, check, answer, signal }) {
  await behave(answer, signal)
  const has = (m) => answer.includes(m)
  const verdict = has('【误解】') ? 'misconception' : has('【部分】') ? 'partial' : has('【错】') ? 'incorrect'
    : has('【对】') ? 'correct' : answer.trim().length >= 20 ? 'correct' : 'incorrect'
  const misconception_id = verdict === 'misconception' ? (check.misconceptions?.[0] ?? concept.misconceptions?.[0]?.id ?? '') : ''
  const points = (check.points ?? []).map((text, i) => ({
    text, met: verdict === 'correct' ? true : verdict === 'partial' ? i === 0 : false,
  }))
  return {
    verdict: verdict === 'misconception' && !misconception_id ? 'incorrect' : verdict,
    misconception_id,
    feedback: verdict === 'correct'
      ? '抓住了关键。再想一想：换一批数据，这个结论还成立吗？'
      : '你的回答还缺一个关键理由。对照上面的讲解和实验里显示的结果，再说清楚为什么。',
    evidence: answer.slice(0, 40),
    confidence: has('【不确定】') ? 0.3 : 0.9,
    points,
  }
}

export async function diagnoseLabAction({ action, signal }) {
  await behave(action.description, signal)
  return {
    verdict: 'incorrect', misconception_id: '',
    feedback: '对照刚刚显示出来的结果，看看它和你的判断差在哪一步，再想想是什么让你那样选的。',
  }
}

export async function hintForWrongChoice({ signal }) {
  await behave('', signal)
  return { feedback: '这个选项站不住：回到题目给出的条件，一条一条对照着看，哪一条和它矛盾？' }
}

export async function* answerQuestion({ question, history = [], screen, signal }) {
  await behave(question, signal)
  const earlier = screen?.previous?.length ? `你之前看到的是「${screen.previous.at(-1).doing}」，现在是「${screen.doing}」。` : ''
  const followUp = history.length ? '接着刚才说的：' : ''
  yield `${followUp}${earlier}这个问题可以从界面上正在显示的结果入手，先看它和你预期的差在哪里。`
}

export async function* generateHint({ level = 1, history = [], signal }) {
  await behave('', signal)
  const lv = Number.isInteger(level) ? level : 1
  const rule = HINT_LEVEL_RULES[lv] ?? HINT_LEVEL_RULES[1]
  yield `（第 ${lv} 级提示${history.length ? '，接着上一条' : ''}）${rule.slice(0, 18)}……先盯住界面上和这一步有关的那个结果。`
}

export async function gradeProjectExplanation({ project, roles, conclusion, signal }) {
  await behave(`${roles}\n${conclusion}`, signal)
  const text = `${roles}\n${conclusion}`
  const tests = {
    roles: /训练/.test(roles) && /验证/.test(roles),
    select: /验证/.test(conclusion) && !/训练准确率最高.*所以/.test(conclusion),
    gap: /差距|过拟合|差距|训练.*高|泛化/.test(text),
    tradeoff: /取舍|权衡|局限|简单|复杂/.test(text),
  }
  return {
    points: project.explanationPoints.map((p) => ({ id: p.id, text: p.text, required: p.required, met: Boolean(tests[p.id]), reason: tests[p.id] ? '写到了' : '没有写到' })),
    feedback: tests.select ? '选择的依据落在验证表现上，理由基本成立。' : '结论要说明你依据哪一组验证结果做的选择。',
    confidence: text.includes('【不确定】') ? 0.3 : 0.9,
  }
}
