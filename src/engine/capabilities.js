/**
 * Capability status — what the learner is told they can do, and on what grounds.
 *
 * A capability is granted only by evidence that could not have been produced
 * with help or from memory of a revealed answer:
 *
 *   unverified  — nothing on record yet
 *   learning    — guided work on record, but no independent verification
 *   verified    — the course's verification task passed on unseen instances,
 *                 first try, with no help, under its declared resources
 *   transfer    — verified, and the course's new-context task for this
 *                 capability also passed independently
 *
 * A capability whose concept configures no verification can never reach
 * `verified`; one with no new-context task can never reach `transfer`. The
 * internal estimate plays no part here.
 *
 * Every conclusion comes with its trace: the judgements behind it, when, with
 * what help, and which scoring points were met or are still missing.
 */

export const CAP_LABEL = {
  unverified: '尚未验证',
  learning: '学习中',
  verified: '已通过独立同类验证',
  transfer: '已通过新情境验证',
}

export const CAP_SHORT = {
  unverified: '未验证',
  learning: '学习中',
  verified: '已独立验证',
  transfer: '新情境通过',
}

const ACTIVITY_LABEL = {
  lab: '实验里的判断',
  check: '课程题',
  practice: '练习题',
  verify: '独立验证',
  project: '结课项目',
  'project-verify': '项目新变式',
  legacy: '旧版记录',
}

/** A human label for a judgement's help situation. */
export function helpLabel(j) {
  if (j.activity === 'legacy') return '旧版记录，没有帮助与独立性信息'
  if (j.correct === null) return '未评定'
  if (j.assisted) return '有帮助'
  if (!j.firstTry) return '同一题重试'
  if (j.seenBefore || j.ordinal > 1) return '做过或看过答案的题'
  return j.activity === 'verify' || j.activity === 'project-verify' ? '独立完成' : '首次作答，没用帮助'
}

/**
 * A judgement as it currently stands: the latest review if it has been
 * re-graded (a pending AI criterion retried later), the original otherwise.
 * The original is never overwritten; `reviewedAt` says which version is in use.
 */
export function effective(j) {
  const r = j.reviews?.at(-1)
  if (!r) return j
  const rated = r.correct === true || r.correct === false
  return {
    ...j, correct: rated ? r.correct : null, verdict: r.verdict ?? j.verdict, criteria: r.criteria ?? j.criteria,
    independent: rated && Boolean(j.eligible ?? j.independent), reviewedAt: r.ts,
  }
}

function conceptOf(course, conceptId) {
  return course.concepts.find((c) => c.id === conceptId) ?? null
}

/** The course tasks that can confer `transfer` on a capability. */
function transferJudgements(learner, course, capId) {
  const p = course.project
  if (!p?.capabilities?.includes(capId)) return []
  return learner.judgements.map(effective).filter((j) => j.activity === 'project-verify'
    && j.taskVersion === p.version && j.correct === true && j.independent && j.resources === 'independent')
}

/**
 * Status and trace for the capability a concept teaches.
 *
 * Returns { capability, status, label, review, verifyConfigured,
 *           transferConfigured, basis, missing, trace }.
 */
export function capabilityStatus(learner, course, conceptId) {
  const concept = conceptOf(course, conceptId)
  const cap = concept?.capability ?? null
  const js = learner.judgements.filter((j) => j.conceptId === conceptId)
  const verifyConfigured = Boolean(concept?.verify)
  const transferConfigured = Boolean(cap && course.project?.capabilities?.includes(cap.id))
  const legacy = learner.legacy?.concepts?.[conceptId] ?? null

  const isCurrentVerify = (j) => j.activity === 'verify' && j.taskVersion === concept?.verify?.version
  const passes = js.filter((j) => isCurrentVerify(j) && j.correct === true && j.independent && j.resources === 'independent')
  const transfer = cap ? transferJudgements(learner, course, cap.id) : []

  let status = js.length || legacy ? 'learning' : 'unverified'
  if (verifyConfigured && passes.length) status = 'verified'
  if (status === 'verified' && transfer.length) status = 'transfer'

  // Needs review: after the last independent pass, a later independent miss on
  // this capability, or a misconception that the evidence now supports.
  const lastPass = passes.at(-1)
  const laterMiss = lastPass && js.some((j) => j.ts > lastPass.ts && j.independent && j.correct === false)
  const supported = Object.values(learner.misconceptions[conceptId] ?? {}).some((m) => m.status === 'supported')
  const review = (status === 'verified' || status === 'transfer') && Boolean(laterMiss || supported)

  const missing = []
  if (verifyConfigured && !passes.length) {
    const n = concept.verify.items.length
    missing.push(`在 ${n} 道没见过的新题上独立答对（不用讲解和 AI 提示）`)
  }
  if (!verifyConfigured) missing.push('本步没有配置独立验证，这项能力无法标记为已验证')
  if (transferConfigured && !transfer.length) missing.push('在结课项目的新数据变式上独立通过')

  const basis = lastPass
    ? `${new Date(lastPass.ts).toLocaleDateString('zh-CN')} 的独立验证：${(lastPass.criteria ?? []).filter((c) => c.met).length}/${(lastPass.criteria ?? []).length} 项通过，没有使用帮助`
    : js.length ? `有 ${js.length} 条引导学习中的作答记录，还没有独立验证` : legacy ? '只有旧版学习记录' : '还没有作答记录'

  const trace = [
    ...js.map((j) => ({
      id: j.id,
      ts: j.ts,
      activity: j.activity,
      activityLabel: ACTIVITY_LABEL[j.activity] ?? j.activity,
      task: j.detail?.label ?? j.taskId,
      verdict: j.verdict,
      correct: j.correct,
      help: helpLabel(j),
      independent: j.independent,
      counts: isCurrentVerify(j) && j.correct === true && j.independent && j.resources === 'independent',
      staleVersion: j.activity === 'verify' && !isCurrentVerify(j),
      criteria: j.criteria ?? null,
      needsReview: j.needsReview,
    })),
    ...transfer.map((j) => ({
      id: j.id, ts: j.ts, activity: j.activity, activityLabel: ACTIVITY_LABEL[j.activity], task: '结课项目 · 新数据变式',
      verdict: j.verdict, correct: j.correct, help: helpLabel(j), independent: j.independent, counts: true, criteria: j.criteria,
    })),
    ...(legacy ? [{
      id: `legacy:${conceptId}`, ts: legacy.lastTs ?? learner.legacy.importedAt, activity: 'legacy', activityLabel: ACTIVITY_LABEL.legacy,
      task: `旧版进度：${legacy.attempts} 次作答，${legacy.correct} 次正确${legacy.completedAt ? '，曾标记为已掌握' : ''}`,
      verdict: 'legacy', correct: null, help: helpLabel({ activity: 'legacy' }), independent: false, counts: false, criteria: null,
    }] : []),
  ].sort((a, b) => b.ts - a.ts)

  return {
    capability: cap,
    status,
    label: CAP_LABEL[status],
    review,
    verifyConfigured,
    transferConfigured,
    basis,
    missing,
    trace,
  }
}

/** Every capability in course order, for the profile view. */
export function capabilityProfile(learner, course) {
  return course.concepts.filter((c) => c.capability).map((c) => ({ conceptId: c.id, concept: c, ...capabilityStatus(learner, course, c.id) }))
}
