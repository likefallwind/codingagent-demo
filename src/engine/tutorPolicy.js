/**
 * When the tutor may speak unprompted, and how help escalates — as versioned
 * configuration rather than constants buried in a component.
 *
 * The thresholds are the prototype's starting values. They have not been
 * validated as the best moments to intervene; the version is recorded on every
 * help record so a pilot can tell which setting a learner was under.
 */

export const TUTOR_POLICY = Object.freeze({
  version: 'tutor-policy-2026.09-1',
  /** No activity for this long (page visible) earns an invitation, never a claim that the learner is stuck. */
  idleMs: 60000,
  /** Minimum gap between unprompted invitations. */
  nudgeGapMs: 40000,
  /** Remarks tied to something the learner just did may come sooner. */
  momentGapMs: 8000,
  /** A slider reversed this often within the window counts as back-and-forth comparing. */
  thrashFlips: 4,
  thrashWindowMs: 20000,
  /** A queued remark older than this is about something the learner has moved past. */
  momentMaxAgeMs: 60000,
  /** How many earlier turns of the same task a follow-up question carries. */
  historyTurns: 6,
  note: '初始设置，沿用原型阈值，尚未经试点验证是最佳时机。',
})

/** The policy in force, with `?idle=5` (seconds) honoured for testing. */
export function tutorPolicy(search = typeof window !== 'undefined' ? window.location.search : '') {
  try {
    const v = Number(new URLSearchParams(search).get('idle'))
    if (v > 0) return { ...TUTOR_POLICY, idleMs: v * 1000, version: `${TUTOR_POLICY.version}+idle${v}` }
  } catch { /* fall through */ }
  return TUTOR_POLICY
}

/**
 * Help levels, weakest first. Each request in the same task goes one level up;
 * the learner can always stop at a weaker one. Level 5 shows a full solution and
 * is recorded as such: the attempt it touches counts as assisted learning.
 */
export const HELP_LEVELS = [
  { level: 1, key: 'look', label: '指出该看哪里', ask: '给我一个提示' },
  { level: 2, key: 'question', label: '提一个思考问题', ask: '再具体一点' },
  { level: 3, key: 'example', label: '给一个对比例子', ask: '给我一个对比的例子' },
  { level: 4, key: 'steps', label: '给出部分步骤', ask: '给我部分步骤' },
  { level: 5, key: 'solution', label: '讲完整解法', ask: '直接讲解法' },
]

export const helpLevel = (n) => HELP_LEVELS.find((h) => h.level === n) ?? HELP_LEVELS[0]
