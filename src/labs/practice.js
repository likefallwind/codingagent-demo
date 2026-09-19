/**
 * Generator registry: the one place a `practice.type` or a verification item's
 * `type` named in a course document is bound to a generator. The generated
 * counterpart of registry.js, kept apart from it because it must stay free of
 * React — the server imports it to rebuild a question from its id.
 *
 * Two id spaces, so a question can always be rebuilt without trusting the
 * client's copy:
 *   p:<type>:<seed>                 practice, seeds from 0
 *   v:<conceptId>:<item>:<seed>     verification items, seeds from 1 000 000
 * Practice and verification never share seeds, and tasks.js additionally
 * refuses any instance whose content the learner has already met.
 */

import { fruitPractice } from './fruitTree/practice.js'
import { tennisPractice } from './playTennis/practice.js'

export const practiceGenerators = { ...fruitPractice, ...tennisPractice }

/** Bumped whenever any generator's output for a given seed changes. */
export const GENERATOR_VERSION = 'gen-2026.09-1'

export const practiceId = (type, seed) => `p:${type}:${seed}`
export const verifyItemId = (conceptId, index, seed) => `v:${conceptId}:${index}:${seed}`
export const isPracticeId = (id) => typeof id === 'string' && (id.startsWith('p:') || id.startsWith('v:'))

/** Build one generated multiple-choice question, shaped like an authored check. */
function build(spec, seed, id) {
  const gen = practiceGenerators[spec?.type]
  if (!gen || !Number.isInteger(seed) || seed < 0) return null
  let q
  try {
    q = gen(seed, spec.config ?? {})
  } catch {
    return null
  }
  if (!q || !Array.isArray(q.options)) return null
  const options = q.options.map((o) => {
    const out = { text: o.text }
    if (o.correct) out.correct = true
    if (o.misconception) out.misconception = o.misconception
    return out
  })
  return {
    ...q,
    id,
    type: spec.type,
    kind: 'mcq',
    generated: true,
    generatorVersion: GENERATOR_VERSION,
    options,
    targets: [...new Set(options.map((o) => o.misconception).filter(Boolean))],
  }
}

/** The practice question a concept's practice spec produces for `seed`. */
export function generatePractice(practice, seed) {
  return build(practice, seed, practiceId(practice?.type, seed))
}

/** Verification item `index` of a concept for `seed`. */
export function generateVerifyItem(concept, index, seed) {
  const spec = concept?.verify?.items?.[index]
  return spec ? build(spec, seed, verifyItemId(concept.id, index, seed)) : null
}

/** Rebuild a generated check from its id, if it belongs to this concept. */
export function resolvePractice(concept, id) {
  if (typeof id !== 'string') return null
  if (id.startsWith('p:')) {
    if (!concept.practice) return null
    const rest = id.slice(2)
    const cut = rest.lastIndexOf(':')
    const type = rest.slice(0, cut)
    const seed = Number(rest.slice(cut + 1))
    if (type !== concept.practice.type) return null
    return generatePractice(concept.practice, seed)
  }
  if (id.startsWith('v:')) {
    const [, conceptId, index, seed] = id.split(':')
    if (conceptId !== concept.id) return null
    return generateVerifyItem(concept, Number(index), Number(seed))
  }
  return null
}
