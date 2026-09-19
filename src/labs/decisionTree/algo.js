/**
 * Decision-tree mathematics. Pure functions, no dependencies — the lab UI and the
 * node test suite both import these, so correctness here is the thing the whole
 * interactive experience rests on.
 *
 * Vocabulary: a `row` is a plain object of feature -> value plus the target
 * attribute; `rows` is an array of them. Everything is categorical, which is all
 * the classic teaching datasets need.
 */

const log2 = (x) => Math.log(x) / Math.LN2

/** Count occurrences of each distinct value of `attr`. */
export function counts(rows, attr) {
  const out = new Map()
  for (const r of rows) out.set(r[attr], (out.get(r[attr]) ?? 0) + 1)
  return out
}

/** Distinct values of `attr`, in first-seen order so the UI stays stable. */
export function values(rows, attr) {
  return [...counts(rows, attr).keys()]
}

/** Shannon entropy of the target distribution, in bits. Empty set is 0. */
export function entropy(rows, target) {
  if (rows.length === 0) return 0
  let h = 0
  for (const n of counts(rows, target).values()) {
    const p = n / rows.length
    if (p > 0) h -= p * log2(p)
  }
  return h
}

/** Gini impurity of the target distribution. Empty set is 0. */
export function gini(rows, target) {
  if (rows.length === 0) return 0
  let g = 1
  for (const n of counts(rows, target).values()) {
    const p = n / rows.length
    g -= p * p
  }
  return g
}

/** Partition rows by each distinct value of `feature`. */
export function partition(rows, feature) {
  const parts = new Map()
  for (const r of rows) {
    if (!parts.has(r[feature])) parts.set(r[feature], [])
    parts.get(r[feature]).push(r)
  }
  return parts
}

/**
 * Weighted impurity remaining after splitting on `feature`.
 * `measure` is entropy or gini.
 */
export function weightedImpurity(rows, feature, target, measure = entropy) {
  if (rows.length === 0) return 0
  let acc = 0
  for (const part of partition(rows, feature).values()) {
    acc += (part.length / rows.length) * measure(part, target)
  }
  return acc
}

/** Information gain: entropy before minus weighted entropy after. */
export function infoGain(rows, feature, target) {
  return entropy(rows, target) - weightedImpurity(rows, feature, target, entropy)
}

/** Gini decrease: gini before minus weighted gini after (CART's criterion). */
export function giniGain(rows, feature, target) {
  return gini(rows, target) - weightedImpurity(rows, feature, target, gini)
}

/**
 * Split information — the entropy of the partition sizes themselves. This is the
 * term that punishes many-valued features, and it is exactly what a learner who
 * thinks "pick the feature with the most values" is missing.
 */
export function splitInfo(rows, feature) {
  if (rows.length === 0) return 0
  let si = 0
  for (const part of partition(rows, feature).values()) {
    const p = part.length / rows.length
    if (p > 0) si -= p * log2(p)
  }
  return si
}

/** Gain ratio (C4.5): information gain normalised by split information. */
export function gainRatio(rows, feature, target) {
  const si = splitInfo(rows, feature)
  // A feature with one distinct value has si === 0 and gain 0; ratio is undefined,
  // so report 0 rather than NaN.
  return si === 0 ? 0 : infoGain(rows, feature, target) / si
}

export const CRITERIA = {
  infoGain: { label: '信息增益', short: 'IG', fn: infoGain, impurity: entropy, impurityLabel: '熵', algo: 'ID3' },
  gainRatio: { label: '增益率', short: 'GR', fn: gainRatio, impurity: entropy, impurityLabel: '熵', algo: 'C4.5' },
  giniGain: { label: '基尼减少量', short: 'ΔGini', fn: giniGain, impurity: gini, impurityLabel: '基尼', algo: 'CART' },
}

/**
 * Score every candidate feature under one criterion, best first.
 * Returns the full ranking, not just the winner — the lab shows the learner the
 * whole table so a wrong pick can be compared against the right one.
 */
export function rankFeatures(rows, features, target, criterion = 'infoGain') {
  const { fn } = CRITERIA[criterion]
  return features
    .map((f) => ({
      feature: f,
      score: fn(rows, f, target),
      infoGain: infoGain(rows, f, target),
      gainRatio: gainRatio(rows, f, target),
      giniGain: giniGain(rows, f, target),
      splitInfo: splitInfo(rows, f),
      branches: partition(rows, f).size,
    }))
    .sort((a, b) => b.score - a.score)
}

/** The single best feature under `criterion`, or null when none are left. */
export function bestFeature(rows, features, target, criterion = 'infoGain') {
  if (features.length === 0 || rows.length === 0) return null
  return rankFeatures(rows, features, target, criterion)[0]
}

/** Majority target label, ties broken by first-seen order for determinism. */
export function majority(rows, target) {
  let best = null
  let bestN = -1
  for (const [label, n] of counts(rows, target)) {
    if (n > bestN) {
      best = label
      bestN = n
    }
  }
  return best
}

/**
 * Grow a full tree greedily. Nodes carry the rows that reached them so the UI can
 * show "what is in this node" without recomputing the path.
 */
export function buildTree(rows, features, target, opts = {}) {
  const { criterion = 'infoGain', maxDepth = Infinity, minSamples = 1, depth = 0 } = opts

  const leaf = (reason) => ({
    kind: 'leaf',
    label: majority(rows, target),
    rows,
    depth,
    reason,
    impurity: CRITERIA[criterion].impurity(rows, target),
  })

  if (rows.length === 0) return { kind: 'leaf', label: null, rows, depth, reason: 'empty', impurity: 0 }
  if (counts(rows, target).size === 1) return leaf('pure')
  if (features.length === 0) return leaf('no-features')
  if (depth >= maxDepth) return leaf('max-depth')
  if (rows.length < minSamples) return leaf('min-samples')

  const pick = bestFeature(rows, features, target, criterion)
  // No split separates anything (all candidate gains are zero) — stop here rather
  // than splitting arbitrarily.
  if (!pick || pick.score <= 0) return leaf('no-gain')

  const rest = features.filter((f) => f !== pick.feature)
  const children = []
  for (const [value, part] of partition(rows, pick.feature)) {
    children.push({
      value,
      node: buildTree(part, rest, target, { ...opts, depth: depth + 1 }),
    })
  }

  return {
    kind: 'split',
    feature: pick.feature,
    score: pick.score,
    criterion,
    rows,
    depth,
    impurity: CRITERIA[criterion].impurity(rows, target),
    children,
  }
}

/** Classify one row by walking the tree; unseen branch values fall back to majority. */
export function classify(tree, row, target) {
  let node = tree
  while (node.kind === 'split') {
    const next = node.children.find((c) => c.value === row[node.feature])
    if (!next) return majority(node.rows, target)
    node = next.node
  }
  return node.label
}

/** Training accuracy of a tree on the rows it was grown from. */
export function accuracy(tree, rows, target) {
  if (rows.length === 0) return 0
  let ok = 0
  for (const r of rows) if (classify(tree, r, target) === r[target]) ok++
  return ok / rows.length
}

/** Total node count, for "your tree vs the optimal tree" comparisons. */
export function countNodes(node) {
  if (node.kind === 'leaf') return 1
  return 1 + node.children.reduce((n, c) => n + countNodes(c.node), 0)
}

/** Depth of the deepest leaf. */
export function treeDepth(node) {
  if (node.kind === 'leaf') return 1
  return 1 + Math.max(...node.children.map((c) => treeDepth(c.node)))
}

/**
 * C4.5's actual selection heuristic: among features whose information gain is at
 * least the average, take the one with the highest gain ratio.
 *
 * Worth being precise about, because the usual one-line story ("gain ratio fixes
 * the many-valued-feature bias") is not true in general, and play-tennis is a
 * counterexample you can check by hand:
 *
 *   Day     IG 0.9403  SplitInfo 3.8074  GainRatio 0.2470   (14 branches)
 *   Outlook IG 0.2467  SplitInfo 1.5774  GainRatio 0.1564   (3 branches)
 *
 * Day wins on raw gain ratio, and it also survives the average-gain filter — its
 * own gain is so large that it drags the average above every real feature, so it
 * ends up as the only candidate. Gain ratio shrinks the identifier's advantage
 * but does not remove it. What actually defends against this is refusing to split
 * on near-unique columns at all: see `isIdentifierLike` and the `minBranchSize`
 * option below.
 */
export function c45Select(rows, features, target) {
  if (features.length === 0 || rows.length === 0) return null
  const scored = features.map((f) => ({ feature: f, ig: infoGain(rows, f, target), gr: gainRatio(rows, f, target) }))
  const meanIg = scored.reduce((s, x) => s + x.ig, 0) / scored.length
  const eligible = scored.filter((x) => x.ig >= meanIg)
  const pool = eligible.length > 0 ? eligible : scored
  return pool.reduce((best, x) => (x.gr > best.gr ? x : best))
}

/**
 * Flag a feature that behaves like a row identifier: its branches are almost all
 * singletons. This is the guard that actually stops the Day column, and it is a
 * structural property of the split rather than a property of the impurity score.
 *
 * `threshold` is the fraction of distinct values to rows above which we consider
 * the feature an identifier — 0.8 flags Day (14/14 = 1.0) while leaving Outlook
 * (3/14 = 0.21) alone.
 */
export function isIdentifierLike(rows, feature, threshold = 0.8) {
  if (rows.length === 0) return false
  return partition(rows, feature).size / rows.length >= threshold
}

/**
 * Average number of rows per branch — the quantity `minBranchSize` constrains.
 * A split whose branches are mostly singletons has learned the training set, not
 * the concept.
 */
export function meanBranchSize(rows, feature) {
  const n = partition(rows, feature).size
  return n === 0 ? 0 : rows.length / n
}
