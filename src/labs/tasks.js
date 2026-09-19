/**
 * Task instances: which concrete question a learner gets, and how the record
 * knows whether they have met it before.
 *
 * An instance is identified by its content — prompt, table, diagram and the
 * option texts as a set — so the same question reached through another seed,
 * or with its options shuffled, is the same instance. That is what makes the
 * two guarantees checkable:
 *
 *   - practice and verification never hand a learner an instance they have
 *     already met (and so perhaps already seen the answer to);
 *   - a verification instance is valid (one correct option, distinct options,
 *     rebuilt identically from its seed) or it is not used. When no valid unseen
 *     instance can be built, the verification says so; it is never skipped.
 *
 * Pure and React-free: the server and the tests use it too.
 */

import { generatePractice, generateVerifyItem } from './practice.js'
import { contentHash } from '../engine/ids.js'

export const VERIFY_SEED_BASE = 1_000_000

/** The instance key of a generated question. */
export function instanceKeyOf(q) {
  return `gen:${q.type}:${contentHash({
    p: q.prompt, t: q.table ?? null, d: q.diagram ?? null, o: q.options.map((o) => o.text).sort(),
  })}`
}

/** The instance key of an authored check — its content is part of it, so an edited check is a new instance. */
export function checkInstanceKey(conceptId, check) {
  return `check:${conceptId}:${check.id}:${contentHash({ p: check.prompt, o: (check.options ?? []).map((o) => o.text).sort() })}`
}

/** The instance key of a judgement a lab asks for. */
export const labInstanceKey = (conceptId, labType, step) => `lab:${conceptId}:${labType}:${step}`

/** Problems that make a generated question unusable, or [] if it is sound. */
export function validateGenerated(q) {
  const errs = []
  if (!q) return ['没有生成出题目']
  if (typeof q.prompt !== 'string' || !q.prompt.trim()) errs.push('题干为空')
  if (!Array.isArray(q.options) || q.options.length < 3) errs.push('选项少于 3 个')
  const right = (q.options ?? []).filter((o) => o.correct)
  if (right.length !== 1) errs.push(`正确选项有 ${right.length} 个`)
  const texts = (q.options ?? []).map((o) => o.text)
  if (texts.some((t) => typeof t !== 'string' || !t.trim())) errs.push('有空选项')
  if (new Set(texts).size !== texts.length) errs.push('选项文字重复')
  return errs
}

const attemptsOf = (learner, conceptId, activity) =>
  Object.values(learner.attempts).filter((a) => a.conceptId === conceptId && a.activity === activity)

/**
 * The practice question to show next: the open one if there is one (a refresh
 * brings back the same question and its record), otherwise the first fresh,
 * valid, unseen instance.
 */
export function practiceInstance(learner, concept, { target = null } = {}) {
  if (!concept?.practice) return null
  const attempts = attemptsOf(learner, concept.id, 'practice')
  const open = attempts.find((a) => a.status === 'open' && Number.isInteger(a.seed))
  if (open) {
    const q = generatePractice(concept.practice, open.seed)
    if (q && instanceKeyOf(q) === open.instanceKey) return { check: q, seed: open.seed, instanceKey: open.instanceKey, resumed: true }
  }
  // When the question is meant to confirm a misconception is cleared, prefer
  // one that can: an option the misconception would pick. Otherwise the first
  // fresh, valid, unseen one.
  let seed = attempts.reduce((m, a) => Math.max(m, Number.isInteger(a.seed) ? a.seed + 1 : 0), 0)
  let fallback = null
  for (let k = 0; k < 40; k++, seed++) {
    const q = generatePractice(concept.practice, seed)
    if (!q) break
    if (validateGenerated(q).length) continue
    const key = instanceKeyOf(q)
    if (learner.instances[key]) continue
    const found = { check: q, seed, instanceKey: key }
    if (!target || q.targets?.includes(target)) return found
    fallback ??= found
  }
  return fallback
}

/**
 * The verification to show: the open one rebuilt from its seeds, or a new round
 * of unseen, validated, reproducible items.
 *
 * Returns { items, seeds, parts, instanceKey } or { unavailable: true, reason }.
 */
export function verifyInstance(learner, concept) {
  const v = concept?.verify
  if (!v) return null
  const attempts = attemptsOf(learner, concept.id, 'verify')
  const open = attempts.find((a) => a.status === 'open')
  if (open?.items) {
    const items = open.items.map((it) => generateVerifyItem(concept, it.index, it.seed))
    const keys = items.map((q) => (q ? instanceKeyOf(q) : null))
    if (items.every(Boolean) && (!open.parts || keys.every((k, i) => k === open.parts[i]))) {
      return { items, seeds: open.items, parts: keys, instanceKey: open.instanceKey, attemptId: open.id, resumed: true }
    }
    return { unavailable: true, stale: open.id, reason: '进行中的验证题无法按原样重建（题目生成器已经更新）。这一次不计入，换一组新题。' }
  }

  const used = new Set(Object.keys(learner.instances))
  const problems = []
  for (let r = attempts.length; r < attempts.length + 20; r++) {
    const items = []
    const seeds = []
    const keys = []
    let ok = true
    for (let i = 0; i < v.items.length && ok; i++) {
      let found = null
      for (let k = 0; k < 12 && !found; k++) {
        const seed = VERIFY_SEED_BASE + r * 1000 + i * 100 + k
        const q = generateVerifyItem(concept, i, seed)
        const errs = validateGenerated(q)
        if (errs.length) { problems.push(`${v.items[i].type}@${seed}：${errs.join('，')}`); continue }
        const key = instanceKeyOf(q)
        const again = generateVerifyItem(concept, i, seed)
        if (!again || instanceKeyOf(again) !== key) { problems.push(`${v.items[i].type}@${seed}：同一种子重建结果不一致`); continue }
        if (used.has(key) || keys.includes(key)) continue
        found = { q, seed, key }
      }
      if (!found) { ok = false; break }
      items.push(found.q)
      seeds.push({ index: i, seed: found.seed })
      keys.push(found.key)
    }
    if (ok) return { items, seeds, parts: keys, instanceKey: `verify:${concept.id}:${v.version}:${contentHash(keys)}`, round: r }
  }
  return { unavailable: true, reason: '暂时生成不出可靠的新验证题，所以现在无法验证这项能力（不会跳过验证，也不会直接算通过）。', problems: problems.slice(0, 8) }
}
