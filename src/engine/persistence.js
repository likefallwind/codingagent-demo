/**
 * Persistence: versioned local storage, migration, and the pilot export.
 *
 * Still local-only — no account, no server — but no longer silent:
 *
 *   - a failed write is reported, so the page can say "not saved" and offer a
 *     download instead of claiming a save that did not happen;
 *   - an old (v1) save is migrated into history, never deleted and never
 *     promoted: it lacks help and independence information, so the
 *     capabilities it implies are shown as awaiting verification;
 *   - a save that cannot be parsed is set aside under a backup key rather than
 *     overwritten;
 *   - a course upgrade keeps every record and says which results were earned on
 *     an older task version and need verifying again.
 */

import { initLearner, SCHEMA_VERSION, LIMITS } from './learnerModel.js'
import { capabilityProfile } from './capabilities.js'
import { newId } from './ids.js'

export const keyV2 = (courseId) => `learnai:v2:${courseId}`
export const keyV1 = (courseId) => `adaptive-learn:${courseId}`

const storageOf = (s) => s ?? (typeof localStorage !== 'undefined' ? localStorage : null)

/** Fill in anything the saved model predates: concepts, fields, containers. */
function heal(saved, course) {
  const fresh = initLearner(course, { learnerId: saved.learnerId })
  const concepts = {}
  for (const id of Object.keys(fresh.concepts)) concepts[id] = { ...fresh.concepts[id], ...saved.concepts?.[id] }
  const validIds = new Set([...Object.keys(concepts), ...(course.project ? [course.project.id] : [])])
  return {
    ...fresh,
    ...saved,
    concepts,
    settings: { ...fresh.settings, ...saved.settings },
    attempts: saved.attempts ?? {},
    judgements: saved.judgements ?? [],
    events: saved.events ?? [],
    help: saved.help ?? [],
    misconceptions: saved.misconceptions ?? {},
    instances: saved.instances ?? {},
    drafts: saved.drafts ?? {},
    conversations: saved.conversations ?? {},
    currentConceptId: validIds.has(saved.currentConceptId) ? saved.currentConceptId : fresh.currentConceptId,
  }
}

/**
 * Turn a v1 save into a v2 model whose old progress is history.
 *
 * Kept: the internal estimate, which explanations were read, which authored
 * checks were answered correctly (so they are not asked again), and the old
 * evidence as a summary. Not kept as conclusions: "mastered" (the old bar had
 * no idea of help or unseen instances) and "resolved" misconceptions (the old
 * rule let any correct answer clear every misconception). Open ones become
 * leads to check, not findings.
 */
export function migrateV1(saved, course) {
  const learner = initLearner(course)
  const legacyConcepts = {}
  const misconceptions = {}
  for (const c of course.concepts) {
    const s = saved.concepts?.[c.id]
    if (!s) continue
    const evidence = Array.isArray(s.evidence) ? s.evidence : []
    const touched = (s.attempts ?? 0) > 0 || evidence.length > 0
    learner.concepts[c.id] = {
      ...learner.concepts[c.id],
      mastery: typeof s.mastery === 'number' ? s.mastery : learner.concepts[c.id].mastery,
      seenExplain: Boolean(s.seenExplain),
      layersSeen: Array.isArray(s.layersSeen) ? s.layersSeen : [],
    }
    if (!touched) continue
    legacyConcepts[c.id] = {
      mastery: s.mastery ?? null,
      attempts: s.attempts ?? evidence.length,
      correct: s.correct ?? evidence.filter((e) => e.correct).length,
      completedAt: s.completedAt ?? null,
      lastTs: evidence.at(-1)?.ts ?? null,
      passedChecks: [...new Set(evidence.filter((e) => e.correct && e.detail?.checkId && !e.detail?.practice).map((e) => e.detail.checkId))],
      labTried: evidence.some((e) => e.kind === 'labAction' || e.kind === 'labExplore'),
      evidence: evidence.slice(-50),
      misconceptions: s.misconceptions ?? {},
    }
    const open = Object.entries(s.misconceptions ?? {}).filter(([, m]) => !m.resolved)
    if (open.length) {
      misconceptions[c.id] = Object.fromEntries(open.map(([id, m]) => [id, {
        status: 'suspected',
        evidence: [{ judgementId: null, instanceKey: 'legacy', ts: m.lastSeen ?? m.firstSeen ?? Date.now(), strength: 'choice' }],
        firstSeen: m.firstSeen ?? null,
        legacy: true,
      }]))
    }
  }
  const current = course.concepts.some((c) => c.id === saved.currentConceptId) ? saved.currentConceptId : learner.currentConceptId
  return {
    ...learner,
    startedAt: saved.startedAt ?? learner.startedAt,
    currentConceptId: current,
    misconceptions,
    legacy: { importedAt: Date.now(), fromVersion: 1, concepts: legacyConcepts },
  }
}

/** Which verified results rest on an older task version than the course now ships. */
export function staleResults(learner, course) {
  const out = []
  for (const c of course.concepts) {
    if (!c.verify) continue
    const old = learner.judgements.some((j) => j.conceptId === c.id && j.activity === 'verify' && j.correct && j.taskVersion !== c.verify.version)
    const current = learner.judgements.some((j) => j.conceptId === c.id && j.activity === 'verify' && j.correct && j.taskVersion === c.verify.version)
    if (old && !current) out.push(c.capability?.title ?? c.title)
  }
  if (course.project) {
    const old = learner.judgements.some((j) => j.activity?.startsWith('project') && j.taskVersion && j.taskVersion !== course.project.version)
    if (old) out.push(`${course.project.title}（旧版本任务）`)
  }
  return out
}

/**
 * Load the learner for a course.
 * Returns { learner, notice } — `notice` tells the page what happened, if
 * anything worth saying: a migration, a course upgrade, an unreadable save.
 */
export function loadLearner(course, storage) {
  const store = storageOf(storage)
  const session = { id: newId('session'), startedAt: Date.now() }
  const withSession = (l) => ({ ...l, sessions: [...(l.sessions ?? []), session].slice(-100) })
  if (!store) return { learner: withSession(initLearner(course)), notice: null }

  let raw = null
  try { raw = store.getItem(keyV2(course.id)) } catch { /* storage blocked */ }
  if (raw) {
    try {
      const saved = JSON.parse(raw)
      if (saved?.schema !== SCHEMA_VERSION || saved.courseId !== course.id) throw new Error(`unsupported schema ${saved?.schema}`)
      const learner = heal(saved, course)
      let notice = null
      if ((saved.courseVersion ?? null) !== (course.version ?? null)) {
        const stale = staleResults(learner, course)
        notice = {
          kind: 'course-updated', from: saved.courseVersion ?? '未标版本', to: course.version,
          restored: ['作答与帮助记录', '草稿与代码', '对话记录'],
          reverify: stale,
        }
        learner.courseVersion = course.version ?? null
      }
      return { learner: withSession(learner), notice }
    } catch (err) {
      // Never overwrite what we could not read: set it aside first.
      try { store.setItem(`${keyV2(course.id)}:unreadable:${Date.now()}`, raw) } catch { /* nothing more to do */ }
      return {
        learner: withSession(initLearner(course)),
        notice: { kind: 'unreadable', error: err.message, restored: [], reverify: [] },
      }
    }
  }

  let old = null
  try { old = store.getItem(keyV1(course.id)) } catch { /* storage blocked */ }
  if (old) {
    try {
      const saved = JSON.parse(old)
      if (saved?.courseId === course.id) {
        const learner = migrateV1(saved, course)
        const touched = Object.keys(learner.legacy.concepts)
        return {
          learner: withSession(learner),
          notice: {
            kind: 'migrated',
            restored: touched.length ? ['旧版每一步的作答次数与正误', '已做对的课程题（不会再问）', '读过的讲解'] : [],
            reverify: course.concepts.filter((c) => c.capability && touched.includes(c.id)).map((c) => c.capability.title),
            note: '旧版记录没有「是否用了提示」「是否是新题」的信息，所以旧的「已掌握」不能直接算作独立验证通过。旧存档原样保留在浏览器里。',
          },
        }
      }
    } catch { /* fall through to a fresh model; the v1 key is left untouched */ }
  }
  return { learner: withSession(initLearner(course)), notice: null }
}

/**
 * Write the learner. Returns { ok: true, at, bytes } or { ok: false, error } —
 * the caller must show a failure, never assume success.
 */
export function saveLearner(learner, storage) {
  const store = storageOf(storage)
  if (!store) return { ok: false, error: '浏览器没有提供本地存储' }
  try {
    const text = JSON.stringify(learner)
    store.setItem(keyV2(learner.courseId), text)
    return { ok: true, at: Date.now(), bytes: text.length }
  } catch (err) {
    const quota = /quota|exceeded/i.test(String(err?.name ?? '') + String(err?.message ?? ''))
    return { ok: false, error: quota ? '浏览器存储空间已满' : (err?.message || '写入失败') }
  }
}

/** Start over. The current record is archived first — a reset is not a deletion. */
export function resetLearner(course, current, storage) {
  const store = storageOf(storage)
  try {
    if (store && current) store.setItem(`${keyV2(course.id)}:archive`, JSON.stringify({ archivedAt: Date.now(), learner: current }))
  } catch { /* archive is best effort; the reset itself proceeds */ }
  return initLearner(course)
}

/**
 * Process measures a pilot records (需求文档 §9.1, P0 "记录"). Counts only —
 * none of them is a claim about learning, and the exits and conversions are
 * reported next to the passes so the independent results are not read as if
 * only those who persisted counted.
 */
export function pilotMetrics(learner) {
  const js = learner.judgements
  const attempts = Object.values(learner.attempts)
  const verify = attempts.filter((a) => a.activity === 'verify')
  const vjs = js.filter((j) => j.activity === 'verify')
  const firstRound = new Map()
  for (const a of [...verify].sort((x, y) => x.startedAt - y.startedAt)) if (!firstRound.has(a.conceptId)) firstRound.set(a.conceptId, a.id)
  const firstJ = vjs.filter((j) => [...firstRound.values()].includes(j.attemptId))
  const count = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m[k] = (m[k] ?? 0) + 1; return m }, {})
  return {
    note: '过程记录，不是学习效果结论。独立验证的通过数需要和退出、转为辅助的数量一起看。',
    independentVerification: {
      rounds: verify.length,
      submitted: vjs.length,
      independentPasses: vjs.filter((j) => j.correct && j.independent).length,
      independentFails: vjs.filter((j) => j.correct === false && j.independent).length,
      convertedToPractice: verify.filter((a) => a.converted).length,
      startedNotSubmitted: verify.filter((a) => !a.submittedAt).length,
      firstRoundPassRate: firstJ.length ? firstJ.filter((j) => j.correct && j.independent).length / firstJ.length : null,
    },
    guidedAnswers: {
      firstTry: js.filter((j) => ['check', 'practice', 'lab'].includes(j.activity) && j.firstTry && j.correct !== null).length,
      firstTryCorrect: js.filter((j) => ['check', 'practice', 'lab'].includes(j.activity) && j.firstTry && j.correct === true).length,
      assistedCorrect: js.filter((j) => j.correct === true && j.assisted).length,
    },
    help: {
      bySource: count(learner.help, (h) => h.source),
      byLevel: count(learner.help, (h) => String(h.level)),
      requested: learner.help.filter((h) => h.requested).length,
      invitationsDismissed: learner.events.filter((e) => e.object === 'tutor' && String(e.action).startsWith('dismiss:')).length,
      invitationsAccepted: learner.events.filter((e) => e.object === 'tutor' && String(e.action).startsWith('accept')).length,
      declinedWhileIndependent: learner.events.filter((e) => e.action === 'declined-help').length,
    },
    project: {
      submissions: count(js.filter((j) => j.activity?.startsWith('project')), (j) => `${j.activity}:${j.correct === null ? 'pending' : j.correct ? 'pass' : 'fail'}${j.assisted ? ':assisted' : ''}`),
      criteria: js.filter((j) => j.activity?.startsWith('project')).map((j) => ({ activity: j.activity, independent: j.independent, criteria: (j.criteria ?? []).map((c) => [c.id, c.met]) })),
    },
    engineering: {
      runs: count(Object.values(learner.project?.runs ?? {}), (r) => r.status),
      gradingUnrated: js.filter((j) => j.verdict === 'unrated').length,
      gradingNeedsReview: js.filter((j) => j.needsReview).length,
      sessions: learner.sessions?.length ?? 0,
    },
  }
}

export const OBSERVATION_SCOPE = '只记录本学习工作区内的活动。「平台内没有使用教学帮助」不等于学生没有使用任何外部帮助（其他网站、同学、其他 AI 工具）；研究报告引用这些记录时需注明这一观测范围。'

/**
 * The pilot package: everything a teacher needs to check the evidence, in one
 * JSON file. Task versions, evidence, help, work and grading — and the
 * observation scope, stated in the file itself.
 */
export function exportPackage(learner, course, extra = {}) {
  return {
    format: 'learnai-pilot-export',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    observationScope: OBSERVATION_SCOPE,
    course: {
      id: course.id, title: course.title, version: course.version ?? null,
      tasks: course.concepts.map((c) => ({
        conceptId: c.id, title: c.title, capability: c.capability ?? null,
        verify: c.verify ? { version: c.verify.version, items: c.verify.items, resources: c.verify.resources } : null,
        practice: c.practice ?? null,
      })),
      project: course.project ? { id: course.project.id, version: course.project.version, criteria: course.project.criteria } : null,
    },
    learner: { learnerId: learner.learnerId, startedAt: learner.startedAt, sessions: learner.sessions, settings: learner.settings },
    versions: extra.versions ?? {},
    capabilities: capabilityProfile(learner, course).map((c) => ({
      id: c.capability.id, title: c.capability.title, conceptId: c.conceptId, status: c.status, label: c.label,
      review: c.review, basis: c.basis, missing: c.missing,
      evidence: c.trace.filter((t) => t.activity !== 'legacy').map((t) => t.id),
    })),
    attempts: Object.values(learner.attempts),
    judgements: learner.judgements,
    events: learner.events,
    help: learner.help,
    misconceptions: learner.misconceptions,
    instances: learner.instances,
    drafts: learner.drafts,
    project: learner.project,
    legacy: learner.legacy,
    metrics: pilotMetrics(learner),
    limits: LIMITS,
  }
}
