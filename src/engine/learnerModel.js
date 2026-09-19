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

/** Status of one concept, derived rather than stored so it cannot go stale. */
export function conceptStatus(learner, course, conceptId) {
  const c = course.concepts.find((x) => x.id === conceptId)
  const s = learner.concepts[conceptId]
  if (!c || !s) return 'locked'
  const unlocked = (c.prerequisites ?? []).every(
    (p) => (learner.concepts[p]?.mastery ?? 0) >= MASTERY_THRESHOLD,
  )
  if (!unlocked) return 'locked'
  if (s.mastery >= MASTERY_THRESHOLD) return 'mastered'
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

/** Mark that the learner has read a concept's explanation. */
export function markExplained(learner, conceptId) {
  const prev = learner.concepts[conceptId]
  if (!prev || prev.seenExplain) return learner
  return { ...learner, concepts: { ...learner.concepts, [conceptId]: { ...prev, seenExplain: true } } }
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
    // Heal against a course that gained concepts since this model was saved.
    const fresh = initLearner(course)
    return { ...fresh, ...saved, concepts: { ...fresh.concepts, ...saved.concepts } }
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
