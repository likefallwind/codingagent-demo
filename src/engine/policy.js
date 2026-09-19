/**
 * The pedagogical policy — what the learner is advised to do next.
 *
 * Deliberately rule-based, with no LLM in the loop. Three reasons: it must be
 * instant (it runs on every interaction), it must be deterministic (the same
 * state always yields the same next step, so the experience is debuggable), and
 * it must be explainable. Every action names the capability it serves, the
 * evidence it rests on, and what the activity will check.
 *
 * Within a concept the order is: build the intuition, clear up a misconception
 * the evidence supports, try the lab, answer the authored questions, then an
 * independent verification on unseen instances — for everyone, not just for
 * learners who fell behind. The internal estimate only decides whether to
 * suggest one more practice question before that verification.
 *
 * Browsing is always open. Prerequisites become advice ("建议先学…"), never a
 * lock, and visiting a step grants nothing.
 */

import { topoOrder } from './schema.js'
import {
  activeMisconceptions, openChecks, labAttempted, guidedComplete, judgementsOf,
  MASTERY_THRESHOLD, STRUGGLING_THRESHOLD,
} from './learnerModel.js'
import { capabilityStatus } from './capabilities.js'

export { openChecks, labAttempted }

/** Explanation layers, in the order a struggling learner falls back through. */
export const LAYERS = ['intuition', 'example', 'formal']

/** Misconceptions a check can confirm or rule out: its own list plus its options'. */
export function targetsOf(check) {
  const out = new Set(check?.misconceptions ?? [])
  for (const o of check?.options ?? []) if (o.misconception) out.add(o.misconception)
  return [...out]
}

/**
 * The check to re-ask when a concept has no generator and no verification but
 * the estimate is still short. First come checks never passed on a first try;
 * after that, the least recently attempted one, so there is always a next
 * question.
 */
export function reviewCheck(learner, concept) {
  const checks = concept.checks ?? []
  if (checks.length === 0) return null
  const js = judgementsOf(learner, concept.id).filter((j) => j.activity === 'check' && j.correct !== null)
  const cleanPass = (id) => js.some((j) => j.taskId === id && j.correct && j.firstTry)
  const unclean = checks.find((c) => !cleanPass(c.id))
  if (unclean) return unclean
  const lastSeen = (id) => js.filter((j) => j.taskId === id).at(-1)?.ts ?? 0
  return checks.reduce((a, b) => (lastSeen(b.id) < lastSeen(a.id) ? b : a))
}

/** Verification attempts for a concept, oldest first. */
export function verifyAttempts(learner, conceptId) {
  return Object.values(learner.attempts)
    .filter((a) => a.conceptId === conceptId && a.activity === 'verify')
    .sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * How the most recent submitted verification went, or null.
 * `passed` is true only for an independent pass on the current task version.
 */
export function lastVerifyOutcome(learner, concept) {
  const submitted = verifyAttempts(learner, concept.id).filter((a) => a.submittedAt)
  const attempt = submitted.at(-1)
  if (!attempt) return null
  const j = learner.judgements.filter((x) => x.attemptId === attempt.id).at(-1)
  return {
    attempt,
    judgement: j ?? null,
    passed: Boolean(j?.correct && j.independent && j.resources === 'independent' && j.taskVersion === concept.verify?.version),
    assisted: Boolean(j?.assisted),
  }
}

/** Done means the step's capability is verified — or, where none is configured, guided work complete. */
export function conceptDone(learner, course, conceptId) {
  const c = course.concepts.find((x) => x.id === conceptId)
  if (!c) return false
  if (c.verify) {
    const s = capabilityStatus(learner, course, conceptId).status
    return s === 'verified' || s === 'transfer'
  }
  return guidedComplete(learner, course, conceptId)
}

/** Prerequisites not done yet, as advice for the navigation. */
export function suggestedFirst(learner, course, conceptId) {
  const c = course.concepts.find((x) => x.id === conceptId)
  return (c?.prerequisites ?? []).filter((p) => !conceptDone(learner, course, p))
    .map((p) => course.concepts.find((x) => x.id === p)).filter(Boolean)
}

/** Whether the learner has started a concept at all. */
export function conceptStarted(learner, conceptId) {
  return learner.judgements.some((j) => j.conceptId === conceptId)
    || learner.events.some((e) => e.conceptId === conceptId && e.object !== 'nav')
    || Boolean(learner.legacy?.concepts?.[conceptId])
}

/** The next concept not yet done, in prerequisite order. */
export function nextConcept(learner, course, after = null) {
  const order = topoOrder(course.concepts)
  const start = after ? order.findIndex((c) => c.id === after) + 1 : 0
  return order.slice(start).find((c) => !conceptDone(learner, course, c.id))
    ?? order.find((c) => !conceptDone(learner, course, c.id))
    ?? null
}

/** Course-level progress: steps done and capabilities verified. */
export function progress(learner, course) {
  const all = course.concepts
  const done = all.filter((c) => conceptDone(learner, course, c.id)).length
  // Only capabilities that have a verification configured can ever be verified.
  const caps = all.filter((c) => c.capability && c.verify)
  const verified = caps.filter((c) => ['verified', 'transfer'].includes(capabilityStatus(learner, course, c.id).status)).length
  return { done, total: all.length, verified, capabilities: caps.length, fraction: done / (all.length || 1) }
}

/**
 * Decide the next teaching action for a concept (the current one by default).
 *
 * Every action carries `why` (the recommendation), `basis` (the evidence it
 * rests on) and, where it names a task, `goal` (what that task will check).
 */
export function nextAction(learner, course, conceptId = learner.currentConceptId) {
  if (course.project && conceptId === course.project.id) {
    return { type: 'project', conceptId, why: '结课项目：用真实代码在陌生数据上完成一次完整的建模与取舍。' }
  }
  const concept = course.concepts.find((c) => c.id === conceptId) ?? nextConcept(learner, course)
  if (!concept) return { type: 'complete', why: '这门课的每一步都完成了。' }

  const state = learner.concepts[concept.id]
  const cap = concept.capability
  const capTitle = cap ? `「${cap.title}」` : `「${concept.title}」`
  const base = { conceptId: concept.id, capability: cap?.id ?? null }
  const js = judgementsOf(learner, concept.id)

  if (conceptDone(learner, course, concept.id)) {
    const next = nextConcept(learner, course, concept.id)
    const status = cap ? capabilityStatus(learner, course, concept.id) : null
    return {
      ...base, type: 'done', next: next?.id ?? null,
      why: concept.verify
        ? `${capTitle}已通过独立验证。${next ? `可以进入「${next.title}」，也可以留下来继续练。` : ''}`
        : `「${concept.title}」完成了。${next ? `下一步建议「${next.title}」。` : ''}`,
      basis: status?.basis ?? null,
    }
  }

  if (!state?.seenExplain) {
    return { ...base, type: 'explain', layer: 'intuition', why: `先建立「${concept.title}」的直觉。`, basis: '还没有读过这一步的讲解。' }
  }

  const catalogue = concept.misconceptions ?? []
  const active = activeMisconceptions(learner, concept.id).filter((m) => catalogue.some((x) => x.id === m.id))
  const open = openChecks(learner, concept, { pending: false })

  // A misconception the evidence supports comes first: drilling on top of a
  // wrong belief just practises it. Remediation needs a task that can show it
  // has been cleared on a fresh instance; without one it is shown, not enforced.
  const supported = active.find((m) => m.status === 'supported')
  if (supported) {
    const detail = catalogue.find((x) => x.id === supported.id)
    // Only a question this misconception has not already shown up on can
    // confirm it is cleared: a retry of the same one measures memory.
    const seenOn = new Set(supported.evidence.map((e) => learner.judgements.find((j) => j.id === e.judgementId)?.taskId).filter(Boolean))
    const check = open.find((c) => targetsOf(c).includes(supported.id) && !seenOn.has(c.id))
    const viaPractice = !check && (concept.practice?.targets ?? []).includes(supported.id)
    if (check || viaPractice) {
      return {
        ...base, type: 'remediate', misconceptionId: supported.id, misconception: detail,
        check: check ?? null, practice: viaPractice ? concept.practice : null,
        why: '有证据表明你可能持有一个具体的误解，先把它理清楚，再用一道新题确认。',
        basis: `${supported.evidence.length} 次作答指向它${supported.evidence.some((e) => e.strength === 'stated') ? '，其中包括你自己写下的理由' : ''}。`,
        goal: '这道题检验这个误解是否已经消除。',
      }
    }
  }

  // Repeatedly wrong without a diagnosed misconception: the explanation is not
  // landing, so tell it another way — while there is another way left.
  const recent = js.filter((j) => j.correct !== null).slice(-3)
  const struggling = recent.length >= 2 && recent.every((j) => j.correct === false)
  if (state.mastery < STRUGGLING_THRESHOLD && struggling) {
    const tried = new Set(state.layersSeen ?? [])
    const layer = LAYERS.find((l) => !tried.has(l))
    if (layer) {
      return {
        ...base, type: 'explain', layer, scaffold: true,
        why: `连着几次没答对，换一个角度重新讲「${concept.title}」。`,
        basis: `最近 ${recent.length} 次作答都没有答对。`,
      }
    }
  }

  if (concept.lab && !labAttempted(learner, concept.id)) {
    return {
      ...base, type: 'lab', lab: concept.lab,
      why: '先在实验里做一次判断，再看真实计算的结果。',
      basis: '这一步的实验还没有做过。',
      goal: '实验里的预测会和真实计算对照。',
    }
  }

  if (open.length > 0) {
    // A suspected misconception is a lead: send the learner to a question that
    // can confirm or rule it out, rather than treating it as established.
    const suspected = active.find((m) => m.status === 'suspected')
    const diag = suspected && open.find((c) => targetsOf(c).includes(suspected.id))
    const detail = suspected && catalogue.find((x) => x.id === suspected.id)
    if (diag) {
      return {
        ...base, type: 'check', check: diag, diagnose: suspected.id,
        why: '刚才的选择可能说明了一个想法，用这道题确认一下。',
        basis: `作答里出现了一个待核实的线索：「${detail?.belief ?? suspected.id}」。只是线索，还没有定论。`,
        goal: '这道题能区分你是否真的这么想。',
      }
    }
    return {
      ...base, type: 'check', check: open[0],
      why: js.some((j) => j.activity === 'check') ? `还有 ${open.length} 道课程题没做对过。` : `用课程题检验一下对「${concept.title}」的理解。`,
      basis: `这一步的课程题还剩 ${open.length} 道。`,
      goal: open[0].kind === 'mcq' ? '选出成立的说法。' : '用自己的话说清道理，按评分要点批改。',
    }
  }

  if (concept.verify) {
    const last = lastVerifyOutcome(learner, concept)
    const openVerify = verifyAttempts(learner, concept.id).find((a) => a.status === 'open')
    const n = concept.verify.items.length
    const verifyAction = (why, basis) => ({
      ...base, type: 'verify', verify: concept.verify,
      why, basis, goal: `${n} 道没见过的新题，全部独立答对即通过${capTitle}的独立验证。`,
    })
    if (openVerify) {
      return verifyAction(openVerify.converted ? '这次验证已转为辅助练习，做完它，再换一组新题独立验证。' : '继续完成进行中的独立验证。', '独立验证已经开始，草稿保存着。')
    }
    if (last && !last.passed && concept.practice) {
      // Record order, not timestamps: two records can share a millisecond.
      const at = js.findIndex((j) => j.id === last.judgement?.id)
      const since = js.slice(at + 1).filter((j) => j.activity === 'practice' && j.correct === true)
      if (since.length === 0) {
        return {
          ...base, type: 'practice', practice: concept.practice,
          why: last.assisted
            ? '上次验证用了帮助，只算辅助练习。先练一道新题，再换一组没见过的题独立验证。'
            : '上次验证没有全部答对。先练一道新题，再换一组没见过的题验证。',
          basis: `上次独立验证：${(last.judgement?.criteria ?? []).filter((c) => c.met).length}/${n} 项通过${last.assisted ? '，且使用了帮助' : ''}。`,
          goal: '练习题有即时反馈，不计入独立验证。',
          offerVerify: false,
        }
      }
    }
    if (state.mastery < MASTERY_THRESHOLD && concept.practice) {
      return {
        ...base, type: 'practice', practice: concept.practice, offerVerify: true,
        why: '引导题做完了，但早先的作答不太稳。建议先练一道新题；觉得有把握也可以直接开始独立验证。',
        basis: '课程题有首次答错或借助了提示的记录。',
        goal: '练习题有即时反馈，不计入独立验证。',
      }
    }
    return verifyAction(
      last && !last.passed ? '练过新题了，换一组没见过的题重新独立验证。' : `引导学习完成了，用没见过的新题独立验证${capTitle}。`,
      last && !last.passed ? '上次验证没通过，之后做对了新的练习题。' : '实验和课程题都已完成。无论之前答得多好，能力都要在没见过的题上独立验证。',
    )
  }

  // No verification configured: the legacy bar decides, with fresh practice first.
  if (concept.practice) {
    return {
      ...base, type: 'practice', practice: concept.practice,
      why: '课程题都做过了，换一道新题再练一次。', basis: '这一步没有配置独立验证，靠练习巩固。',
      goal: '练习题有即时反馈。',
    }
  }
  const review = reviewCheck(learner, concept)
  if (review) {
    return {
      ...base, type: 'check', check: review, review: true,
      why: '课程题都做过了，再做一遍巩固一下。', basis: '这一步没有练习题生成器，也没有配置独立验证。',
      goal: '重做一道课程题（不计入独立证据）。',
    }
  }
  return { ...base, type: 'explain', layer: 'formal', why: `再复习一遍「${concept.title}」的形式化定义。`, basis: null }
}

/** The decision plus the state behind it, for a "why am I seeing this?" affordance. */
export function explainDecision(learner, course, conceptId) {
  const action = nextAction(learner, course, conceptId)
  const concept = course.concepts.find((c) => c.id === action.conceptId)
  return {
    action,
    trace: {
      concept: concept?.title ?? null,
      capability: concept ? capabilityStatus(learner, course, concept.id).status : null,
      estimate: concept ? Number(learner.concepts[concept.id].mastery.toFixed(3)) : null,
      activeMisconceptions: concept ? activeMisconceptions(learner, concept.id).map((m) => `${m.id}:${m.status}`) : [],
      openChecks: concept ? openChecks(learner, concept).map((c) => c.id) : [],
    },
  }
}
