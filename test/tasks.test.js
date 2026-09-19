/**
 * Task instances (FR-03): verification questions are unseen, valid,
 * reproducible, never reused and never shared with practice; generated
 * variants actually vary the condition the capability is about.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { courseList } from '../src/courses/index.js'
import { initLearner, startAttempt, markRevealed, openAttemptFor } from '../src/engine/learnerModel.js'
import { verifyInstance, practiceInstance, instanceKeyOf, validateGenerated, VERIFY_SEED_BASE } from '../src/labs/tasks.js'
import { generateVerifyItem, generatePractice, resolvePractice } from '../src/labs/practice.js'

const course = courseList[0]
const concept = (id) => course.concepts.find((c) => c.id === id)
const withVerify = course.concepts.filter((c) => c.verify)

/** Start the verification a learner would get, as the page does. */
function start(l, c) {
  const v = verifyInstance(l, c)
  assert.ok(!v.unavailable, `${c.id}: ${v.reason}`)
  return startAttempt(l, {
    conceptId: c.id, taskId: 'verify', taskVersion: c.verify.version, activity: 'verify', instanceKey: v.instanceKey,
    resources: 'independent', items: v.seeds, parts: v.parts,
  })
}

test('every step with a verification yields valid, reproducible items from the verification seed range', () => {
  const l = initLearner(course)
  for (const c of withVerify) {
    const v = verifyInstance(l, c)
    assert.ok(!v.unavailable, c.id)
    assert.equal(v.items.length, c.verify.items.length)
    for (const [i, q] of v.items.entries()) {
      assert.deepEqual(validateGenerated(q), [], `${c.id}[${i}]`)
      assert.ok(v.seeds[i].seed >= VERIFY_SEED_BASE)
      const again = generateVerifyItem(c, v.seeds[i].index, v.seeds[i].seed)
      assert.equal(instanceKeyOf(again), instanceKeyOf(q), `${c.id}[${i}] must rebuild identically`)
      assert.equal(resolvePractice(c, q.id)?.prompt, q.prompt, 'the server rebuilds it from its id')
    }
    assert.equal(new Set(v.parts).size, v.parts.length, `${c.id}: the items of one round are distinct`)
  }
})

test('five rounds in a row never repeat an item, and never reuse one met as practice', () => {
  for (const c of withVerify) {
    let l = initLearner(course)
    // Some practice first: those instances must never come back as verification.
    const seen = new Set()
    for (let k = 0; k < 3; k++) {
      const p = practiceInstance(l, c)
      l = startAttempt(l, { conceptId: c.id, taskId: p.check.id, activity: 'practice', instanceKey: p.instanceKey, seed: p.seed })
      const a = openAttemptFor(l, p.instanceKey)
      l = { ...l, attempts: { ...l.attempts, [a.id]: { ...a, status: 'closed' } } }
      l = markRevealed(l, p.instanceKey)
      seen.add(p.instanceKey)
    }
    const parts = []
    for (let r = 0; r < 5; r++) {
      l = start(l, c)
      const a = Object.values(l.attempts).find((x) => x.activity === 'verify' && x.status === 'open')
      parts.push(...a.parts)
      l = { ...l, attempts: { ...l.attempts, [a.id]: { ...a, status: 'closed', submittedAt: Date.now() } } }
      l = markRevealed(l, a.instanceKey)
    }
    assert.equal(new Set(parts).size, parts.length, `${c.id}: an item was issued twice`)
    assert.ok(!parts.some((k) => seen.has(k)), `${c.id}: a practice instance came back as verification`)
    // And practice afterwards does not hand out a verification item.
    const p = practiceInstance(l, c)
    assert.ok(!parts.includes(p.instanceKey), `${c.id}: a verification item came back as practice`)
  }
})

test('an open verification is resumed as it was — a refresh cannot swap in easier questions', () => {
  const c = concept('overfitting')
  let l = start(initLearner(course), c)
  const first = verifyInstance(l, c)
  l = JSON.parse(JSON.stringify(l))
  const again = verifyInstance(l, c)
  assert.ok(again.resumed)
  assert.deepEqual(again.parts, first.parts)
})

test('when no valid unseen item can be built, verification is reported unavailable — never skipped', () => {
  const broken = { ...concept('read-tree'), id: 'broken', verify: { version: 'x', resources: 'r', items: [{ type: 'no-such-generator', criterion: 'c' }] } }
  const v = verifyInstance(initLearner(course), broken)
  assert.ok(v.unavailable)
  assert.match(v.reason, /无法验证/)
})

test('an instance is its content: reordering the options is the same instance', () => {
  const q = generatePractice(concept('purity').practice, 3)
  const shuffled = { ...q, options: [...q.options].reverse() }
  assert.equal(instanceKeyOf(shuffled), instanceKeyOf(q))
})

test('validation catches a generated question with two right answers or duplicate options', () => {
  const q = generatePractice(concept('overfitting').practice, 1)
  assert.ok(validateGenerated({ ...q, options: q.options.map((o) => ({ ...o, correct: true })) }).length)
  assert.ok(validateGenerated({ ...q, options: [q.options[0], q.options[0], q.options[1]] }).length)
})

test('variants change the condition that matters: the winning feature, the direction of the effect, the tree read', () => {
  const winners = new Set()
  for (let s = 0; s < 6; s++) {
    const q = generateVerifyItem(concept('greedy'), 0, VERIFY_SEED_BASE + s * 1000)
    winners.add(q.options.find((o) => o.correct).text.split(' ')[0])
  }
  assert.ok(winners.size >= 2, `the first cut's winning feature should vary: ${[...winners]}`)

  const directions = new Set()
  for (let s = 0; s < 12; s++) {
    const q = generateVerifyItem(concept('depth-cost'), 0, VERIFY_SEED_BASE + s * 1000)
    directions.add(q.options.find((o) => o.correct).text.includes('反而更差') ? 'worse' : 'better')
  }
  assert.deepEqual([...directions].sort(), ['better', 'worse'], 'deeper must sometimes help and sometimes hurt')

  const roots = new Set()
  for (let s = 0; s < 8; s++) roots.add(generateVerifyItem(concept('read-tree'), 0, VERIFY_SEED_BASE + s * 1000).diagram[0])
  assert.ok(roots.size >= 3, `the tree to read should vary: ${[...roots]}`)
})

test('a new-tree reading question is answered by walking the tree it draws', () => {
  for (let s = 0; s < 10; s++) {
    const q = generateVerifyItem(concept('read-tree'), 0, VERIFY_SEED_BASE + s * 1000)
    const right = q.options.find((o) => o.correct).text
    const leaf = right.match(/叶子 (.)/)[1]
    assert.ok(q.explain.includes(`落进叶子 ${leaf}`), q.explain)
    assert.ok(q.diagram.some((line) => line.includes(`叶子 ${leaf}`)))
  }
})

test('a question meant to confirm a misconception is cleared actually offers it as an option', () => {
  for (const [id, mis] of [['overfitting', 'train_error_measures_quality'], ['pruning', 'pruning_always_helps'], ['depth-cost', 'deeper_is_better']]) {
    const c = concept(id)
    const p = practiceInstance(initLearner(course), c, { target: mis })
    assert.ok(p.check.targets.includes(mis), `${id}: practice for ${mis} does not offer it`)
  }
})
