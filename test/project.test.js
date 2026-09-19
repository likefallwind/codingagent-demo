/**
 * Project grading rules (FR-04 / FR-08). The records below have the shape the
 * instrumented Python returns (public/pyruntime/learnai.py); test/pyruntime
 * .test.js produces them from real scikit-learn when it is available.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  gradeByRules, explanationCriterion, overall, submissionKey, numbersIn, traceable, distinctRecords, isBaseline, changesComplexity,
} from '../src/project/grading.js'
import { courseList } from '../src/courses/index.js'

const course = courseList[0]
const task = course.project.main
const params = (o = {}) => ({ criterion: 'gini', max_depth: null, min_samples_leaf: 1, min_samples_split: 2, max_leaf_nodes: null, ccp_alpha: 0, random_state: 0, ...o })
const rec = (name, p, tr, va, extra = {}) => ({
  name, params: params(p), train_acc: tr, val_acc: va, depth: 5, leaves: 20, n_train: 360, n_val: 120,
  features: ['soil_moisture', 'temperature', 'light_hours', 'seed_weight', 'sow_depth'], n_fit: 360,
  val_in_train: 0, fit_is_train: true, fit_uses_val: 0, from_split: true, ...extra,
})
const split = { n_total: 480, n_train: 360, n_val: 120, test_size: 0.25, train_size: null, random_state: 42, shuffle: true, stratify: false }
const goodRun = {
  id: 'run-1', status: 'ok', codeHash: 'c1', dataVersion: 'germination-v1', dataHash: task.dataset.hash,
  report: {
    splits: [split],
    records: [rec('基线', {}, 1.0, 0.733333), rec('max_depth=4', { max_depth: 4 }, 0.816667, 0.841667), rec('min_samples_leaf=5', { min_samples_leaf: 5 }, 0.888889, 0.858333)],
  },
}
const goodSub = {
  codeHash: 'c1', target: 'germinated', chosenIndex: 2,
  roles: '训练集用来拟合模型，验证集用来在没见过的数据上比较设置。',
  conclusion: '选 min_samples_leaf=5：验证准确率 0.858 最高；基线训练准确率 1.000、验证只有 0.733，差距说明过拟合。取舍：复杂度更低。',
}
const byId = (cs) => Object.fromEntries(cs.map((c) => [c.id, c]))

test('a sound submission passes every rule, whatever parameters it chose', () => {
  const c = byId(gradeByRules({ task, run: goodRun, sub: goodSub }))
  for (const id of ['runs', 'data', 'experiments', 'consistency']) assert.equal(c[id].met, true, `${id}: ${c[id].reasons}`)
  // Choosing the second-best model is just as acceptable if it is argued.
  const alt = byId(gradeByRules({ task, run: goodRun, sub: { ...goodSub, chosenIndex: 1, conclusion: '选 max_depth=4：验证准确率 0.842，只比最好的低一点，但树浅得多，更容易解释。' } }))
  assert.equal(alt.consistency.met, true)
})

test('AC-08: training scores only, no validation rows — the data criterion fails and says why', () => {
  const onlyTrain = {
    ...goodRun,
    report: {
      splits: [],
      records: goodRun.report.records.map((r) => ({ ...r, n_train: 480, n_val: 480, val_in_train: 1, fit_uses_val: 1, from_split: false })),
    },
  }
  const c = byId(gradeByRules({ task, run: onlyTrain, sub: goodSub }))
  assert.equal(c.data.met, false)
  assert.ok(c.data.reasons.some((r) => r.includes('验证数据') && r.includes('训练数据')), c.data.reasons.join(' | '))
  assert.ok(c.data.reasons.some((r) => r.includes('train_test_split')))
})

test('fitting on rows that include the validation set fails the data criterion', () => {
  const leaky = { ...goodRun, report: { ...goodRun.report, records: goodRun.report.records.map((r, i) => (i ? r : { ...r, fit_uses_val: 1, fit_is_train: false })) } }
  const c = byId(gradeByRules({ task, run: leaky, sub: goodSub }))
  assert.equal(c.data.met, false)
  assert.ok(c.data.reasons.some((r) => r.includes('训练时用到了')))
})

test('an identifier or the target used as a feature fails the data criterion', () => {
  const withId = { ...goodRun, report: { ...goodRun.report, records: goodRun.report.records.map((r) => ({ ...r, features: ['sample_id', ...r.features] })) } }
  assert.ok(byId(gradeByRules({ task, run: withId, sub: goodSub })).data.reasons.some((r) => r.includes('编号列')))
  const withTarget = { ...goodRun, report: { ...goodRun.report, records: goodRun.report.records.map((r) => ({ ...r, features: [...r.features, 'germinated'] })) } }
  assert.ok(byId(gradeByRules({ task, run: withTarget, sub: goodSub })).data.reasons.some((r) => r.includes('目标列')))
})

test('an unseeded split is not reproducible and fails the data criterion', () => {
  const unseeded = { ...goodRun, report: { ...goodRun.report, splits: [{ ...split, random_state: null }] } }
  assert.ok(byId(gradeByRules({ task, run: unseeded, sub: goodSub })).data.reasons.some((r) => r.includes('random_state')))
})

test('experiments need three distinct settings, a baseline and a change of complexity, on one split', () => {
  const two = { ...goodRun, report: { ...goodRun.report, records: [goodRun.report.records[0], goodRun.report.records[1], { ...goodRun.report.records[1], name: '同样的设置' }] } }
  assert.equal(byId(gradeByRules({ task, run: two, sub: { ...goodSub, chosenIndex: 1 } })).experiments.met, false)
  const noBase = { ...goodRun, report: { ...goodRun.report, records: [rec('a', { max_depth: 3 }, 0.8, 0.8), rec('b', { max_depth: 4 }, 0.82, 0.84), rec('c', { max_depth: 6 }, 0.9, 0.8)] } }
  assert.ok(byId(gradeByRules({ task, run: noBase, sub: { ...goodSub, chosenIndex: 1, conclusion: '选 b，验证 0.840。' } })).experiments.reasons.some((r) => r.includes('基线')))
  assert.ok(isBaseline(rec('随便起的名字', {}, 1, 0.7)))
  assert.ok(changesComplexity(rec('x', { ccp_alpha: 0.01 }, 1, 0.7)))
  assert.equal(distinctRecords([rec('a', {}, 1, 0.7), rec('b', {}, 1, 0.7)]).length, 1)
})

test('a figure in the conclusion that the run never produced fails consistency', () => {
  const c = byId(gradeByRules({ task, run: goodRun, sub: { ...goodSub, conclusion: '选 min_samples_leaf=5：验证准确率 0.91，最高。' } }))
  assert.equal(c.consistency.met, false)
  assert.ok(c.consistency.reasons[0].includes('0.91'))
  // Percentages and decimals both trace; small counts are free.
  assert.ok(traceable(numbersIn('85.8%')[0], goodRun.report.records, split))
  assert.ok(traceable(numbersIn('三种里第 2 个')[0], goodRun.report.records, split))
})

test('the submitted code must be the code that ran, on the task\'s own data', () => {
  assert.equal(byId(gradeByRules({ task, run: goodRun, sub: { ...goodSub, codeHash: 'other' } })).runs.met, false)
  assert.equal(byId(gradeByRules({ task, run: { ...goodRun, dataVersion: 'farm-b-v1' }, sub: goodSub })).runs.met, false)
  assert.equal(byId(gradeByRules({ task, run: { ...goodRun, status: 'timeout' }, sub: goodSub })).runs.met, false)
})

test('the explanation: a floor no model can lift, then points; pending when the grader is unavailable', () => {
  const points = course.project.explanationPoints
  const noVal = explanationCriterion({ sub: { ...goodSub, conclusion: '训练准确率 1.000 最高，所以选基线。' }, llm: null, points })
  assert.equal(noVal.met, false)
  const pending = explanationCriterion({ sub: goodSub, llm: null, points })
  assert.equal(pending.met, null)
  assert.ok(pending.pending)
  const good = explanationCriterion({ sub: goodSub, llm: { points: points.map((p) => ({ ...p, met: true })), feedback: 'ok', confidence: 0.9 }, points })
  assert.equal(good.met, true)
  const missing = explanationCriterion({ sub: goodSub, llm: { points: points.map((p) => ({ ...p, met: p.id !== 'gap' })), feedback: 'x', confidence: 0.9 }, points })
  assert.equal(missing.met, false)
  const unsure = explanationCriterion({ sub: goodSub, llm: { points: points.map((p) => ({ ...p, met: true })), feedback: 'x', confidence: 0.2 }, points })
  assert.equal(unsure.met, null)
  assert.ok(unsure.needsReview)
})

test('overall: any failure fails, any pending keeps it pending; the same submission has the same key', () => {
  assert.equal(overall([{ met: true }, { met: null }]), null)
  assert.equal(overall([{ met: true }, { met: false }, { met: null }]), false)
  assert.equal(overall([{ met: true }]), true)
  assert.equal(submissionKey('main', goodRun, goodSub), submissionKey('main', goodRun, { ...goodSub }))
  assert.notEqual(submissionKey('main', goodRun, goodSub), submissionKey('main', goodRun, { ...goodSub, chosenIndex: 1 }))
})

test('a manual split with DataFrame.sample is accepted when it is seeded and disjoint', () => {
  const sampled = { ...goodRun, report: { ...goodRun.report, splits: [{ kind: 'sample', n_total: 480, n_sample: 360, frac: 0.75, random_state: 7 }] } }
  const c = byId(gradeByRules({ task, run: sampled, sub: goodSub }))
  assert.equal(c.data.met, true, c.data.reasons.join(' | '))
  const unseeded = { ...goodRun, report: { ...goodRun.report, splits: [{ kind: 'sample', n_total: 480, n_sample: 360, frac: 0.75, random_state: null }] } }
  assert.ok(byId(gradeByRules({ task, run: unseeded, sub: goodSub })).data.reasons.some((r) => r.includes('random_state')))
})

test('a difference between two settings quoted in the conclusion traces to the records', () => {
  const c = byId(gradeByRules({ task, run: goodRun, sub: { ...goodSub, conclusion: '选 min_samples_leaf=5：验证准确率比基线高了 12.5 个百分点（0.858 对 0.733）。' } }))
  assert.equal(c.consistency.met, true, c.consistency.reasons.join(' | '))
  const wrong = byId(gradeByRules({ task, run: goodRun, sub: { ...goodSub, conclusion: '验证准确率比基线高了 30 个百分点。' } }))
  assert.equal(wrong.consistency.met, false)
})
