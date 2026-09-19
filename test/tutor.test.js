/**
 * The pure parts of the tutor: how the learner's screen is sanitised, which
 * numbers a reply may use, and which answer text a hint must not repeat.
 * The model calls themselves are exercised by e2e/walkthrough.mjs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanScreen, allowedFigureSource, answerKey } from '../server/tutor.js'
import { unknownQuantities } from '../server/factcheck.js'
import { courseList } from '../src/courses/index.js'
import { generatePractice } from '../src/labs/practice.js'

const course = courseList[0]
const concept = (id) => course.concepts.find((c) => c.id === id)

test('the screen from the browser is bounded and typed before it reaches a prompt', () => {
  const s = cleanScreen({
    focus: 'nonsense',
    doing: 'x'.repeat(1000),
    facts: ['ok', 42, { evil: true }, ...Array(100).fill('f')],
    check: { id: 'pu-1', prompt: 'q', eliminated: 'not-an-array', draft: 'd'.repeat(2000) },
  })
  assert.equal(s.focus, 'explain')
  assert.equal(s.doing.length, 200)
  assert.equal(s.facts.length, 40)
  assert.ok(s.facts.every((f) => typeof f === 'string'))
  assert.deepEqual(s.check.eliminated, [])
  assert.equal(s.check.draft.length, 400)
  assert.equal(cleanScreen(null), null)
  assert.equal(cleanScreen('a string'), null)
})

test('a figure on the learner\'s screen may be quoted even though the course text never states it', () => {
  const c = concept('depth-cost')
  const reply = '你现在拖到 depth 6，验证准确率是 86.7%。'
  assert.equal(unknownQuantities(reply, allowedFigureSource(c)).length, 1)
  const screen = cleanScreen({ focus: 'lab', doing: '把 max_depth 拖到 6', facts: ['当前 depth 6：31 个叶子，训练准确率 94.6%，验证准确率 86.7%'] })
  assert.equal(unknownQuantities(reply, allowedFigureSource(c, { screen })).length, 0)
})

test('a generated question\'s own figures are quotable once it is the check in play', () => {
  const c = concept('purity')
  const q = generatePractice(c.practice, 0)
  const figure = q.options.find((o) => o.correct).text
  assert.equal(unknownQuantities(`答案是 ${figure}`, allowedFigureSource(c, { check: q })).length, 0)
})

test('the answer guard polices distinctive answers and ignores short or already-shown ones', () => {
  // "1 bit" is the whole answer to eg-1 and appears nowhere in its prompt.
  assert.equal(answerKey(concept('entropy-gain').checks[0]), '1 bit')
  // The dash convention: only the part before it is the answer.
  assert.equal(answerKey({ prompt: 'q', options: [{ text: '0.500——两类各半', correct: true }] }), '0.500')
  // Too short to police without rejecting every reply that mentions it.
  assert.equal(answerKey({ prompt: 'q', options: [{ text: 'A', correct: true }, { text: 'B' }] }), null)
  // Already printed in the question, so repeating it gives nothing away.
  assert.equal(answerKey({ prompt: '按增益率，Day（0.2470）排第几？', options: [{ text: '0.2470', correct: true }] }), null)
})

test('an over-long reply is cut back to whole sentences, never mid-sentence', async () => {
  const { trimToSentences } = await import('../server/tutor.js')
  const text = '第一句话在这里说清楚了你的想法。第二句解释为什么不成立。第三句给一个能在界面上验证的动作，而且写得特别特别长。'
  assert.equal(trimToSentences(text, 200), text)
  assert.equal(trimToSentences(text, 30), '第一句话在这里说清楚了你的想法。第二句解释为什么不成立。')
  assert.equal(trimToSentences('一整句没有标点而且非常非常非常非常非常非常非常非常长', 10), null)
})

test('a misconception the grader cannot name from the catalogue becomes a plain wrong answer', async () => {
  const { repairGrade } = await import('../server/tutor.js')
  const repair = repairGrade(concept('entropy-gain'), 220)
  assert.deepEqual(repair({ verdict: 'misconception', misconception_id: '', feedback: '你把熵和样本数量混为一谈了。' }),
    { verdict: 'incorrect', misconception_id: '', feedback: '你把熵和样本数量混为一谈了。' })
  assert.equal(repair({ verdict: 'misconception', misconception_id: 'made_up', feedback: '一句足够长的反馈文字在这里。' }).verdict, 'incorrect')
  assert.equal(repair({ verdict: 'misconception', misconception_id: 'entropy_is_error', feedback: '一句足够长的反馈文字在这里。' }).verdict, 'misconception')
})
