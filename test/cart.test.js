import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gini, counts, isPure, splitRows, splitLabel, candidates, gainOf, bestSplit, bestSplitFor,
  grow, predict, decisionPath, errRate, leafCount, treeDepth, learningCurve,
  rankFeatures, nodeMistakes, buildFromSpec, ILLUSTRATIVE_SPEC,
} from '../src/labs/fruitTree/cart.js'
import {
  SAMPLES, TRAIN, VAL, POPULATION, DEPTHS, FEATURES, APPLE, ORANGE, generatePopulation,
} from '../src/labs/fruitTree/dataset.js'

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b} (±${eps})`)

test('the 16 teaching samples are balanced, so gini starts at exactly 0.5', () => {
  const c = counts(SAMPLES)
  assert.deepEqual(c, { a: 8, o: 8, n: 16 })
  near(gini(SAMPLES), 0.5)
})

test('gini is 0 for a pure set', () => {
  near(gini(SAMPLES.filter((r) => r.c === APPLE)), 0)
  assert.equal(isPure(SAMPLES.filter((r) => r.c === APPLE)), true)
  assert.equal(isPure(SAMPLES), false)
})

test('peel = thin is the best first cut and carves off a pure apple branch', () => {
  const b = bestSplit(SAMPLES)
  assert.equal(b.key, 'peel')
  assert.equal(b.thr, 1)
  // The lesson text promises 7 pure apples on the left and 9 left to sort.
  assert.equal(b.l.length, 7)
  assert.equal(b.r.length, 9)
  assert.equal(isPure(b.l), true)
  assert.equal(counts(b.l).a, 7)
  assert.deepEqual(counts(b.r), { a: 1, o: 8, n: 9 })
})

test('feature ranking puts peel first and aroma last', () => {
  const ranked = rankFeatures(SAMPLES, FEATURES)
  assert.deepEqual(ranked.map((r) => r.key), ['peel', 'w', 'aroma'])
  assert.ok(ranked[0].gain > ranked[1].gain)
  // Aroma is the weakest, though not worthless: only two fruits lack it, and
  // both are apples, so the cut does isolate a small pure branch.
  assert.ok(ranked[2].gain < ranked[1].gain)
  near(ranked[2].gain, 0.0714)
})

test('weight thresholds are the midpoints between neighbouring observed values', () => {
  const ws = candidates(SAMPLES).filter((c) => c.key === 'w').map((c) => c.thr)
  const sorted = [...new Set(SAMPLES.map((r) => r.w))].sort((a, b) => a - b)
  assert.equal(ws.length, sorted.length - 1)
  assert.equal(ws[0], Math.round((sorted[0] + sorted[1]) / 2))
  // Every candidate actually separates the data.
  for (const thr of ws) {
    const [l, r] = splitRows(SAMPLES, 'w', thr)
    assert.ok(l.length > 0 && r.length > 0)
  }
})

test('a split that separates nothing scores -1 rather than a misleading 0', () => {
  assert.equal(gainOf(SAMPLES, 'w', 1000), -1)
  assert.equal(gainOf(SAMPLES, 'w', 0), -1)
})

test('split labels read as the questions the UI asks', () => {
  assert.equal(splitLabel('peel', 1), '果皮 = 薄')
  assert.equal(splitLabel('peel', 2), '果皮 ≤ 中')
  assert.equal(splitLabel('w', 180), '重量 ≤ 180 g')
  assert.equal(splitLabel('aroma', 0), '无果香')
})

test('minLeaf suppresses splits that would strand a tiny branch', () => {
  // The 16 samples reach purity in three leaves regardless, so minLeaf has
  // nothing to prune there — it only bites on the larger population.
  const loose = grow(TRAIN, 0, 8, 1)
  const strict = grow(TRAIN, 0, 8, 10)
  assert.ok(leafCount(strict) < leafCount(loose), 'minLeaf should reduce leaf count on the big set')
  const walk = (n) => { if (n.split) { assert.ok(n.left.n >= 10 && n.right.n >= 10); walk(n.left); walk(n.right) } }
  walk(strict)
})

test('the grown depth-2 tree is PERFECT on the 16 samples', () => {
  // This is why the lesson cannot open with the algorithm's own tree: asking
  // `无果香` second isolates the one aroma-less apple, leaving no impure leaf to
  // teach "a tree need not be 100% right" with.
  const t = grow(SAMPLES, 0, 2, 1)
  assert.equal(treeDepth(t), 2)
  assert.equal(t.split.key, 'peel')
  assert.equal(t.right.split.key, 'aroma')
  assert.equal(errRate(t, SAMPLES), 0)
  assert.equal(leafCount(t), 3)
})

test('the authored step-1 tree keeps its shape but computes its own numbers', () => {
  const t = buildFromSpec(SAMPLES, ILLUSTRATIVE_SPEC)
  assert.equal(t.authored, true)
  assert.equal(t.split.key, 'peel')
  assert.equal(t.right.split.key, 'w')
  assert.equal(t.right.split.thr, 180)

  // Left: seven pure apples, exactly as the lesson text says.
  assert.deepEqual(counts(t.left.rows), { a: 7, o: 0, n: 7 })
  // Right-left: two pure oranges. Right-right: seven with one apple among six.
  assert.deepEqual(counts(t.right.left.rows), { a: 0, o: 2, n: 2 })
  assert.deepEqual(counts(t.right.right.rows), { a: 1, o: 6, n: 7 })
  assert.equal(nodeMistakes(t.right.right.rows), 1)
  assert.equal(Math.round(errRate(t, SAMPLES) * SAMPLES.length), 1)
})

test('the authored threshold is deliberately not the best one available', () => {
  // 180 scores 0.0071; the best weight cut on that branch is 200 at 0.0309. The
  // authored tree is an illustration, and the UI must not present it as the
  // algorithm's choice.
  const [, right] = splitRows(SAMPLES, 'peel', 1)
  near(gainOf(right, 'w', 180), 0.0071)
  assert.equal(bestSplitFor(right, 'w').thr, 200)
  assert.ok(gainOf(right, 'w', 200) > gainOf(right, 'w', 180))
})

test('the quiz fruit walks two "no" branches and lands on the mixed orange leaf', () => {
  const t = buildFromSpec(SAMPLES, ILLUSTRATIVE_SPEC)
  const fruit = { w: 198, peel: 2, aroma: 1 }
  const { path, leaf } = decisionPath(t, fruit)
  assert.equal(path.length, 2)
  assert.equal(path[0].answer, false) // peel is medium, not thin
  assert.equal(path[1].answer, false) // 198 g is over the 180 g threshold
  assert.equal(leaf.cls, ORANGE)
  assert.equal(predict(t, fruit), ORANGE)
  // That leaf is impure — 6 of 7 are oranges — which is the point being made.
  assert.equal(nodeMistakes(leaf.rows), 1)
})

test('the generated population is reproducible from its seed', () => {
  assert.equal(POPULATION.length, 300)
  assert.deepEqual(generatePopulation(), POPULATION)
  assert.notDeepEqual(generatePopulation(1234), POPULATION)
  assert.equal(TRAIN.length, 240)
  assert.equal(VAL.length, 60)
  // No row is in both halves.
  assert.equal(TRAIN.filter((r) => VAL.includes(r)).length, 0)
})

test('label noise keeps the data from being perfectly separable', () => {
  // Without noise a deep tree would hit zero validation error and there would be
  // no overfitting for the lesson to show.
  const deep = grow(TRAIN, 0, 12, 1)
  assert.ok(errRate(deep, VAL) > 0.02, 'validation error should not collapse to zero')
})

test('training error falls monotonically as depth grows', () => {
  const { curve } = learningCurve(TRAIN, VAL, DEPTHS)
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].tr <= curve[i - 1].tr + 1e-12, `train error rose at depth ${curve[i].d}`)
  }
})

test('validation error turns back up — the overfitting the lesson is about', () => {
  const { curve, best } = learningCurve(TRAIN, VAL, DEPTHS)
  const deepest = curve[curve.length - 1]
  const bestPoint = curve.find((p) => p.d === best)
  assert.ok(best < deepest.d, 'best depth must be short of the deepest tree')
  assert.ok(deepest.va > bestPoint.va, 'deepest tree must generalise worse than the best')
  assert.ok(deepest.tr < bestPoint.tr, 'deepest tree must still fit the training set better')
})

test('deeper trees have more leaves', () => {
  const { curve } = learningCurve(TRAIN, VAL, DEPTHS)
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].leaves >= curve[i - 1].leaves)
  }
})

test('pruning by minLeaf sheds leaves without wrecking validation error', () => {
  const { best } = learningCurve(TRAIN, VAL, DEPTHS)
  const unpruned = grow(TRAIN, 0, best, 1)
  const pruned = grow(TRAIN, 0, best, 6)
  assert.ok(leafCount(pruned) < leafCount(unpruned), 'pruning should remove leaves')
  // The lesson's claim: those leaves were not doing useful work.
  assert.ok(errRate(pruned, VAL) <= errRate(unpruned, VAL) + 0.05)
})
