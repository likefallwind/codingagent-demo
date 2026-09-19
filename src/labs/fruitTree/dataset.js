/**
 * The fruit dataset behind the decision-tree lesson.
 *
 * Two populations, and they do different jobs:
 *
 *  - SAMPLES: 16 hand-picked fruits. Small enough that a learner can check every
 *    gini figure by hand, which is the whole point of steps 1-3.
 *  - BIG / TRAIN / VAL: 300 generated fruits, split 80/20. You cannot show
 *    overfitting on 16 rows — there is no room for a tree to memorise. Steps 4-6
 *    need a population big enough for train and validation error to come apart.
 *
 * Generation is a seeded LCG, so every learner sees the same curve and the same
 * "best depth". The lesson text refers to specific numbers; a random dataset
 * would make that text wrong on most loads.
 */

export const APPLE = 'apple'
export const ORANGE = 'orange'

/** Peel thickness is ordinal: 1 thin < 2 medium < 3 thick. */
export const PEEL_LABEL = { 1: '薄', 2: '中', 3: '厚' }

export const FEATURES = [
  { key: 'peel', name: '果皮厚度', kind: 'ordinal' },
  { key: 'w', name: '重量', kind: 'numeric', unit: 'g' },
  { key: 'aroma', name: '果香', kind: 'binary' },
]

/** The 16 teaching samples. Apples are lighter and thin-skinned; oranges heavier. */
export const SAMPLES = [
  { c: APPLE, w: 132, peel: 1, aroma: 1 }, { c: APPLE, w: 145, peel: 1, aroma: 1 },
  { c: APPLE, w: 150, peel: 1, aroma: 0 }, { c: APPLE, w: 158, peel: 1, aroma: 1 },
  { c: APPLE, w: 165, peel: 1, aroma: 1 }, { c: APPLE, w: 172, peel: 1, aroma: 1 },
  { c: APPLE, w: 186, peel: 1, aroma: 1 }, { c: APPLE, w: 195, peel: 2, aroma: 0 },
  { c: ORANGE, w: 168, peel: 2, aroma: 1 }, { c: ORANGE, w: 175, peel: 2, aroma: 1 },
  { c: ORANGE, w: 190, peel: 2, aroma: 1 }, { c: ORANGE, w: 205, peel: 3, aroma: 1 },
  { c: ORANGE, w: 215, peel: 3, aroma: 1 }, { c: ORANGE, w: 228, peel: 3, aroma: 1 },
  { c: ORANGE, w: 240, peel: 3, aroma: 1 }, { c: ORANGE, w: 252, peel: 3, aroma: 1 },
]

/**
 * Generate the large population.
 *
 * The underlying rule is deliberately learnable but not trivial: peel decides
 * most cases, weight breaks the medium-peel tie, and aroma matters only for
 * thick peel. 8% of labels are then flipped as noise — without that the tree
 * would reach zero validation error and there would be no overfitting to see.
 */
export function generatePopulation(seed = 20240616, n = 300) {
  let s = seed
  // LCG (Numerical Recipes constants). Values stay under 2^53 so the integer
  // arithmetic is exact in a JS number.
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }

  const rows = []
  for (let i = 0; i < n; i++) {
    const w = Math.round(112 + rnd() * 156)
    const u = rnd()
    const peel = u < 0.38 ? 1 : u < 0.72 ? 2 : 3
    const aroma = rnd() < 0.68 ? 1 : 0

    let c
    if (peel === 1) c = APPLE
    else if (peel === 2) c = w <= 185 ? APPLE : ORANGE
    else c = aroma ? ORANGE : w <= 200 ? APPLE : ORANGE

    if (rnd() < 0.08) c = c === APPLE ? ORANGE : APPLE // label noise
    rows.push({ c, w, peel, aroma })
  }
  return rows
}

export const POPULATION = generatePopulation()

/**
 * Deterministic every-fifth holdout. Not shuffled: the generator already emits
 * rows in no meaningful order, and a fixed stride keeps the split reproducible.
 */
export const holdout = (rows) => ({
  train: rows.filter((_, i) => i % 5 !== 0),
  val: rows.filter((_, i) => i % 5 === 0),
})

export const { train: TRAIN, val: VAL } = holdout(POPULATION)

/**
 * Other harvests from the same orchard, for the instability step: same rule,
 * same noise rate, different fruit. Batch 0 is the training set every earlier
 * step used, so the learner starts from the tree they already know.
 */
export const BATCH_SEEDS = [20240616, 11, 22, 33, 44, 55, 66, 77]
export const batchTrain = (i) => (i === 0 ? TRAIN : generatePopulation(BATCH_SEEDS[i], TRAIN.length))

/** 600 fruits no tree has trained on — the yardstick for "do two trees disagree". */
export const PROBE = generatePopulation(777, 600)

export const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8]

export const classLabel = (c) => (c === APPLE ? '苹果' : '橙子')
export const classEmoji = (c) => (c === APPLE ? '🍎' : '🍊')
