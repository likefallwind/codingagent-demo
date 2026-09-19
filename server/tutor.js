/**
 * The tutor: the only place a language model is allowed to speak to the learner.
 *
 * What it does NOT do is as important as what it does. It never decides what the
 * learner sees next (the policy does, deterministically), and it never decides
 * whether a lab action was correct (the CART code does, exactly). It is confined
 * to jobs that genuinely need language: judging a written answer against a
 * rubric, explaining a mistake the deterministic layer already detected, hinting
 * after a wrong choice, and answering a question or asking for a hint in context.
 *
 * Every request carries the learner's screen — what the lab is showing and the
 * question being answered — so the tutor talks about what the learner can see.
 * The same screen is the whitelist for numbers: every reply, streamed or not, is
 * checked against the course text plus the figures on screen before it reaches
 * the learner. A model told not to invent numbers invents them anyway.
 *
 * Every grading call is forced to choose a misconception from the catalogue the
 * course author wrote. A free-form diagnosis would be unusable: the learner model
 * counts misconceptions by id, and the policy routes remediation by id, so an
 * invented id is worse than none.
 */

import { chat, chatJSON, MODELS } from './minimax.js'
import { checkQuantities, redactUnknownFigures } from './factcheck.js'

// --- the learner's screen ----------------------------------------------------

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const strs = (v, n, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, max)) : [])

/**
 * The screen as the client reported it, reduced to bounded plain strings. It
 * comes from the browser, so it is sized before it goes anywhere near a prompt.
 */
export function cleanScreen(raw) {
  if (!raw || typeof raw !== 'object') return null
  const c = raw.check && typeof raw.check === 'object' ? raw.check : null
  return {
    focus: ['lab', 'check', 'explain'].includes(raw.focus) ? raw.focus : 'explain',
    doing: str(raw.doing, 200),
    facts: strs(raw.facts, 40, 240),
    check: c ? {
      id: str(c.id, 80),
      kind: str(c.kind, 20),
      prompt: str(c.prompt, 400),
      table: strs(c.table, 12, 200),
      eliminated: strs(c.eliminated, 6, 200),
      draft: str(c.draft, 400),
    } : null,
  }
}

function screenLines(screen) {
  if (!screen) return []
  const lines = []
  const where = { lab: '实验', check: '题目', explain: '讲解' }[screen.focus]
  lines.push(`学生此刻的注意力在：${where}`)
  if (screen.doing) lines.push(`学生在实验里：${screen.doing}`)
  if (screen.facts.length) {
    lines.push('实验界面上此刻显示的数字（系统精确计算，可以直接引用）：')
    for (const f of screen.facts) lines.push(`- ${f}`)
  }
  if (screen.check) {
    lines.push(`学生正在做的题：${screen.check.prompt}`)
    if (screen.check.table.length) lines.push(`题目里的表格：\n${screen.check.table.join('\n')}`)
    if (screen.check.eliminated.length) lines.push(`他已经选错、排除掉的选项：${screen.check.eliminated.join('；')}`)
    if (screen.check.draft) lines.push(`他写到一半的回答：${screen.check.draft}`)
  }
  return lines
}

/** Compact the learner's situation into the few lines the model actually needs. */
function contextBlock({ concept, learner, misconceptionHistory, screen }) {
  const lines = [
    `当前概念：${concept.title}`,
    `学习目标：${concept.objectives.join('；')}`,
  ]
  if (learner) {
    lines.push(`该概念掌握度估计：${Math.round(learner.mastery * 100)}%（尝试 ${learner.attempts} 次，对 ${learner.correct} 次）`)
  }
  if (misconceptionHistory?.length) {
    lines.push(`此前已暴露的误解：${misconceptionHistory.join('、')}`)
  }
  lines.push(...screenLines(screen))
  return lines.join('\n')
}

/**
 * The concrete, already-verified facts of this concept.
 *
 * Without these the model invents plausible-sounding but generic advice ("try it
 * on a test set"). With them it can point at the number the learner can actually
 * see on screen. The corrections are included because they were written by the
 * author to be said to a learner holding that belief.
 */
function citableFacts(concept) {
  const parts = [concept.explain.example]
  for (const m of concept.misconceptions ?? []) parts.push(m.correction)
  return parts.filter(Boolean).map((t) => `- ${t}`).join('\n')
}

/** Every string a check puts in front of the learner, generated ones included. */
function checkText(c) {
  if (!c) return ''
  return [
    c.prompt, c.explain, c.rubric,
    ...(c.options ?? []).map((o) => o.text),
    ...(c.table?.rows ?? []).map((r) => r.join(' ')),
    ...(c.facts ?? []),
  ].filter(Boolean).join('\n')
}

/**
 * The full body of text a reply may draw figures from: what the author wrote,
 * what the learner can see on screen, and whatever the learner themselves said.
 * A learner quoting a number back is fair to echo even if the course does not
 * carry it.
 */
export function allowedFigureSource(concept, { screen, check, extra } = {}) {
  return [
    concept.explain.intuition,
    concept.explain.example,
    concept.explain.formal,
    ...(concept.misconceptions ?? []).map((m) => m.correction),
    ...(concept.checks ?? []).map(checkText),
    checkText(check),
    screen?.doing,
    ...(screen?.facts ?? []),
    screen?.check?.prompt,
    ...(screen?.check?.table ?? []),
    ...(screen?.check?.eliminated ?? []),
    screen?.check?.draft,
    extra,
  ].filter(Boolean).join('\n')
}

/** Render the author's misconception catalogue as the grader's closed choice set. */
function misconceptionMenu(concept) {
  if (!concept.misconceptions?.length) return '（本概念没有登记误解，misconception_id 一律填空字符串）'
  return concept.misconceptions
    .map((m) => `- ${m.id}：学生以为「${m.belief}」。识别线索：${m.cue}`)
    .join('\n')
}

/**
 * The text of a check's right answer that a hint must not repeat, or null.
 *
 * "0.500——…" style options carry the answer before the dash. A key the question
 * itself already shows cannot leak anything, and a very short one ("A") would
 * reject every reply that merely mentions it, so neither is policed.
 */
export function answerKey(check) {
  const right = check?.options?.find((o) => o.correct)
  const key = right?.text?.split('——')[0].trim() ?? ''
  const shown = [check?.prompt, ...(check?.table?.rows ?? []).map((r) => r.join(' '))].join('\n')
  if (key.length < 4 || shown.includes(key)) return null
  return key
}

/**
 * Cut an over-long reply back to whole sentences within `max` characters, or
 * null if that leaves too little to be worth showing. The model overshoots a
 * length limit on both tries often enough that failing outright — and showing
 * the learner an error after a mistake — was the common case, while its first
 * two or three sentences are almost always the useful part.
 */
export function trimToSentences(text, max) {
  const t = (text ?? '').trim()
  if (t.length <= max) return t
  let out = ''
  for (const part of t.match(/[^。！？!?]+[。！？!?]?/g) ?? [t]) {
    if ((out + part).length > max) break
    out += part
  }
  return out.length >= 20 ? out : null
}

/** A chatJSON `repair` that trims `feedback` to fit. */
const trimFeedback = (max) => (v) => {
  const feedback = typeof v?.feedback === 'string' ? trimToSentences(v.feedback, max) : null
  return feedback ? { ...v, feedback } : null
}

/**
 * The grader's `repair`: besides trimming, a "misconception" the model cannot
 * name from the catalogue is demoted to "incorrect". The model reliably spots
 * that an answer holds *a* wrong belief even when it is not one the author
 * listed, and insists on the label twice; the learner model can only use a
 * catalogued id, so the honest verdict is simply "wrong".
 */
export const repairGrade = (concept, max) => (v) => {
  const ids = (concept.misconceptions ?? []).map((m) => m.id)
  let out = v
  if (out?.verdict === 'misconception' && !ids.includes(out.misconception_id)) {
    out = { ...out, verdict: 'incorrect', misconception_id: '' }
  }
  if (out?.misconception_id && !ids.includes(out.misconception_id)) out = { ...out, misconception_id: '' }
  return trimFeedback(max)(out)
}

const GRADE_SCHEMA = `{
  "verdict": "correct" | "partial" | "misconception" | "incorrect",
  "misconception_id": "上面列表里的 id，或空字符串",
  "feedback": "直接说给学生听的话，中文，2-4 句",
  "evidence": "学生原话里让你做出这个判断的那一小段",
  "confidence": 0.0 到 1.0 的数字
}`

/**
 * Grade a written answer.
 *
 * `verdict` drives the learner model, so the prompt spends most of its budget
 * pinning down what each value means. "partial" exists so that a learner who has
 * the right idea but states it incompletely is not lumped in with one who holds a
 * wrong belief — those two need different next steps.
 */
export async function gradeAnswer({ concept, check, answer, learner, misconceptionHistory, screen, signal }) {
  const system = `你是一位严格但不刻薄的助教，正在批改一道关于「${concept.title}」的简答题。

${contextBlock({ concept, learner, misconceptionHistory, screen })}

题目：${check.prompt}

评分标准（作者撰写，以此为准，不要自行加码）：
${check.rubric}

本概念登记在案的误解：
${misconceptionMenu(concept)}

判定规则：
- correct：命中评分标准要求的要点。表述不漂亮、不完整但抓住了关键，仍算 correct。
- partial：方向对但缺了评分标准明确要求的要点，或理由说不清楚。
- misconception：答案反映出上面列表里的某个错误信念。此时 misconception_id 必须填该 id。
- incorrect：答错了，但不对应上面列表里的任何一条。misconception_id 填空字符串。

可以引用的事实（已由系统精确计算并核对，直接用，不要改动数字，也不要自己编新数字）：
${citableFacts(concept)}

写 feedback 的要求：
- 直接对学生说话，用「你」。不要写「该学生」。
- 答错时，先指出他实际上在想什么，再说为什么不成立，最后给一个能自己验证的具体动作或数字——优先引用上面那些真实数字和他实验界面上的数字，不要说「拿去测试集跑一遍」这类空泛建议。
- 不要重复题目，不要客套，不要用「很好的问题」这类开场。
- 答对时不要吹捧，补一个他可能还没想到的点。
- 严格控制在 2-4 句、150 字以内。宁可少说，不要铺开讲。
- 全程中文，不要夹杂英文单词。

misconception_id 只能从上面列表里选，或填空字符串。绝对不要自己发明 id。`

  return chatJSON(
    [{ role: 'system', content: system }, { role: 'user', content: `学生的回答：\n${answer}` }],
    {
      schemaHint: GRADE_SCHEMA,
      model: MODELS.interactive,
      maxTokens: 3000,
      temperature: 0.2,
      signal,
      repair: repairGrade(concept, 220),
      validate: (v) => {
        if (!['correct', 'partial', 'misconception', 'incorrect'].includes(v.verdict)) return 'verdict 必须是 correct/partial/misconception/incorrect'
        if (typeof v.feedback !== 'string' || v.feedback.trim().length < 10) return 'feedback 太短或缺失'
        // The model reliably overshoots when a learner is partly right. Reject
        // runaway answers rather than showing a wall of text in a 292px panel.
        if (v.feedback.trim().length > 220) return `feedback 太长（${v.feedback.trim().length} 字），必须压到 150 字以内`
        const ids = (concept.misconceptions ?? []).map((m) => m.id)
        if (v.misconception_id && !ids.includes(v.misconception_id)) {
          return `misconception_id "${v.misconception_id}" 不在允许的列表里：${ids.join(', ')}`
        }
        if (v.verdict === 'misconception' && !v.misconception_id) return 'verdict 为 misconception 时必须给出 misconception_id'
        // Asked not to invent figures, the model does anyway. Enforce it.
        return checkQuantities(v.feedback, allowedFigureSource(concept, { screen, check, extra: answer }))
      },
    },
  )
}

/**
 * Explain a mistake the lab has already detected.
 *
 * The deterministic layer supplies the facts; the model's only job is to say
 * why the learner might have gone that way. It is told the numbers rather than
 * asked to derive them, because it gets arithmetic wrong and the numbers are
 * already known exactly.
 */
export async function diagnoseLabAction({ concept, action, learner, misconceptionHistory, screen, signal }) {
  const system = `你是一位助教，学生正在「${concept.title}」的交互实验里操作。

${contextBlock({ concept, learner, misconceptionHistory, screen })}

本概念登记在案的误解：
${misconceptionMenu(concept)}

以下事实由系统精确计算得出，你必须原样采信，不要重新计算、不要质疑：
${action.facts.map((f) => `- ${f}`).join('\n')}

本节其他可引用的事实：
${citableFacts(concept)}

学生的操作：${action.description}

你的任务：解释学生为什么可能会这么选，而不是复述他选错了。如果他的操作对应上面某个误解，给出该 id。
${action.retry ? '他马上要在同一个地方再试一次。不要替他说出正确答案是哪一个，只指出他的想法哪里站不住、该去看界面上的什么。\n' : ''}feedback 写 2-3 句、120 字以内，中文不夹英文，直接对学生说，落脚在一个他可以立刻在界面上验证的具体动作。`

  return chatJSON(
    [{ role: 'system', content: system }, { role: 'user', content: '请诊断。' }],
    {
      schemaHint: GRADE_SCHEMA,
      model: MODELS.interactive,
      maxTokens: 2500,
      temperature: 0.3,
      signal,
      repair: repairGrade(concept, 180),
      validate: (v) => {
        if (!['correct', 'partial', 'misconception', 'incorrect'].includes(v.verdict)) return 'verdict 取值非法'
        if (typeof v.feedback !== 'string' || v.feedback.trim().length < 10) return 'feedback 太短'
        if (v.feedback.trim().length > 180) return `feedback 太长（${v.feedback.trim().length} 字），压到 120 字以内`
        const ids = (concept.misconceptions ?? []).map((m) => m.id)
        if (v.misconception_id && !ids.includes(v.misconception_id)) return `misconception_id 不在列表里`
        return checkQuantities(v.feedback, allowedFigureSource(concept, { screen, extra: `${action.facts.join('\n')}\n${action.description ?? ''}` }))
      },
    },
  )
}

/**
 * A nudge after a wrong multiple-choice pick.
 *
 * The learner is about to choose again, so the one thing this must not do is
 * name the right option — that would turn the retry into copying. The model is
 * told which option is correct so it can aim the hint, and the validator rejects
 * any reply that repeats the correct option's text.
 */
export async function hintForWrongChoice({ concept, check, choice, learner, misconceptionHistory, screen, signal }) {
  const picked = check.options[choice]
  const right = check.options.find((o) => o.correct)
  const table = check.table ? `\n题目里的表格：\n${[check.table.columns.join(' | '), ...check.table.rows.map((r) => r.join(' | '))].join('\n')}` : ''
  const system = `你是一位助教。学生在一道关于「${concept.title}」的选择题上选错了，马上要再选一次。

${contextBlock({ concept, learner, misconceptionHistory, screen })}

题目：${check.prompt}${table}
选项：
${check.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join('\n')}

学生选了：${picked.text}
正确答案（只给你看，绝对不能告诉学生，也不能暗示是哪个字母）：${right.text}
${check.explain ? `答案背后的道理（只给你看）：${check.explain}` : ''}

本概念登记在案的误解：
${misconceptionMenu(concept)}

本节可引用的事实：
${citableFacts(concept)}

你的任务：说清楚学生选的这个选项为什么站不住，再给一个能帮他自己想出正确答案的线索。
- 不要说出正确选项的内容，不要说「应该选某某」。
- 2-3 句、100 字以内，中文不夹英文，直接对学生说，不要开场白。`

  return chatJSON(
    [{ role: 'system', content: system }, { role: 'user', content: '请给提示。' }],
    {
      schemaHint: `{ "feedback": "直接说给学生听的提示，中文，2-3 句" }`,
      model: MODELS.interactive,
      maxTokens: 2000,
      temperature: 0.3,
      signal,
      repair: trimFeedback(160),
      validate: (v) => {
        if (typeof v.feedback !== 'string' || v.feedback.trim().length < 10) return 'feedback 太短或缺失'
        if (v.feedback.trim().length > 160) return `feedback 太长（${v.feedback.trim().length} 字），压到 100 字以内`
        const key = answerKey(check)
        if (key && v.feedback.includes(key)) return `feedback 泄露了正确答案「${key}」，只给线索，不要说出答案`
        // The right answer's own figure is deliberately excluded: echoing it is
        // the leak the check above exists to stop, just spelled as a number.
        return checkQuantities(v.feedback, allowedFigureSource(concept, { screen, check: { ...check, explain: '', facts: [], options: check.options.filter((o) => !o.correct) } }))
      },
    },
  )
}

// --- free-form replies, checked before they are sent -------------------------

/** Strip the markdown a chat model reaches for even when told not to. */
function tidy(text) {
  return (text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Generate in full, check, and only then yield.
 *
 * Streaming token by token would put an invented figure on screen before the
 * check could see it, and the reasoning models behind this adapter think first
 * and then emit the answer in a few large chunks anyway — so buffering costs the
 * learner almost nothing. A rejected reply is regenerated once with the problem
 * quoted; if that also fails, the offending sentences are dropped.
 */
async function* checkedReply(messages, { allowed, forbidden, model, maxTokens, temperature, signal }) {
  const problemOf = (text) => {
    if (!text) return '回答是空的'
    if (forbidden && text.includes(forbidden)) return `回答直接说出了他正在做的题的答案「${forbidden}」，只能给思路`
    return checkQuantities(text, allowed)
  }

  let text = tidy(await chat(messages, { model, maxTokens, temperature, signal }))
  let problem = problemOf(text)
  if (problem) {
    const retry = [
      ...messages,
      { role: 'assistant', content: text.slice(0, 1500) },
      { role: 'user', content: `上面的回答不能用：${problem}。请重写，只引用给定材料里的数字。` },
    ]
    text = tidy(await chat(retry, { model, maxTokens, temperature, signal }))
    problem = problemOf(text)
    if (problem) {
      text = redactUnknownFigures(text, allowed)
      if (forbidden && text.includes(forbidden)) text = ''
    }
  }
  if (!text) throw new Error('这次没能给出可靠的回答，换个问法再问一次')
  yield text
}

/** If the learner is on a multiple-choice question, the text that must not appear in a reply. */
function forbiddenAnswer(screenCheck, check) {
  if (!screenCheck || check?.kind !== 'mcq') return null
  return answerKey(check)
}

/**
 * Answer a learner's own question.
 *
 * Given the concept, the learner's state and their screen so the answer can be
 * pitched at them — and told not to run ahead of where they are, which is the
 * most common way a capable model makes a lesson worse.
 */
export function answerQuestion({
  concept, question, learner, misconceptionHistory, screen, check, courseTitle, upcoming, signal,
}) {
  const system = `你是「${courseTitle}」这门课的 AI 老师，学生正在学「${concept.title}」这一节。

${contextBlock({ concept, learner, misconceptionHistory, screen })}

本节的讲解要点（不要超出这个范围太远）：
${concept.explain.intuition}

本节可以引用的事实：
${citableFacts(concept)}

${upcoming?.length ? `学生还没学到的内容（可以提一句「后面会讲」，但不要展开）：${upcoming.join('、')}` : ''}

回答要求：
- 中文，直接说，不要开场白，不要「这是个好问题」。
- 控制在 3-5 句。学生在动手做实验，不是在读教材。
- 优先结合他此刻在界面上看到的东西回答；引用数字只能用上面给出的数字，没有就不要提数字。
- 如果他问的是正在做的那道题，只帮他理清思路，绝不直接说出答案或暗示是哪个选项。
- 如果问题超出本节范围，简短回答并说明后面哪一步会讲到。
- 不要输出 markdown 标题或列表符号，就写成自然的几句话。
- 全程中文，不要夹杂英文单词。`

  return checkedReply(
    [{ role: 'system', content: system }, { role: 'user', content: question }],
    {
      allowed: allowedFigureSource(concept, { screen, extra: question }),
      forbidden: forbiddenAnswer(screen?.check, check),
      model: MODELS.interactive, maxTokens: 2500, temperature: 0.5, signal,
    },
  )
}

/**
 * A hint for the learner who is stuck, pitched by how much they have struggled
 * and aimed at whatever they are looking at.
 *
 * Deliberately graded: an early hint points at where to look, a later one gives
 * the reasoning. Handing over the answer on the first ask removes the work the
 * hint exists to support.
 */
export function generateHint({ concept, learner, attemptsInStep, misconceptionHistory, screen, check, signal }) {
  const level = attemptsInStep >= 3 ? 'strong' : attemptsInStep >= 1 ? 'medium' : 'light'
  const levelRule = {
    light: '只指出该往哪里看、该注意界面上的哪个数字。不要给结论。',
    medium: '给出推理的方向和一个关键观察，但把最后一步留给学生。',
    strong: '把推理过程讲清楚，可以接近答案，但仍然让学生自己完成最后的操作。',
  }[level]
  const target = screen?.focus === 'check' && screen.check
    ? '学生卡在上面那道题上。提示针对这道题，绝不直接说出答案或暗示是哪个选项。'
    : '学生在实验里。提示针对他此刻在实验界面上看到的东西。'

  const system = `你是「${concept.title}」这一节的 AI 老师，学生点了「给我一个提示」。

${contextBlock({ concept, learner, misconceptionHistory, screen })}

本节讲解要点：
${concept.explain.intuition}

${target}
提示强度：${level}。${levelRule}

写 2-4 句、150 字以内，中文不夹英文，直接对学生说，不要开场白，不要 markdown 符号。引用界面上能看到的具体东西；引用数字只能用上面给出的数字。`

  return checkedReply(
    [{ role: 'system', content: system }, { role: 'user', content: '给我一个提示。' }],
    {
      allowed: allowedFigureSource(concept, { screen }),
      forbidden: screen?.focus === 'check' ? forbiddenAnswer(screen?.check, check) : null,
      model: MODELS.interactive, maxTokens: 2200, temperature: 0.45, signal,
    },
  )
}
