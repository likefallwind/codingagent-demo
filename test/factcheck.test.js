import test from 'node:test'
import assert from 'node:assert/strict'
import { extractQuantities, unknownQuantities, checkQuantities } from '../server/factcheck.js'

const FACTS = '验证误差在 depth 5 降到最低的 10.0%，之后升到 13.3%；训练误差从 6.3% 一路降到 2.9%。增益 0.389。'

test('extracts percentages and decimals, ignoring bare integers', () => {
  const q = extractQuantities('验证误差 13.3%，增益 0.389，那 1 个苹果，共 16 个样本')
  assert.deepEqual(q.map((x) => x.raw), ['13.3%', '0.389'])
})

test('a percentage does not also register as a bare decimal', () => {
  const q = extractQuantities('10.0%')
  assert.equal(q.length, 1)
  assert.equal(q[0].kind, 'percent')
})

test('accepts figures that appear in the source material', () => {
  assert.equal(checkQuantities('验证误差从 10.0% 升到 13.3%。', FACTS), null)
  assert.equal(checkQuantities('训练误差 2.9%，增益 0.389。', FACTS), null)
})

test('accepts a reformatted but numerically identical figure', () => {
  // The model writing "10%" where the source says "10.0%" is formatting, not a
  // new claim.
  assert.equal(checkQuantities('验证误差从 10% 升到 13.3%。', FACTS), null)
})

test('accepts a percentage restated as its decimal form', () => {
  assert.equal(checkQuantities('验证误差是 0.133。', FACTS), null)
})

test('catches the invented figure that motivated this module', () => {
  // Observed live: the real depth-5 training error is 6.3%, not 3.8%.
  const msg = checkQuantities('训练误差从 3.8% 降到 2.9%。', FACTS)
  assert.ok(msg, 'an invented percentage must be rejected')
  assert.ok(msg.includes('3.8%'))
  assert.ok(!msg.includes('2.9%'), 'the genuine figure should not be flagged')
})

test('reports every invented figure at once', () => {
  const bad = unknownQuantities('误差 3.8% 和 7.7%，增益 0.512。', FACTS)
  assert.deepEqual(bad.map((q) => q.raw).sort(), ['0.512', '3.8%', '7.7%'])
})

test('text with no quantities always passes', () => {
  assert.equal(checkQuantities('你把关键点抓住了，继续往下看。', FACTS), null)
  assert.equal(checkQuantities('', FACTS), null)
})
