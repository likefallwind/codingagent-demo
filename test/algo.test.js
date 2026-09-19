import test from 'node:test'
import assert from 'node:assert/strict'
import {
  entropy, gini, infoGain, gainRatio, splitInfo, giniGain,
  rankFeatures, bestFeature, buildTree, classify, accuracy, treeDepth, partition,
  c45Select, isIdentifierLike, meanBranchSize,
} from '../src/labs/decisionTree/algo.js'
import { playTennis, loanApproval } from '../src/labs/decisionTree/datasets.js'

const { rows, target, features } = playTennis
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b} (±${eps})`)

test('entropy of the full play-tennis set is the textbook 0.940 bits', () => {
  near(entropy(rows, target), 0.940)
})

test('entropy is 0 for a pure set and 1 for an even two-class split', () => {
  near(entropy(rows.filter((r) => r.Outlook === 'Overcast'), target), 0)
  near(entropy([{ y: 'a' }, { y: 'b' }], 'y'), 1)
  near(entropy([], 'y'), 0)
})

test('gini matches hand-computed values', () => {
  // 9 Yes / 5 No -> 1 - (9/14)^2 - (5/14)^2
  near(gini(rows, target), 1 - (9 / 14) ** 2 - (5 / 14) ** 2)
  near(gini(rows.filter((r) => r.Outlook === 'Overcast'), target), 0)
})

test('information gains reproduce Quinlan\'s published numbers', () => {
  near(infoGain(rows, 'Outlook', target), 0.247)
  near(infoGain(rows, 'Humidity', target), 0.152)
  near(infoGain(rows, 'Wind', target), 0.048)
  near(infoGain(rows, 'Temperature', target), 0.029)
})

test('Outlook is the ID3 root among the real features', () => {
  assert.equal(bestFeature(rows, features, target, 'infoGain').feature, 'Outlook')
})

test('the Day identifier traps information gain but is caught by gain ratio', () => {
  // Splitting on a unique id makes every partition pure, so the gain equals the
  // full entropy of the set — the highest score attainable.
  near(infoGain(rows, 'Day', target), entropy(rows, target))
  const withTrap = [...features, 'Day']
  assert.equal(bestFeature(rows, withTrap, target, 'infoGain').feature, 'Day')

  // Split information for 14 singleton branches is log2(14).
  near(splitInfo(rows, 'Day'), Math.log2(14))

  // Gain ratio shrinks the identifier's advantage but does NOT overturn it:
  // Day 0.2470 still beats Outlook 0.1564. The common claim that gain ratio
  // fixes the many-valued bias is false on this dataset.
  near(gainRatio(rows, 'Day', target), 0.2470)
  near(gainRatio(rows, 'Outlook', target), 0.1564)
  assert.ok(gainRatio(rows, 'Day', target) > gainRatio(rows, 'Outlook', target))
  assert.equal(bestFeature(rows, withTrap, target, 'gainRatio').feature, 'Day')
})

test("C4.5's average-gain filter also fails to stop the Day identifier", () => {
  // Day's gain is so large it pulls the mean above every real feature, leaving
  // itself as the only eligible candidate.
  assert.equal(c45Select(rows, [...features, 'Day'], target).feature, 'Day')
  // Without the identifier present the heuristic behaves as the textbook says.
  assert.equal(c45Select(rows, features, target).feature, 'Outlook')
})

test('the structural identifier guard is what actually catches Day', () => {
  assert.equal(isIdentifierLike(rows, 'Day'), true)
  assert.equal(isIdentifierLike(rows, 'Outlook'), false)
  assert.equal(isIdentifierLike(rows, 'Humidity'), false)
  near(meanBranchSize(rows, 'Day'), 1)
  near(meanBranchSize(rows, 'Outlook'), 14 / 3)
})

test('gini gain also picks Outlook (CART agrees with ID3 here)', () => {
  assert.equal(bestFeature(rows, features, target, 'giniGain').feature, 'Outlook')
  assert.ok(giniGain(rows, 'Outlook', target) > giniGain(rows, 'Wind', target))
})

test('rankFeatures returns every feature, sorted best-first', () => {
  const ranked = rankFeatures(rows, features, target, 'infoGain')
  assert.equal(ranked.length, features.length)
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score)
  assert.equal(ranked[0].feature, 'Outlook')
  assert.equal(ranked.find((r) => r.feature === 'Outlook').branches, 3)
})

test('splitInfo is 0 for a constant feature and gainRatio does not divide by zero', () => {
  const flat = [{ f: 'same', y: 'a' }, { f: 'same', y: 'b' }]
  near(splitInfo(flat, 'f'), 0)
  assert.equal(gainRatio(flat, 'f', 'y'), 0)
})

test('the grown tree classifies all training rows correctly', () => {
  const tree = buildTree(rows, features, target, { criterion: 'infoGain' })
  assert.equal(tree.kind, 'split')
  assert.equal(tree.feature, 'Outlook')
  near(accuracy(tree, rows, target), 1)
})

test('the Overcast branch closes immediately as a pure leaf', () => {
  const tree = buildTree(rows, features, target, { criterion: 'infoGain' })
  const overcast = tree.children.find((c) => c.value === 'Overcast').node
  assert.equal(overcast.kind, 'leaf')
  assert.equal(overcast.label, 'Yes')
  assert.equal(overcast.reason, 'pure')
})

test('maxDepth stops growth and records why', () => {
  const stump = buildTree(rows, features, target, { criterion: 'infoGain', maxDepth: 1 })
  assert.equal(treeDepth(stump), 2)
  const sunny = stump.children.find((c) => c.value === 'Sunny').node
  assert.equal(sunny.kind, 'leaf')
  assert.equal(sunny.reason, 'max-depth')
})

test('partition covers every row exactly once', () => {
  const parts = [...partition(rows, 'Outlook').values()]
  assert.equal(parts.reduce((n, p) => n + p.length, 0), rows.length)
  assert.equal(parts.length, 3)
})

test('classify falls back to the node majority for an unseen branch value', () => {
  const tree = buildTree(rows, features, target, { criterion: 'infoGain' })
  assert.equal(classify(tree, { Outlook: 'Snow' }, target), 'Yes') // 9 Yes vs 5 No
})

test('the second dataset also trains to a consistent tree', () => {
  const t = buildTree(loanApproval.rows, loanApproval.features, loanApproval.target, {})
  near(accuracy(t, loanApproval.rows, loanApproval.target), 1)
})
