/**
 * The tutor: the only place a language model is allowed to speak to the learner.
 *
 * What it does NOT do is as important as what it does. It never decides what the
 * learner sees next (the policy does, deterministically), and it never decides
 * whether a lab action was correct (the CART code does, exactly). It is confined
 * to three jobs that genuinely need language: judging a written answer against a
 * rubric, explaining a mistake the deterministic layer already detected, and
 * answering a question in context.
 *
 * Every grading call is forced to choose a misconception from the catalogue the
 * course author wrote. A free-form diagnosis would be unusable: the learner model
 * counts misconceptions by id, and the policy routes remediation by id, so an
 * invented id is worse than none. `misconception_id` must be one of the offered
 * ids or the empty string.
 */

import { chatJSON, chatStream, MODELS } from './minimax.js'
import { checkQuantities } from './factcheck.js'

/** Compact the learner's situation into the few lines the model actually needs. */
function contextBlock({ concept, learner, misconceptionHistory }) {
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

/**
 * The full body of text a reply may draw figures from: what the author wrote,
 * plus whatever the learner themselves said. A learner quoting a number back is
 * fair to echo even if the course text does not carry it.
 */
function allowedFigureSource(concept, extra = '') {
  return [
    concept.explain.intuition,
    concept.explain.example,
    concept.explain.formal,
    ...(concept.misconceptions ?? []).map((m) => m.correction),
    ...(concept.checks ?? []).map((c) => `${c.prompt} ${c.explain ?? ''} ${c.rubric ?? ''}`),
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

const GRADE_SCHEMA = `{
  "verdict": "correct" | "partial" | "misconception",
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
export async function gradeAnswer({ concept, check, answer, learner, misconceptionHistory, signal }) {
  const system = `你是一位严格但不刻薄的助教，正在批改一道关于「${concept.title}」的简答题。

${contextBlock({ concept, learner, misconceptionHistory })}

题目：${check.prompt}

评分标准（作者撰写，以此为准，不要自行加码）：
${check.rubric}

本概念登记在案的误解：
${misconceptionMenu(concept)}

判定规则：
- correct：命中评分标准要求的要点。表述不漂亮、不完整但抓住了关键，仍算 correct。
- partial：方向对但缺了评分标准明确要求的要点，或理由说不清楚。
- misconception：答案反映出上面列表里的某个错误信念。此时 misconception_id 必须填该 id。

可以引用的事实（已由系统精确计算并核对，直接用，不要改动数字，也不要自己编新数字）：
${citableFacts(concept)}

写 feedback 的要求：
- 直接对学生说话，用「你」。不要写「该学生」。
- 答错时，先指出他实际上在想什么，再说为什么不成立，最后给一个能自己验证的具体动作或数字——优先引用上面那些真实数字，不要说「拿去测试集跑一遍」这类空泛建议。
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
      validate: (v) => {
        if (!['correct', 'partial', 'misconception'].includes(v.verdict)) return 'verdict 必须是 correct/partial/misconception'
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
        const figures = checkQuantities(v.feedback, allowedFigureSource(concept, answer))
        if (figures) return figures
        return null
      },
    },
  )
}

/**
 * Explain a mistake the lab has already detected.
 *
 * The deterministic layer supplies `observed` and `expected` as computed facts;
 * the model's only job is to say why the learner might have gone that way. It is
 * told the numbers rather than asked to derive them, because it gets arithmetic
 * wrong and the numbers are already known exactly.
 */
export async function diagnoseLabAction({ concept, action, learner, misconceptionHistory, signal }) {
  const system = `你是一位助教，学生正在「${concept.title}」的交互实验里操作。

${contextBlock({ concept, learner, misconceptionHistory })}

本概念登记在案的误解：
${misconceptionMenu(concept)}

以下事实由系统精确计算得出，你必须原样采信，不要重新计算、不要质疑：
${action.facts.map((f) => `- ${f}`).join('\n')}

本节其他可引用的事实：
${citableFacts(concept)}

学生的操作：${action.描述 ?? action.description}

你的任务：解释学生为什么可能会这么选，而不是复述他选错了。如果他的操作对应上面某个误解，给出该 id。
feedback 写 2-3 句、120 字以内，中文不夹英文，直接对学生说，落脚在一个他可以立刻在界面上验证的具体动作。`

  return chatJSON(
    [{ role: 'system', content: system }, { role: 'user', content: '请诊断。' }],
    {
      schemaHint: GRADE_SCHEMA,
      model: MODELS.interactive,
      maxTokens: 2500,
      temperature: 0.3,
      signal,
      validate: (v) => {
        if (!['correct', 'partial', 'misconception'].includes(v.verdict)) return 'verdict 取值非法'
        if (typeof v.feedback !== 'string' || v.feedback.trim().length < 10) return 'feedback 太短'
        if (v.feedback.trim().length > 180) return `feedback 太长（${v.feedback.trim().length} 字），压到 120 字以内`
        const ids = (concept.misconceptions ?? []).map((m) => m.id)
        if (v.misconception_id && !ids.includes(v.misconception_id)) return `misconception_id 不在列表里`
        const figures = checkQuantities(v.feedback, allowedFigureSource(concept, action.facts.join('\n')))
        if (figures) return figures
        return null
      },
    },
  )
}

/**
 * Answer a learner's own question, streamed.
 *
 * Given the concept and the learner's state so the answer can be pitched at them
 * — and told not to run ahead of where they are, which is the most common way a
 * capable model makes a lesson worse.
 */
export function answerQuestion({ concept, question, learner, misconceptionHistory, courseTitle, upcoming, signal }) {
  const system = `你是「${courseTitle}」这门课的 AI 老师，学生正在学「${concept.title}」这一节。

${contextBlock({ concept, learner, misconceptionHistory })}

本节的讲解要点（不要超出这个范围太远）：
${concept.explain.intuition}

${upcoming?.length ? `学生还没学到的内容（可以提一句「后面会讲」，但不要展开）：${upcoming.join('、')}` : ''}

回答要求：
- 中文，直接说，不要开场白，不要「这是个好问题」。
- 控制在 3-5 句。学生在动手做实验，不是在读教材。
- 能引用界面上的具体数字或操作就引用。
- 如果问题超出本节范围，简短回答并说明后面哪一步会讲到。
- 不要输出 markdown 标题或列表符号，就写成自然的几句话。
- 全程中文，不要夹杂英文单词。`

  return chatStream(
    [{ role: 'system', content: system }, { role: 'user', content: question }],
    { model: MODELS.interactive, maxTokens: 2000, temperature: 0.5, signal },
  )
}

/**
 * A hint for the learner who is stuck, pitched by how much they have struggled.
 *
 * Deliberately graded: an early hint points at where to look, a later one gives
 * the reasoning. Handing over the answer on the first ask removes the work the
 * hint exists to support.
 */
export function generateHint({ concept, learner, attemptsInStep, misconceptionHistory, labState, signal }) {
  const level = attemptsInStep >= 3 ? 'strong' : attemptsInStep >= 1 ? 'medium' : 'light'
  const levelRule = {
    light: '只指出该往哪里看、该注意界面上的哪个数字。不要给结论。',
    medium: '给出推理的方向和一个关键观察，但把最后一步留给学生。',
    strong: '把推理过程讲清楚，可以接近答案，但仍然让学生自己完成最后的操作。',
  }[level]

  const system = `你是「${concept.title}」这一节的 AI 老师，学生点了「给我一个提示」。

${contextBlock({ concept, learner, misconceptionHistory })}
${labState ? `\n学生当前在实验里的状态：${labState}` : ''}

本节讲解要点：
${concept.explain.intuition}

提示强度：${level}。${levelRule}

写 2-4 句、150 字以内，中文不夹英文，直接对学生说，不要开场白，不要 markdown 符号。引用界面上能看到的具体东西。`

  return chatStream(
    [{ role: 'system', content: system }, { role: 'user', content: '给我一个提示。' }],
    { model: MODELS.interactive, maxTokens: 1800, temperature: 0.45, signal },
  )
}
