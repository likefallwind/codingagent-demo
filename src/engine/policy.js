/**
 * The pedagogical policy — what the learner gets next.
 *
 * Deliberately rule-based, with no LLM in the loop. Three reasons: it must be
 * instant (it runs on every interaction), it must be deterministic (the same
 * state always yields the same next step, so the experience is debuggable), and
 * it must be explainable (the UI tells the learner *why* they are being shown
 * this). The LLM's job is to author the words inside a step, never to choose it.
 */

import { topoOrder } from './schema.js'
import {
  conceptStatus, activeMisconceptions, MASTERY_THRESHOLD, STRUGGLING_THRESHOLD,
} from './learnerModel.js'

/** Explanation layers, in the order a struggling learner falls back through. */
export const LAYERS = ['intuition', 'example', 'formal']

/** Checks the learner has not yet answered correctly, in course order. */
export function openChecks(learner, concept) {
  const state = learner.concepts[concept.id]
  const passed = new Set(
    (state?.evidence ?? []).filter((e) => e.correct && e.detail?.checkId).map((e) => e.detail.checkId),
  )
  return (concept.checks ?? []).filter((c) => !passed.has(c.id))
}

/**
 * The check to re-ask once every check has been passed but mastery is still short.
 *
 * A wrong answer followed by a retry leaves the check passed yet the estimate
 * lowered, so "all checks passed" does not imply "mastered". Without somewhere
 * to earn more evidence the learner is stranded — labs like the tree reader lock
 * once solved. First come checks never passed on a fresh attempt (a correct
 * answer straight after a wrong one on the same check is a retry, not a clean
 * pass); after that, the least recently attempted check, so there is always a
 * next question.
 */
export function reviewCheck(learner, concept) {
  const checks = concept.checks ?? []
  if (checks.length === 0) return null
  const evidence = learner.concepts[concept.id]?.evidence ?? []
  const history = (id) => evidence.filter((e) => e.detail?.checkId === id && typeof e.correct === 'boolean')

  const unclean = checks.find((c) => {
    const h = history(c.id)
    return !h.some((e, i) => e.correct && (i === 0 || h[i - 1].correct))
  })
  if (unclean) return unclean

  const lastSeen = (id) => history(id).at(-1)?.ts ?? 0
  return checks.reduce((a, b) => (lastSeen(b.id) < lastSeen(a.id) ? b : a))
}

/** True once the learner has made at least one real attempt in the concept's lab. */
export function labAttempted(learner, conceptId) {
  return (learner.concepts[conceptId]?.evidence ?? []).some((e) => e.kind === 'labAction')
}

/** The next concept that is unlocked and not yet mastered, in prerequisite order. */
export function nextConcept(learner, course) {
  return topoOrder(course.concepts).find((c) => {
    const s = conceptStatus(learner, course, c.id)
    return s === 'available' || s === 'learning'
  }) ?? null
}

/**
 * Decide the next teaching action.
 *
 * Every returned action carries a `why` — a short, learner-facing reason. The
 * interface shows it, which is what turns adaptivity from something that happens
 * behind the learner's back into something they can see working.
 */
export function nextAction(learner, course) {
  const current = course.concepts.find((c) => c.id === learner.currentConceptId)
  const concept = current && conceptStatus(learner, course, current.id) !== 'locked'
    ? current
    : nextConcept(learner, course)

  if (!concept) {
    return { type: 'complete', why: '这门课的每个概念都达到了掌握标准。' }
  }

  const state = learner.concepts[concept.id]
  const status = conceptStatus(learner, course, concept.id)

  // Mastered — move on rather than drilling something already learned.
  if (status === 'mastered') {
    const next = nextConcept(learner, course)
    return next
      ? { type: 'advance', conceptId: next.id, from: concept.id, why: `「${concept.title}」已掌握，解锁下一个概念。` }
      : { type: 'complete', why: '这门课的每个概念都达到了掌握标准。' }
  }

  // Never test something never taught.
  if (!state.seenExplain) {
    return {
      type: 'explain', conceptId: concept.id, layer: 'intuition',
      why: `先建立「${concept.title}」的直觉。`,
    }
  }

  // An unresolved misconception outranks everything else: continuing to drill on
  // top of a wrong belief just practises the wrong thing.
  // Only misconceptions this concept catalogues count: a lab shared across
  // concepts can tag one that belongs to a later step, and remediating it here
  // would show no correction and offer no way forward.
  const active = activeMisconceptions(learner, concept.id)
    .filter((m) => (concept.misconceptions ?? []).some((x) => x.id === m.id))
  if (active.length > 0) {
    const m = active[0]
    const detail = concept.misconceptions.find((x) => x.id === m.id)
    return {
      type: 'remediate', conceptId: concept.id, misconceptionId: m.id, misconception: detail,
      why: '你的回答显示出一个具体的误解，先把它纠正过来。',
    }
  }

  // Repeatedly wrong without a diagnosed misconception — the explanation itself
  // is not landing, so change how it is told rather than asking again.
  const recent = (state.evidence ?? []).slice(-3)
  const strugglingRun = recent.length >= 2 && recent.every((e) => !e.correct)
  if (state.mastery < STRUGGLING_THRESHOLD && strugglingRun) {
    const tried = new Set((state.evidence ?? []).map((e) => e.detail?.layer).filter(Boolean))
    const layer = LAYERS.find((l) => !tried.has(l)) ?? 'example'
    return {
      type: 'explain', conceptId: concept.id, layer, scaffold: true,
      why: `连续两次没答对，换一个角度重新讲「${concept.title}」。`,
    }
  }

  // Hands-on before abstract questions, when the concept has a lab.
  if (concept.lab && !labAttempted(learner, concept.id)) {
    return {
      type: 'lab', conceptId: concept.id, lab: concept.lab,
      why: `动手做一遍比读一遍更能暴露理解上的缺口。`,
    }
  }

  const open = openChecks(learner, concept)
  if (open.length > 0) {
    return {
      type: 'check', conceptId: concept.id, check: open[0],
      why: state.attempts === 0
        ? `检验一下「${concept.title}」是否真的理解了。`
        : `掌握度 ${Math.round(state.mastery * 100)}%，再确认一次就能通过。`,
    }
  }

  // Checks exhausted but mastery still short — re-ask one, since a check can
  // always produce fresh evidence and a solved lab may not.
  const review = reviewCheck(learner, concept)
  if (review) {
    return {
      type: 'check', conceptId: concept.id, check: review, review: true,
      why: `题目都做过了，但掌握度 ${Math.round(state.mastery * 100)}% 还没到 ${Math.round(MASTERY_THRESHOLD * 100)}%，再做一遍巩固一下。`,
    }
  }

  if (concept.lab) {
    return {
      type: 'lab', conceptId: concept.id, lab: concept.lab, replay: true,
      why: `题目都做过了，但掌握度还差一点，回实验室再练几次。`,
    }
  }

  return {
    type: 'explain', conceptId: concept.id, layer: 'formal',
    why: `再复习一遍「${concept.title}」的形式化定义。`,
  }
}

/**
 * Explain the decision as a short trace, for a "why am I seeing this?" affordance
 * and for debugging the policy during authoring.
 */
export function explainDecision(learner, course) {
  const action = nextAction(learner, course)
  const concept = course.concepts.find((c) => c.id === action.conceptId)
  const state = concept ? learner.concepts[concept.id] : null
  return {
    action,
    trace: {
      concept: concept?.title ?? null,
      status: concept ? conceptStatus(learner, course, concept.id) : null,
      mastery: state ? Number(state.mastery.toFixed(3)) : null,
      threshold: MASTERY_THRESHOLD,
      attempts: state?.attempts ?? 0,
      activeMisconceptions: concept ? activeMisconceptions(learner, concept.id).map((m) => m.id) : [],
      openChecks: concept ? openChecks(learner, concept).map((c) => c.id) : [],
    },
  }
}
