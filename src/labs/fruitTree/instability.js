/**
 * The arithmetic behind step 7: how much a tree changes when the orchard gives
 * you a different batch of fruit.
 *
 * Pure and synchronous, like cart.js. The lab and test/course.test.js both call
 * these, so every figure the lesson quotes is the figure the learner sees.
 */

import { grow, predict, errRate, leafCount, splitLabel } from './cart.js'
import { BATCH_SEEDS, batchTrain, PROBE, VAL, APPLE, ORANGE } from './dataset.js'

export const BATCH_COUNT = BATCH_SEEDS.length

const batchCache = new Map()
/** Training rows of batch `i`, computed once. */
export function batch(i) {
  if (!batchCache.has(i)) batchCache.set(i, batchTrain(i))
  return batchCache.get(i)
}

const treeCache = new Map()
/** The tree batch `i` grows at `depth`, computed once. */
export function batchTree(i, depth) {
  const key = `${i}:${depth}`
  if (!treeCache.has(key)) treeCache.set(key, grow(batch(i), 0, depth, 1))
  return treeCache.get(key)
}

/** Mean fraction of `probe` rows on which two trees disagree, over every pair. */
export function disagreement(trees, probe = PROBE) {
  let sum = 0
  let pairs = 0
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      let k = 0
      for (const r of probe) if (predict(trees[i], r) !== predict(trees[j], r)) k++
      sum += k / probe.length
      pairs++
    }
  }
  return pairs ? sum / pairs : 0
}

/** Majority vote of several trees; ties go to apple, deterministically. */
export function vote(trees, row) {
  let apples = 0
  for (const t of trees) if (predict(t, row) === APPLE) apples++
  return apples * 2 >= trees.length ? APPLE : ORANGE
}

export function voteError(trees, rows = VAL) {
  let bad = 0
  for (const r of rows) if (vote(trees, r) !== r.c) bad++
  return bad / rows.length
}

/** What the lab puts on screen for the first `k` batches at one depth. */
export function snapshot(depth, k) {
  const trees = Array.from({ length: k }, (_, i) => batchTree(i, depth))
  const items = trees.map((t, i) => ({
    i,
    tree: t,
    root: t.split ? splitLabel(t.split.key, t.split.thr) : '（没有分裂）',
    second: t.split && t.right.split ? splitLabel(t.right.split.key, t.right.split.thr) : null,
    leaves: leafCount(t),
    va: errRate(t, VAL),
  }))
  return {
    items,
    sameRoot: items.every((x) => x.root === items[0].root),
    leafRange: [Math.min(...items.map((x) => x.leaves)), Math.max(...items.map((x) => x.leaves))],
    disagree: k > 1 ? disagreement(trees) : null,
    meanVa: items.reduce((s, x) => s + x.va, 0) / items.length,
    voteVa: k > 1 ? voteError(trees) : null,
  }
}

const profileCache = new Map()
/** Disagreement across all eight batches at each depth — the chart under the lab. */
export function profile(depths) {
  return depths.map((d) => {
    if (!profileCache.has(d)) {
      const trees = Array.from({ length: BATCH_COUNT }, (_, i) => batchTree(i, d))
      profileCache.set(d, disagreement(trees))
    }
    return { d, disagree: profileCache.get(d) }
  })
}
