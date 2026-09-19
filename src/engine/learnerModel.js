/**
 * The learner model — what the system believes about what you know.
 *
 * This is the thing that makes the platform something other than a chat window.
 * Every interaction leaves evidence; evidence updates a per-concept mastery
 * estimate and a per-misconception tally; the policy reads both to decide what
 * happens next.
 *
 * Mastery uses Bayesian Knowledge Tracing, the standard model in the intelligent
 * tutoring literature. It is deliberately not an LLM judgement: it must be
 * deterministic, inspectable, and instant, because the UI shows it to the learner
 * and the policy branches on it.
 */

import { EVIDENCE_WEIGHT } from './schema.js'
import { topoOrder } from './schema.js'

/**
 * BKT parameters.
 *  init    — prior probability the learner already knows a concept
 *  transit — probability of learning it from one opportunity
 *  slip    — probability of answering wrong despite knowing it
 *  guess   — probability of answering right without knowing it
 *
 * `transit` is applied on every observation, including wrong ones, which puts a
 * FLOOR under mastery: repeated wrong answers converge on a non-zero value
 * instead of decaying to 0. That floor has to sit below STRUGGLING_THRESHOLD or
 * the policy's "re-explain from a different angle" branch can never fire. At
 * transit 0.25 the floor is 0.408 and that branch is unreachable; at 0.12 it is
 * 0.212. Pacing at 0.12: three written answers, or four multiple-choice answers,
 * reach the 0.85 mastery bar. Changing transit means rechecking both numbers —
 * see the floor test in test/engine.test.js.
 */
export const BKT = { init: 0.15, transit: 0.12, slip: 0.1, guess: 0.2 }

export const MASTERY_THRESHOLD = 0.85
export const STRUGGLING_THRESHOLD = 0.35

/**
 * One BKT update.
 *
 * `weight` scales how much this observation moves the estimate, so a four-option
 * multiple-choice guess counts for less than a reasoned free-response answer. It
 * interpolates between the prior and the posterior rather than altering the BKT
 * equations themselves.
 */
export function updateMastery(prior, correct, weight = 1, params = BKT) {
  const { transit, slip, guess } = params
  const posterior = correct
    ? (prior * (1 - slip)) / (prior * (1 - slip) + (1 - prior) * guess)
    : (prior * slip) / (prior * slip + (1 - prior) * (1 - guess))

  const blended = prior + (posterior - prior) * weight
  // Learning opportunity: even a wrong answer teaches something.
  return blended + (1 - blended) * transit
}

/** A fresh learner model for a course. */
export function initLearner(course) {
  const concepts = {}
  for (const c of course.concepts) {
    concepts[c.id] = {
      mastery: BKT.init,
      attempts: 0,
      correct: 0,
      evidence: [],
      misconceptions: {},
      seenExplain: false,
      layersSeen: [],
      completedAt: null,
    }
  }
  const first = topoOrder(course.concepts)[0]
  return {
    courseId: course.id,
    version: 1,
    startedAt: Date.now(),
    concepts,
    currentConceptId: first?.id ?? null,
    log: [],
  }
}

/** Authored checks the learner has not yet answered correctly, in course order. */
export function openChecks(learner, concept) {
  const state = learner.concepts[concept.id]
  const passed = new Set(
    (state?.evidence ?? []).filter((e) => e.correct && e.detail?.checkId).map((e) => e.detail.checkId),
  )
  return (concept.checks ?? []).filter((c) => !passed.has(c.id))
}

/**
 * Mastered means two things: the estimate has cleared the bar, and every check
 * the author wrote has been answered correctly at least once.
 *
 * The estimate alone is not enough. A good lab judgement and one lucky multiple
 * choice can carry it over the bar, and then the written questions — usually
 * the ones that ask *why* — are never seen. The checks are the author's
 * statement of what understanding this concept means; the estimate says how
 * sure we are. Both have to hold.
 */
export function isMastered(learner, course, conceptId) {
  const c = course.concepts.find((x) => x.id === conceptId)
  const s = learner.concepts[conceptId]
  return Boolean(c && s && s.mastery >= MASTERY_THRESHOLD && openChecks(learner, c).length === 0)
}

/** Status of one concept, derived rather than stored so it cannot go stale. */
export function conceptStatus(learner, course, conceptId) {
  const c = course.concepts.find((x) => x.id === conceptId)
  const s = learner.concepts[conceptId]
  if (!c || !s) return 'locked'
  const unlocked = (c.prerequisites ?? []).every((p) => isMastered(learner, course, p))
  if (!unlocked) return 'locked'
  if (isMastered(learner, course, conceptId)) return 'mastered'
  if (s.attempts > 0 || s.seenExplain) return 'learning'
  return 'available'
}

/** Misconceptions currently believed active (seen, and not yet resolved). */
export function activeMisconceptions(learner, conceptId) {
  const s = learner.concepts[conceptId]
  if (!s) return []
  return Object.entries(s.misconceptions)
    .filter(([, m]) => !m.resolved)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([id, m]) => ({ id, ...m }))
}

/**
 * Record one observation and return a NEW learner model.
 *
 * `obs` is { conceptId, kind, correct, misconceptionId?, detail? }. Kept pure so
 * React state updates and the undo/replay view both work without surprises.
 */
export function recordEvidence(learner, obs) {
  const { conceptId, kind, correct, misconceptionId, detail } = obs
  const prev = learner.concepts[conceptId]
  if (!prev) return learner

  const weight = EVIDENCE_WEIGHT[kind] ?? 1
  const mastery = updateMastery(prev.mastery, correct, weight)

  const misconceptions = { ...prev.misconceptions }
  if (misconceptionId) {
    const m = misconceptions[misconceptionId] ?? { count: 0, resolved: false, firstSeen: Date.now() }
    misconceptions[misconceptionId] = { ...m, count: m.count + 1, lastSeen: Date.now(), resolved: false }
  }
  // A correct answer clears the misconceptions this concept was carrying — the
  // learner has just demonstrated they no longer act on them.
  if (correct) {
    for (const id of Object.keys(misconceptions)) {
      misconceptions[id] = { ...misconceptions[id], resolved: true, resolvedAt: Date.now() }
    }
  }

  const entry = { ts: Date.now(), conceptId, kind, correct, misconceptionId: misconceptionId ?? null, detail: detail ?? null }

  return {
    ...learner,
    concepts: {
      ...learner.concepts,
      [conceptId]: {
        ...prev,
        mastery,
        attempts: prev.attempts + 1,
        correct: prev.correct + (correct ? 1 : 0),
        evidence: [...prev.evidence, entry].slice(-50),
        misconceptions,
        completedAt: mastery >= MASTERY_THRESHOLD ? (prev.completedAt ?? Date.now()) : null,
      },
    },
    log: [...learner.log, entry].slice(-300),
  }
}

/**
 * Mark that the learner has seen one layer of a concept's explanation.
 *
 * The layers are remembered individually so that "explain it differently" can
 * pick one the learner has not read yet, instead of repeating the one that just
 * failed to land. Returns the same object when nothing changes, so calling this
 * from a render-driven effect cannot loop.
 */
export function markExplained(learner, conceptId, layer = 'intuition') {
  const prev = learner.concepts[conceptId]
  if (!prev) return learner
  const seen = prev.layersSeen ?? []
  if (prev.seenExplain && seen.includes(layer)) return learner
  return {
    ...learner,
    concepts: {
      ...learner.concepts,
      [conceptId]: { ...prev, seenExplain: true, layersSeen: seen.includes(layer) ? seen : [...seen, layer] },
    },
  }
}

export function setCurrentConcept(learner, conceptId) {
  return { ...learner, currentConceptId: conceptId }
}

/** Course-level progress, for the header and the summary view. */
export function progress(learner, course) {
  const all = course.concepts
  const mastered = all.filter((c) => conceptStatus(learner, course, c.id) === 'mastered').length
  const avg = all.reduce((s, c) => s + (learner.concepts[c.id]?.mastery ?? 0), 0) / (all.length || 1)
  return { mastered, total: all.length, fraction: mastered / (all.length || 1), avgMastery: avg }
}

// --- persistence -----------------------------------------------------------
// localStorage only: no account, no server round-trip, progress survives reload.

const key = (courseId) => `adaptive-learn:${courseId}`

export function loadLearner(course) {
  try {
    const raw = localStorage.getItem(key(course.id))
    if (!raw) return initLearner(course)
    const saved = JSON.parse(raw)
    if (saved.version !== 1 || saved.courseId !== course.id) return initLearner(course)
    // Heal against a course that gained concepts — or concept fields — since
    // this model was saved. Merged per concept so an old save picks up new
    // defaults such as `layersSeen` instead of carrying `undefined`.
    const fresh = initLearner(course)
    const concepts = {}
    for (const id of Object.keys(fresh.concepts)) concepts[id] = { ...fresh.concepts[id], ...saved.concepts?.[id] }
    const current = concepts[saved.currentConceptId] ? saved.currentConceptId : fresh.currentConceptId
    return { ...fresh, ...saved, concepts, currentConceptId: current }
  } catch {
    return initLearner(course)
  }
}

export function saveLearner(learner) {
  try {
    localStorage.setItem(key(learner.courseId), JSON.stringify(learner))
  } catch {
    // Quota or private mode — progress is a convenience, never block the lesson.
  }
}

export function resetLearner(course) {
  try {
    localStorage.removeItem(key(course.id))
  } catch { /* ignore */ }
  return initLearner(course)
}
