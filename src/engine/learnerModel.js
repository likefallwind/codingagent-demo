/**
 * The learner model — what the system has observed, and what it may conclude.
 *
 * Four kinds of record, kept apart because they mean different things:
 *
 *   events      — behaviour: a slider set, a view opened, a lab explored. They
 *                 describe what the learner did and imply nothing about right
 *                 or wrong. They never move the estimate or diagnose a belief.
 *   attempts    — one learner working on one task instance: which instance,
 *                 which try at it (first or a return), whether they had seen
 *                 its answer before, whether help reached it.
 *   judgements  — a scored submission inside an attempt: a prediction, an
 *                 answer, a committed choice, a verification, a project. Each
 *                 keeps its scoring points, its grading method, and whether it
 *                 was independent. An unrated one (the grader failed) is kept
 *                 as such and changes nothing.
 *   help        — every piece of help shown: where it came from, how strong,
 *                 which attempts it touched. Help is what turns an attempt
 *                 from independent into assisted, and that mark is permanent.
 *
 * Misconceptions have three states — suspected, supported, resolved — so a
 * wrong option can raise a lead without convicting the learner of every reason
 * that option implies, and a correct answer to an unrelated question cannot
 * clear it.
 *
 * Bayesian Knowledge Tracing still runs underneath, but only as an internal
 * aid to recommendation. It is never shown as a percentage, and it never grants
 * a capability: capabilities are granted by verified evidence (capabilities.js).
 *
 * Everything here is pure: a function takes a model and returns a new one.
 */

import { EVIDENCE_WEIGHT, topoOrder } from './schema.js'
import { newId } from './ids.js'

export const SCHEMA_VERSION = 2

/**
 * BKT parameters.
 *  init    — prior probability the learner already knows a concept
 *  transit — probability of learning it from one opportunity
 *  slip    — probability of answering wrong despite knowing it
 *  guess   — probability of answering right without knowing it
 *
 * `transit` is applied on every observation, including wrong ones, which puts a
 * FLOOR under the estimate: repeated wrong answers converge on a non-zero value
 * instead of decaying to 0. That floor has to sit below STRUGGLING_THRESHOLD or
 * the policy's "re-explain from a different angle" branch can never fire. At
 * transit 0.25 the floor is 0.408 and that branch is unreachable; at 0.12 it is
 * 0.212. Changing transit means rechecking both numbers — see the floor test in
 * test/engine.test.js.
 */
export const BKT = { init: 0.15, transit: 0.12, slip: 0.1, guess: 0.2 }

/** Internal bar above which the policy stops recommending more practice before verification. */
export const MASTERY_THRESHOLD = 0.85
export const STRUGGLING_THRESHOLD = 0.35

/** Bounds on the stored logs, so localStorage never fills with one learner's history. */
export const LIMITS = { events: 3000, judgements: 2000, help: 1200, conversation: 80, attempts: 3000 }

/**
 * One BKT update. `weight` interpolates between the prior and the posterior, so a
 * four-option guess moves the estimate less than a reasoned written answer.
 */
export function updateMastery(prior, correct, weight = 1, params = BKT) {
  const { transit, slip, guess } = params
  const posterior = correct
    ? (prior * (1 - slip)) / (prior * (1 - slip) + (1 - prior) * guess)
    : (prior * slip) / (prior * slip + (1 - prior) * (1 - guess))
  const blended = prior + (posterior - prior) * weight
  return blended + (1 - blended) * transit
}

const freshConcept = () => ({ mastery: BKT.init, seenExplain: false, layersSeen: [] })

/** A fresh learner model for a course. */
export function initLearner(course, { learnerId } = {}) {
  const concepts = {}
  for (const c of course.concepts) concepts[c.id] = freshConcept()
  const first = topoOrder(course.concepts)[0]
  return {
    schema: SCHEMA_VERSION,
    courseId: course.id,
    courseVersion: course.version ?? null,
    learnerId: learnerId ?? newId('learner'),
    startedAt: Date.now(),
    sessions: [],
    currentConceptId: first?.id ?? null,
    settings: { proactive: true },
    concepts,
    attempts: {},
    judgements: [],
    events: [],
    help: [],
    misconceptions: {},
    instances: {},
    drafts: {},
    conversations: {},
    project: null,
    legacy: null,
  }
}

const now = () => Date.now()

/** The session a record was made in — the one opened when the page loaded. */
const sessionOf = (learner) => learner.sessions?.at(-1)?.id ?? null

// --- attempts ----------------------------------------------------------------

/** The open attempt on an instance, else the most recent one, else null. */
export function attemptFor(learner, instanceKey) {
  let latest = null
  for (const a of Object.values(learner.attempts)) {
    if (a.instanceKey !== instanceKey) continue
    if (a.status === 'open') return a
    if (!latest || a.startedAt > latest.startedAt) latest = a
  }
  return latest
}

export const openAttemptFor = (learner, instanceKey) => {
  const a = attemptFor(learner, instanceKey)
  return a?.status === 'open' ? a : null
}

/**
 * Begin (or resume) an attempt on a task instance.
 *
 * Resuming matters: a refresh or a trip to another step must bring back the
 * same attempt with its help record intact, not a clean one — otherwise
 * reloading the page would launder an assisted attempt into an independent one.
 *
 * `spec`: { id?, conceptId, taskId, taskVersion, activity, instanceKey,
 *           capability?, resources?, seed?, items?, label?, parts? }
 *
 * `parts` are the instance keys of the items inside a composite task (the
 * questions of a verification). They are registered too, so none of them can
 * later come back as a practice question.
 */
export function startAttempt(learner, spec) {
  if (!spec?.instanceKey || !spec.conceptId) return learner
  if (openAttemptFor(learner, spec.instanceKey)) return learner
  if (spec.id && learner.attempts[spec.id]) return learner
  const prior = Object.values(learner.attempts).filter((a) => a.instanceKey === spec.instanceKey)
  const inst = learner.instances[spec.instanceKey]
  const t = now()
  const attempt = {
    id: spec.id ?? newId('att'),
    conceptId: spec.conceptId,
    taskId: spec.taskId ?? spec.instanceKey,
    taskVersion: spec.taskVersion ?? null,
    activity: spec.activity ?? 'check',
    instanceKey: spec.instanceKey,
    capability: spec.capability ?? null,
    resources: spec.resources ?? 'guided',
    seed: spec.seed ?? null,
    items: spec.items ?? null,
    label: spec.label ?? null,
    ordinal: prior.length + 1,
    sessionId: sessionOf(learner),
    // Seen before means its answer or explanation was already shown to this
    // learner: any later attempt on it measures memory, not understanding.
    seenBefore: Boolean(inst?.revealedAt),
    startedAt: t,
    submittedAt: null,
    status: 'open',
    assisted: false,
    converted: false,
    helpIds: [],
    submissions: 0,
  }
  const instances = { ...learner.instances, [spec.instanceKey]: inst ?? { firstSeenAt: t, role: attempt.activity, conceptId: spec.conceptId } }
  for (const k of spec.parts ?? []) instances[k] = instances[k] ?? { firstSeenAt: t, role: attempt.activity, conceptId: spec.conceptId, partOf: spec.instanceKey }
  return trimAttempts({ ...learner, attempts: { ...learner.attempts, [attempt.id]: { ...attempt, parts: spec.parts ?? null } }, instances })
}

/** Keep the attempt table bounded: drop the oldest closed attempts first. */
function trimAttempts(learner) {
  const all = Object.values(learner.attempts)
  if (all.length <= LIMITS.attempts) return learner
  const drop = new Set(all.filter((a) => a.status !== 'open').sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, all.length - LIMITS.attempts).map((a) => a.id))
  return { ...learner, attempts: Object.fromEntries(all.filter((a) => !drop.has(a.id)).map((a) => [a.id, a])) }
}

function patchAttempt(learner, id, fields) {
  const a = learner.attempts[id]
  if (!a) return learner
  return { ...learner, attempts: { ...learner.attempts, [id]: { ...a, ...fields } } }
}

/** Close an attempt without a submission (the learner left it, or it was superseded). */
export function closeAttempt(learner, attemptId, status = 'abandoned') {
  const a = learner.attempts[attemptId]
  if (!a || a.status !== 'open') return learner
  return patchAttempt(learner, attemptId, { status, closedAt: now() })
}

/**
 * Turn an independent verification into assisted practice. The learner asked
 * for help mid-verification; the attempt stays open with its draft, but it can
 * no longer count as independent evidence, and a fresh unseen instance is
 * needed to verify the capability.
 */
export function convertAttempt(learner, attemptId) {
  const a = learner.attempts[attemptId]
  if (!a || a.converted) return learner
  return patchAttempt(learner, attemptId, { converted: true, assisted: true, convertedAt: now() })
}

/** Mark an instance's answer as shown — with any parts it is made of. Later attempts on it are not independent. */
export function markRevealed(learner, instanceKey) {
  const keys = [instanceKey, ...(Object.values(learner.attempts).find((a) => a.instanceKey === instanceKey && a.parts)?.parts ?? [])]
  if (keys.every((k) => learner.instances[k]?.revealedAt)) return learner
  const instances = { ...learner.instances }
  for (const k of keys) if (!instances[k]?.revealedAt) instances[k] = { ...(instances[k] ?? { firstSeenAt: now() }), revealedAt: now() }
  return { ...learner, instances }
}

// --- judgements --------------------------------------------------------------

/**
 * Record a scored submission and return a NEW learner model.
 *
 * `j`: { id, attemptId, kind, correct (true | false | null), verdict?, criteria?,
 *        misconceptionId?, stated?, targets?, answer?, grading?, needsReview?,
 *        closes?, reveals?, detail? }
 *
 * Idempotent on `j.id`. What it derives, rather than trusting the caller:
 *   firstTry     — no earlier rated submission in the same attempt
 *   independent  — first try, first attempt at an instance never revealed to
 *                  this learner, no help, not converted
 * Only a first try on a first attempt moves the internal estimate; an assisted
 * one moves it half as far. A retry of the same instance is recorded but is not
 * new evidence. `correct: null` (unrated) moves nothing.
 */
export function recordJudgement(learner, course, j) {
  if (!j?.id || learner.judgements.some((x) => x.id === j.id)) return learner
  const attempt = learner.attempts[j.attemptId]
  if (!attempt) return learner
  const concept = course.concepts.find((c) => c.id === attempt.conceptId)
    ?? (course.project?.id === attempt.conceptId ? course.project : null)

  const t = now()
  // An unrated earlier submission (the grader failed, or was unsure) does not
  // use up the first try: a network error must not cost the learner anything.
  const firstTry = !learner.judgements.some((x) => x.attemptId === attempt.id && x.correct !== null)
  const rated = j.correct === true || j.correct === false
  const fresh = attempt.ordinal === 1 && !attempt.seenBefore
  // Eligible: would count as independent once rated. Kept separately so a
  // pending grade confirmed later by a review is judged by the conditions at
  // the time of submission, not by help given afterwards.
  const eligible = firstTry && fresh && !attempt.assisted && !attempt.converted
  const independent = rated && eligible

  const entry = {
    id: j.id,
    ts: t,
    sessionId: sessionOf(learner),
    attemptId: attempt.id,
    conceptId: attempt.conceptId,
    taskId: attempt.taskId,
    taskVersion: attempt.taskVersion,
    activity: attempt.activity,
    instanceKey: attempt.instanceKey,
    capability: attempt.capability,
    resources: attempt.resources,
    kind: j.kind,
    correct: rated ? j.correct : null,
    verdict: j.verdict ?? (rated ? (j.correct ? 'correct' : 'incorrect') : 'unrated'),
    criteria: j.criteria ?? null,
    misconceptionId: j.misconceptionId ?? null,
    stated: Boolean(j.stated),
    targets: j.targets ?? [],
    answer: j.answer ?? null,
    grading: j.grading ?? null,
    needsReview: Boolean(j.needsReview),
    firstTry,
    ordinal: attempt.ordinal,
    seenBefore: attempt.seenBefore,
    assisted: attempt.assisted || attempt.converted,
    eligible,
    independent,
    capabilities: j.capabilities ?? null,
    detail: j.detail ?? null,
  }

  let next = { ...learner, judgements: [...learner.judgements, entry].slice(-LIMITS.judgements) }

  const cstate = next.concepts[attempt.conceptId]
  if (cstate && rated && firstTry && fresh) {
    const w = (EVIDENCE_WEIGHT[j.kind] ?? 1) * (attempt.assisted ? 0.5 : 1)
    next = {
      ...next,
      concepts: { ...next.concepts, [attempt.conceptId]: { ...cstate, mastery: updateMastery(cstate.mastery, j.correct, w) } },
    }
  }

  const catalogue = (concept?.misconceptions ?? []).map((m) => m.id)
  const mis = updateMisconceptions(next.misconceptions[attempt.conceptId] ?? {}, entry, catalogue)
  next = { ...next, misconceptions: { ...next.misconceptions, [attempt.conceptId]: mis } }

  next = patchAttempt(next, attempt.id, {
    submissions: attempt.submissions + 1,
    submittedAt: attempt.submittedAt ?? t,
    lastSubmittedAt: t,
    ...(j.closes && rated ? { status: 'closed', closedAt: t } : {}),
  })
  if (j.reveals) next = markRevealed(next, attempt.instanceKey)
  return next
}

/**
 * Attach a later review to a judgement without overwriting the original — the
 * first grading and every re-grade are kept, and the judgement says which one
 * its current conclusion rests on.
 */
export function reviewJudgement(learner, judgementId, review) {
  const idx = learner.judgements.findIndex((j) => j.id === judgementId)
  if (idx < 0) return learner
  const j = learner.judgements[idx]
  const reviews = [...(j.reviews ?? []), { ...review, ts: now() }]
  const judgements = [...learner.judgements]
  judgements[idx] = { ...j, reviews }
  return { ...learner, judgements }
}

/**
 * Misconception bookkeeping for one judgement.
 *
 *   suspected  — a wrong choice points at a belief. It is a lead, not a finding:
 *                picking an option does not mean holding every reason behind it.
 *   supported  — the learner stated the belief in their own words (a confident
 *                grading of a written answer), or the same lead came up again on
 *                a different instance.
 *   resolved   — a later first-try, unassisted correct answer to a task that
 *                targets this very misconception, on a different instance.
 *
 * A correct answer to a question that does not target a misconception leaves it
 * exactly as it was.
 */
export function updateMisconceptions(prev, entry, catalogue) {
  const out = { ...prev }
  const t = entry.ts
  const id = entry.misconceptionId
  if (id && catalogue.includes(id) && entry.correct !== true) {
    const old = out[id]
    const episode = old && old.status !== 'resolved' ? old : { status: 'suspected', evidence: [], firstSeen: old?.firstSeen ?? t }
    const evidence = [...episode.evidence, { judgementId: entry.id, instanceKey: entry.instanceKey, ts: t, strength: entry.stated ? 'stated' : 'choice' }].slice(-20)
    const instances = new Set(evidence.map((e) => e.instanceKey))
    const status = entry.stated || instances.size >= 2 ? 'supported' : 'suspected'
    out[id] = {
      ...episode, status, evidence, lastSeen: t,
      resolvedBy: null, resolvedAt: null,
      history: [...(old?.history ?? []), ...(old?.status === 'resolved' ? [{ resolvedAt: old.resolvedAt, resolvedBy: old.resolvedBy }] : [])].slice(-5),
    }
  }
  if (entry.correct === true && entry.independent) {
    for (const tid of entry.targets ?? []) {
      const m = out[tid]
      if (!m || m.status === 'resolved') continue
      if (m.evidence.some((e) => e.instanceKey === entry.instanceKey)) continue
      out[tid] = { ...m, status: 'resolved', resolvedBy: entry.id, resolvedAt: t }
    }
  }
  return out
}

// --- events and help ---------------------------------------------------------

/**
 * Record a behaviour event. `e`: { id?, conceptId, object, action, attemptId?,
 * taskId?, resultVersion?, detail? }. Events carry no correctness.
 */
export function recordEvent(learner, e) {
  if (!e?.object || !e.action) return learner
  const id = e.id ?? newId('ev')
  if (e.id && learner.events.some((x) => x.id === e.id)) return learner
  const entry = {
    id, ts: now(), sessionId: sessionOf(learner), conceptId: e.conceptId ?? null, object: e.object, action: e.action,
    attemptId: e.attemptId ?? null, taskId: e.taskId ?? null, resultVersion: e.resultVersion ?? null,
    detail: e.detail ?? null,
  }
  return { ...learner, events: [...learner.events, entry].slice(-LIMITS.events) }
}

/**
 * Record help shown to the learner. `h`: { id?, conceptId, source, level,
 * text?, attemptIds?, revealedAnswer?, contextKey?, policyVersion? }.
 *
 * Levels: 0 invitation (no content), 1 where to look, 2 a question to think
 * about, 3 a contrasting example, 4 part of the steps, 5 the full solution.
 * Anything above 0 marks the attempts it touched as assisted, for good.
 */
export function recordHelp(learner, h) {
  if (!h?.source) return learner
  if (h.id && learner.help.some((x) => x.id === h.id)) return learner
  const entry = {
    id: h.id ?? newId('help'),
    ts: now(),
    sessionId: sessionOf(learner),
    conceptId: h.conceptId ?? null,
    source: h.source,
    level: Number.isInteger(h.level) ? h.level : 1,
    text: typeof h.text === 'string' ? h.text.slice(0, 800) : null,
    attemptIds: (h.attemptIds ?? []).filter((id) => learner.attempts[id]),
    revealedAnswer: Boolean(h.revealedAnswer),
    contextKey: h.contextKey ?? null,
    policyVersion: h.policyVersion ?? null,
    requested: Boolean(h.requested),
    resultVersion: h.resultVersion ?? null,
  }
  let next = { ...learner, help: [...learner.help, entry].slice(-LIMITS.help) }
  if (entry.level > 0) {
    for (const id of entry.attemptIds) {
      const a = next.attempts[id]
      next = patchAttempt(next, id, { assisted: true, helpIds: [...a.helpIds, entry.id] })
      if (entry.revealedAnswer) next = markRevealed(next, a.instanceKey)
    }
  }
  return next
}

/** Update the text of a help record once its content arrives (it is created when requested). */
export function updateHelpText(learner, helpId, text) {
  const idx = learner.help.findIndex((h) => h.id === helpId)
  if (idx < 0) return learner
  const help = [...learner.help]
  help[idx] = { ...help[idx], text: typeof text === 'string' ? text.slice(0, 800) : help[idx].text }
  return { ...learner, help }
}

// --- views and small state -----------------------------------------------------

/**
 * Mark that the learner has seen one layer of a concept's explanation. Returns
 * the same object when nothing changes, so calling this from a render-driven
 * effect cannot loop.
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
  if (learner.currentConceptId === conceptId) return learner
  return { ...learner, currentConceptId: conceptId }
}

export function setSetting(learner, key, value) {
  if (learner.settings?.[key] === value) return learner
  return { ...learner, settings: { ...learner.settings, [key]: value } }
}

/** A draft keyed by task instance: a written answer, verification choices, code. */
export function setDraft(learner, key, value) {
  if (learner.drafts[key] === value) return learner
  const drafts = { ...learner.drafts }
  if (value === undefined || value === null || value === '') delete drafts[key]
  else drafts[key] = value
  return { ...learner, drafts }
}

/** The tutor conversation for one concept, persisted so a refresh keeps it. */
export function setConversation(learner, conceptId, messages) {
  const kept = messages.filter((m) => !m.streaming).slice(-LIMITS.conversation)
    .map(({ actions, ...m }) => ({ ...m, ...(actions && !m.actionsDone ? { actionsDone: true } : {}) }))
  return { ...learner, conversations: { ...learner.conversations, [conceptId]: kept } }
}

export function setProject(learner, project) {
  return { ...learner, project }
}

// --- derived views -------------------------------------------------------------

export const judgementsOf = (learner, conceptId) => learner.judgements.filter((j) => j.conceptId === conceptId)

/**
 * Authored checks never yet answered correctly, in course order.
 *
 * With `{ pending: false }`, checks whose only submissions could not be rated
 * (the grader was down or unsure) are left out: they wait for grading without
 * blocking the rest of the step, so a failed AI service never stands between
 * the learner and an algorithmically graded verification.
 */
export function openChecks(learner, concept, { pending = true } = {}) {
  const js = learner.judgements.filter((j) => j.conceptId === concept.id && j.activity === 'check')
  const passed = new Set(js.filter((j) => j.correct === true).map((j) => j.taskId))
  const legacy = new Set(learner.legacy?.concepts?.[concept.id]?.passedChecks ?? [])
  return (concept.checks ?? []).filter((c) => {
    if (passed.has(c.id) || legacy.has(c.id)) return false
    if (pending) return true
    const mine = js.filter((j) => j.taskId === c.id)
    return !(mine.length && mine.every((j) => j.correct === null))
  })
}

/** Authored checks waiting for a grading that has not succeeded yet. */
export function pendingChecks(learner, concept) {
  const open = openChecks(learner, concept)
  const flow = new Set(openChecks(learner, concept, { pending: false }).map((c) => c.id))
  return open.filter((c) => !flow.has(c.id))
}

/** Every misconception on record for a concept, with its id. */
export function misconceptionList(learner, conceptId) {
  return Object.entries(learner.misconceptions[conceptId] ?? {}).map(([id, m]) => ({ id, ...m }))
}

/** Misconceptions not yet resolved: supported first, then by how often they came up. */
export function activeMisconceptions(learner, conceptId) {
  const rank = { supported: 0, suspected: 1 }
  return misconceptionList(learner, conceptId)
    .filter((m) => m.status !== 'resolved')
    .sort((a, b) => (rank[a.status] - rank[b.status]) || (b.evidence.length - a.evidence.length))
}

/** True once the learner has committed a judgement in the concept's lab, or explored it. */
export function labAttempted(learner, conceptId) {
  return learner.judgements.some((j) => j.conceptId === conceptId && j.activity === 'lab')
    || learner.events.some((e) => e.conceptId === conceptId && e.object === 'lab' && e.action === 'explore')
    || Boolean(learner.legacy?.concepts?.[conceptId]?.labTried)
}

/**
 * Guided work complete: the lab tried and every authored check answered
 * correctly at least once. The finish line for a step that configures no
 * independent verification — it never grants a capability.
 */
export function guidedComplete(learner, course, conceptId) {
  const c = course.concepts.find((x) => x.id === conceptId)
  if (!c) return false
  return (!c.lab || labAttempted(learner, conceptId)) && openChecks(learner, c, { pending: false }).length === 0
}

/**
 * Start (or resume) the attempt for `spec.instanceKey` and record a judgement in
 * it, in one step — for tasks whose attempt begins with the judgement itself,
 * like a prediction in a lab.
 */
export function judgeInAttempt(learner, course, spec, j) {
  // An open attempt is resumed; a closed one means this is a return to the
  // instance, and startAttempt opens a new attempt with the next ordinal.
  const next = startAttempt(learner, spec)
  const attempt = openAttemptFor(next, spec.instanceKey)
  if (!attempt) return learner
  return recordJudgement(next, course, { ...j, attemptId: attempt.id })
}
