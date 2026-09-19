/**
 * CART: binary splits, gini impurity, numeric thresholds.
 *
 * This is the algorithm the fruit lesson teaches, and it differs from the ID3
 * implementation in ../decisionTree/algo.js in three ways that matter
 * pedagogically: splits are always binary (not one branch per category), the
 * criterion is gini (not information gain), and continuous features are handled
 * by enumerating candidate thresholds rather than treating each value as a class.
 *
 * Everything is pure and synchronous. The learner's actions are graded by these
 * functions instantly; the language model never decides whether an answer is
 * right, it only explains why.
 */

import { APPLE, ORANGE, PEEL_LABEL } from './dataset.js'

/** Class counts for a set of rows. */
export function counts(rows) {
  let a = 0
  for (const r of rows) if (r.c === APPLE) a++
  return { a, o: rows.length - a, n: rows.length }
}

/** Gini impurity for the two-class case. 0 = pure, 0.5 = evenly mixed. */
export function gini(rows) {
  if (rows.length === 0) return 0
  const { a, n } = counts(rows)
  const p = a / n
  return 1 - p * p - (1 - p) * (1 - p)
}

/** A set is pure when one class is absent. */
export const isPure = (rows) => {
  const c = counts(rows)
  return c.n > 0 && (c.a === 0 || c.o === 0)
}

/** Split into (<= threshold) and (> threshold). Left is always the "yes" branch. */
export function splitRows(rows, key, thr) {
  const l = []
  const r = []
  for (const row of rows) (row[key] <= thr ? l : r).push(row)
  return [l, r]
}

/** The question a split asks, phrased the way the UI shows it. */
export function splitLabel(key, thr) {
  if (key === 'w') return `重量 ≤ ${thr} g`
  if (key === 'peel') return thr === 1 ? '果皮 = 薄' : `果皮 ≤ ${PEEL_LABEL[thr]}`
  return '无果香'
}

/**
 * Candidate splits.
 *
 * For the continuous weight, thresholds sit at the midpoint between consecutive
 * observed values — any cut between two neighbours partitions the data
 * identically, so the midpoints are the only distinct choices worth scoring.
 * Peel and aroma have a fixed, small set of meaningful cut points.
 */
export function candidates(rows, keys = null) {
  const out = []
  const ws = [...new Set(rows.map((r) => r.w))].sort((x, y) => x - y)
  for (let i = 0; i + 1 < ws.length; i++) {
    out.push({ key: 'w', thr: Math.round((ws[i] + ws[i + 1]) / 2) })
  }
  out.push({ key: 'peel', thr: 1 }, { key: 'peel', thr: 2 }, { key: 'aroma', thr: 0 })
  return keys ? out.filter((c) => keys.includes(c.key)) : out
}

/**
 * Gini decrease from one split. Returns -1 for a split that puts everything on
 * one side, which is not a split at all.
 */
export function gainOf(rows, key, thr) {
  const [l, r] = splitRows(rows, key, thr)
  if (!l.length || !r.length) return -1
  return gini(rows) - (l.length * gini(l) + r.length * gini(r)) / rows.length
}

/** Highest-gain split respecting a minimum leaf size, or null if none qualifies. `keys` limits the features. */
export function bestSplit(rows, minLeaf = 1, keys = null) {
  let best = null
  for (const c of candidates(rows, keys)) {
    const [l, r] = splitRows(rows, c.key, c.thr)
    if (l.length < minLeaf || r.length < minLeaf) continue
    const g = gainOf(rows, c.key, c.thr)
    // 1e-9 rather than 0: a split with no real gain should not be taken just
    // because of floating-point dust.
    if (g > 1e-9 && (!best || g > best.gain)) best = { key: c.key, thr: c.thr, gain: g, l, r }
  }
  return best
}

/** Best split available for one specific feature — used to rank features. */
export function bestSplitFor(rows, key, minLeaf = 1) {
  let best = null
  for (const c of candidates(rows)) {
    if (c.key !== key) continue
    const [l, r] = splitRows(rows, c.key, c.thr)
    if (l.length < minLeaf || r.length < minLeaf) continue
    const g = gainOf(rows, c.key, c.thr)
    if (!best || g > best.gain) best = { key, thr: c.thr, gain: g, l, r }
  }
  return best
}

/** Grow a tree greedily to the given limits, optionally over a subset of the features. */
export function grow(rows, depth, maxDepth, minLeaf = 1, keys = null) {
  const cn = counts(rows)
  const node = { n: rows.length, cls: cn.a >= cn.o ? APPLE : ORANGE, a: cn.a, o: cn.o, rows }
  if (depth >= maxDepth || cn.a === 0 || cn.o === 0) return node
  const b = bestSplit(rows, minLeaf, keys)
  if (!b) return node
  node.split = { key: b.key, thr: b.thr, gain: b.gain }
  node.left = grow(b.l, depth + 1, maxDepth, minLeaf, keys)
  node.right = grow(b.r, depth + 1, maxDepth, minLeaf, keys)
  return node
}

/** Walk a row down the tree to its leaf label. */
export function predict(node, row) {
  let n = node
  while (n.split) n = row[n.split.key] <= n.split.thr ? n.left : n.right
  return n.cls
}

/** The sequence of questions one row answers on its way down — for the quiz view. */
export function decisionPath(node, row) {
  const path = []
  let n = node
  while (n.split) {
    const yes = row[n.split.key] <= n.split.thr
    path.push({ question: splitLabel(n.split.key, n.split.thr), answer: yes, n: n.n })
    n = yes ? n.left : n.right
  }
  return { path, leaf: n }
}

export function errRate(node, rows) {
  if (rows.length === 0) return 0
  let bad = 0
  for (const r of rows) if (predict(node, r) !== r.c) bad++
  return bad / rows.length
}

export const leafCount = (n) => (n.split ? leafCount(n.left) + leafCount(n.right) : 1)
export const treeDepth = (n) => (n.split ? 1 + Math.max(treeDepth(n.left), treeDepth(n.right)) : 0)

/** Misclassified rows in a node if it were made a leaf — the minority class. */
export const nodeMistakes = (rows) => {
  const c = counts(rows)
  return Math.min(c.a, c.o)
}

/**
 * Train and validation error at each depth, plus the depth that generalises best.
 * This is the data behind step 5: training error falls monotonically while
 * validation error turns back up, and the gap between them is overfitting.
 */
export function learningCurve(train, val, depths, minLeaf = 1) {
  const trees = {}
  for (const d of depths) trees[d] = grow(train, 0, d, minLeaf)
  const curve = depths.map((d) => ({
    d,
    tr: errRate(trees[d], train),
    va: errRate(trees[d], val),
    leaves: leafCount(trees[d]),
  }))
  const best = curve.reduce((m, p) => (p.va < m.va ? p : m), curve[0]).d
  return { trees, curve, best }
}

/** Rank the three features by the best split each can offer on `rows`. */
export function rankFeatures(rows, features, minLeaf = 1) {
  return features
    .map((f) => {
      const b = bestSplitFor(rows, f.key, minLeaf)
      return {
        key: f.key,
        name: f.name,
        gain: b ? b.gain : 0,
        thr: b ? b.thr : null,
        condition: b ? splitLabel(f.key, b.thr) : '无有效分裂',
        left: b ? b.l : [],
        right: b ? b.r : [],
      }
    })
    .sort((x, y) => y.gain - x.gain)
}

export { APPLE, ORANGE }

/**
 * Build a tree whose SHAPE is authored but whose NUMBERS are computed.
 *
 * Needed because the lesson opens by teaching two things the greedy algorithm
 * cannot demonstrate on this dataset: how to read a tree, and that a leaf is
 * allowed to contain mistakes. Grown with all three features, the optimal
 * depth-2 tree here is perfect — `无果香` isolates the single aroma-less apple —
 * so there is no impure leaf to point at. An authored tree that asks
 * `重量 ≤ 180` instead leaves one apple among six oranges, which is the thing
 * step 1 needs on screen.
 *
 * Every count, class and gini figure below is still derived from the real rows,
 * so nothing shown to the learner is invented. Only the choice of question is
 * the author's. `authored: true` marks such nodes so the UI can be honest that
 * this is an illustration rather than the algorithm's own answer.
 */
export function buildFromSpec(rows, spec) {
  const cn = counts(rows)
  const node = { n: rows.length, cls: cn.a >= cn.o ? APPLE : ORANGE, a: cn.a, o: cn.o, rows, authored: true }
  if (!spec) return node
  const [l, r] = splitRows(rows, spec.key, spec.thr)
  node.split = { key: spec.key, thr: spec.thr, gain: gainOf(rows, spec.key, spec.thr) }
  node.left = buildFromSpec(l, spec.left)
  node.right = buildFromSpec(r, spec.right)
  return node
}

/**
 * The tree step 1 puts on screen: peel first, then weight. See `buildFromSpec`
 * for why this is authored rather than grown.
 */
export const ILLUSTRATIVE_SPEC = {
  key: 'peel', thr: 1,
  left: null, // 7 pure apples — becomes a leaf immediately
  right: { key: 'w', thr: 180, left: null, right: null },
}
