/**
 * The course as shipped: it validates, every lab and practice type it names
 * exists, and the figures the new steps quote are the figures the code computes.
 * The older steps' figures are pinned in cart.test.js and algo.test.js.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { courseList } from '../src/courses/index.js'
import { validateCourse } from '../src/engine/schema.js'
import { practiceGenerators, generatePractice, resolvePractice, practiceId } from '../src/labs/practice.js'
import { snapshot, profile, BATCH_COUNT } from '../src/labs/fruitTree/instability.js'
import { labTypes } from '../src/labs/labTypes.js'
import * as A from '../src/labs/decisionTree/algo.js'
import { playTennis as ds } from '../src/labs/decisionTree/datasets.js'

const course = courseList.find((c) => c.id === 'decision-tree')
const concept = (id) => course.concepts.find((c) => c.id === id)
const pct = (v) => `${(v * 100).toFixed(1)}%`
const f4 = (v) => v.toFixed(4)

test('every shipped course validates', () => {
  for (const c of courseList) assert.deepEqual(validateCourse(c), [], c.id)
})

test('every lab and practice type a concept names is registered', () => {
  for (const c of course.concepts) {
    if (c.lab) assert.ok(labTypes.includes(c.lab.type), `${c.id}: lab ${c.lab.type}`)
    if (c.practice) assert.ok(practiceGenerators[c.practice.type], `${c.id}: practice ${c.practice.type}`)
  }
})

test('the main line runs first and the ID3 chapter hangs off the purity step', () => {
  const chapters = [...new Set(course.concepts.map((c) => c.chapter))]
  assert.equal(chapters.length, 2)
  assert.deepEqual(concept('entropy-gain').prerequisites, ['purity'])
  assert.deepEqual(concept('instability').prerequisites, ['pruning'])
})

// --- step 7: instability -----------------------------------------------------

test('across eight batches the root never changes, the second cut wobbles, the leaves scatter', () => {
  const s = snapshot(8, BATCH_COUNT)
  assert.equal(BATCH_COUNT, 8)
  assert.ok(s.sameRoot)
  assert.equal(s.items[0].root, '果皮 = 薄')
  const seconds = s.items.map((x) => Number(x.second.match(/\d+/)[0]))
  assert.equal(Math.min(...seconds), 183)
  assert.equal(Math.max(...seconds), 189)
  assert.deepEqual(s.leafRange, [27, 42])
})

test('disagreement between batch trees grows with depth: 1.2% at depth 2, 13.0% at depth 8', () => {
  const p = profile([2, 8])
  assert.equal(pct(p[0].disagree), '1.2%')
  assert.equal(pct(p[1].disagree), '13.0%')
  const text = concept('instability').explain.example
  assert.ok(text.includes('1.2%') && text.includes('13.0%') && text.includes('27 到 42'))
})

test('eight deep trees voting beat the average single tree: 10.0% vs 12.7%', () => {
  const s = snapshot(8, BATCH_COUNT)
  assert.equal(pct(s.voteVa), '10.0%')
  assert.equal(pct(s.meanVa), '12.7%')
  for (const t of [concept('instability').explain.formal, concept('instability').checks[2].prompt]) {
    assert.ok(t.includes('10.0%') && t.includes('12.7%'))
  }
})

// --- the ID3 chapter's figures that the old algo tests do not already pin ---

test('with Day included, the mean information gain is 0.2832 — above every real feature', () => {
  const feats = [...ds.features, 'Day']
  const mean = feats.reduce((s, f) => s + A.infoGain(ds.rows, f, ds.target), 0) / feats.length
  assert.equal(f4(mean), '0.2832')
  for (const f of ds.features) assert.ok(A.infoGain(ds.rows, f, ds.target) < mean)
  assert.ok(concept('gain-ratio-limits').explain.example.includes('0.2832'))
})

test('a minimum mean branch size of 2 removes Day; above 4.67 it removes Outlook too', () => {
  assert.equal(A.meanBranchSize(ds.rows, 'Day'), 1)
  assert.equal(A.meanBranchSize(ds.rows, 'Outlook').toFixed(2), '4.67')
  assert.equal(A.meanBranchSize(ds.rows, 'Humidity'), 7)
  const survivors = (k) => [...ds.features, 'Day'].filter((f) => A.meanBranchSize(ds.rows, f) >= k)
  const winner = (k) => A.rankFeatures(ds.rows, survivors(k), ds.target, 'gainRatio')[0].feature
  assert.equal(winner(1), 'Day')
  assert.equal(winner(2), 'Outlook')
  assert.equal(winner(5), 'Humidity')
})

test('the Day tree answers every new day the same way; the real tree reads the weather', () => {
  const real = A.buildTree(ds.rows, ds.features, ds.target)
  const dayTree = A.buildTree(ds.rows, ['Day'], ds.target)
  assert.equal(dayTree.children.length, 14)
  assert.equal(A.accuracy(dayTree, ds.rows, ds.target), 1)
  const d15 = { Day: 'D15', Outlook: 'Rain', Temperature: 'Mild', Humidity: 'High', Wind: 'Strong' }
  assert.equal(A.classify(real, d15, ds.target), 'No')
  assert.equal(A.classify(dayTree, d15, ds.target), 'Yes')
  assert.equal(A.classify(dayTree, { ...d15, Outlook: 'Sunny', Wind: 'Weak' }, ds.target), 'Yes')
})

// --- generated practice ------------------------------------------------------

const owners = Object.fromEntries(course.concepts.filter((c) => c.practice).map((c) => [c.practice.type, c]))

test('every generator yields a well-formed question with exactly one right answer', () => {
  for (const [type, owner] of Object.entries(owners)) {
    const catalogue = new Set((owner.misconceptions ?? []).map((m) => m.id))
    for (let seed = 0; seed < 30; seed++) {
      const q = generatePractice(owner.practice, seed)
      const at = `${type}#${seed}`
      assert.equal(q.options.filter((o) => o.correct).length, 1, at)
      assert.ok(q.options.length >= 3, at)
      assert.equal(new Set(q.options.map((o) => o.text)).size, q.options.length, `${at}: duplicate options`)
      for (const o of q.options) {
        if (o.misconception) assert.ok(catalogue.has(o.misconception), `${at}: ${o.misconception} not in ${owner.id}`)
      }
      assert.ok(q.prompt && q.explain, at)
    }
  }
})

test('a generated question is reproducible from its id, and only by its own concept', () => {
  const purity = concept('purity')
  const q = generatePractice(purity.practice, 7)
  assert.deepEqual(resolvePractice(purity, q.id), q)
  assert.equal(resolvePractice(concept('greedy'), q.id), null)
  assert.equal(resolvePractice(purity, 'p:gini-value:-1'), null)
  assert.equal(q.id, practiceId('gini-value', 7))
})

test('consecutive seeds give different questions, and answers are not all the same', () => {
  for (const [type, owner] of Object.entries(owners)) {
    const prompts = new Set()
    const answers = new Set()
    for (let seed = 0; seed < 12; seed++) {
      const q = generatePractice(owner.practice, seed)
      prompts.add(q.prompt + JSON.stringify(q.table ?? null) + q.options.map((o) => o.text).sort().join('|'))
      answers.add(q.options.find((o) => o.correct).text)
    }
    assert.ok(prompts.size >= 10, `${type}: only ${prompts.size} distinct questions in 12 seeds`)
    assert.ok(answers.size >= 2, `${type}: the right answer never changes`)
  }
})
