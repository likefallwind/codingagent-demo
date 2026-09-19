/**
 * Practice registry: the one place a `practice.type` named in a course document
 * is bound to a generator. The practice counterpart of registry.js, kept apart
 * from it because it must stay free of React — the server imports it to
 * regenerate a question from its id.
 */

import { fruitPractice } from './fruitTree/practice.js'
import { tennisPractice } from './playTennis/practice.js'

export const practiceGenerators = { ...fruitPractice, ...tennisPractice }

const PREFIX = 'p:'

export const practiceId = (type, seed) => `${PREFIX}${type}:${seed}`
export const isPracticeId = (id) => typeof id === 'string' && id.startsWith(PREFIX)

/**
 * The question a concept's practice spec produces for `seed`, shaped like an
 * authored multiple-choice check. Null when the type has no generator.
 */
export function generatePractice(practice, seed) {
  const gen = practiceGenerators[practice?.type]
  if (!gen || !Number.isInteger(seed) || seed < 0) return null
  const q = gen(seed, practice.config ?? {})
  return {
    ...q,
    id: practiceId(practice.type, seed),
    kind: 'mcq',
    generated: true,
    options: q.options.map((o) => {
      const out = { text: o.text }
      if (o.correct) out.correct = true
      if (o.misconception) out.misconception = o.misconception
      return out
    }),
  }
}

/** Rebuild a generated check from its id, if it belongs to this concept's practice. */
export function resolvePractice(concept, id) {
  if (!isPracticeId(id) || !concept.practice) return null
  const rest = id.slice(PREFIX.length)
  const cut = rest.lastIndexOf(':')
  const type = rest.slice(0, cut)
  const seed = Number(rest.slice(cut + 1))
  if (type !== concept.practice.type) return null
  return generatePractice(concept.practice, seed)
}
