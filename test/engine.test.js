import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCourse, topoOrder } from '../src/engine/schema.js'
import {
  initLearner, recordEvidence, markExplained, updateMastery, conceptStatus,
  activeMisconceptions, progress, MASTERY_THRESHOLD, STRUGGLING_THRESHOLD,
} from '../src/engine/learnerModel.js'
import { nextAction, explainDecision, openChecks, reviewCheck } from '../src/engine/policy.js'

/**
 * A course about baking bread. Nothing to do with decision trees — if the engine
 * can teach this without modification, the content/engine separation is real.
 */
const bread = {
  id: 'bread',
  title: '烤面包',
  concepts: [
    {
      id: 'gluten',
      title: '面筋',
      prerequisites: [],
      objectives: ['解释面筋网络如何形成'],
      explain: { intuition: '揉面把蛋白质连成网。', example: '想象一团缠在一起的毛线。', formal: '麦谷蛋白与醇溶蛋白交联。' },
      lab: { type: 'knead-sim', config: {} },
      misconceptions: [
        { id: 'more_kneading_always_better', belief: '揉得越久越好', correction: '过度揉面会撕裂已形成的网络。' },
      ],
      checks: [
        { id: 'g1', kind: 'mcq', prompt: '面筋来自什么？', options: [{ text: '蛋白质', correct: true }, { text: '糖', correct: false }] },
        { id: 'g2', kind: 'freeResponse', prompt: '为什么过度揉面有害？', rubric: '需提到网络被破坏', misconceptions: ['more_kneading_always_better'] },
      ],
    },
    {
      id: 'fermentation',
      title: '发酵',
      prerequisites: ['gluten'],
      objectives: ['说明酵母产气如何撑起面团'],
      explain: { intuition: '酵母吃糖放气，气被面筋网兜住。' },
      misconceptions: [],
      checks: [{ id: 'f1', kind: 'mcq', prompt: '酵母产生什么？', options: [{ text: '二氧化碳', correct: true }, { text: '氧气', correct: false }] }],
    },
  ],
}

test('a well-formed course validates clean', () => {
  assert.deepEqual(validateCourse(bread), [])
})

test('validator catches the mistakes an authoring pipeline actually makes', () => {
  const dangling = structuredClone(bread)
  dangling.concepts[1].prerequisites = ['nonexistent']
  assert.ok(validateCourse(dangling).some((e) => e.includes('unknown prerequisite')))

  const cyclic = structuredClone(bread)
  cyclic.concepts[0].prerequisites = ['fermentation']
  assert.ok(validateCourse(cyclic).some((e) => e.includes('cycle')))

  const noRubric = structuredClone(bread)
  delete noRubric.concepts[0].checks[1].rubric
  assert.ok(validateCourse(noRubric).some((e) => e.includes('rubric')))

  const badRef = structuredClone(bread)
  badRef.concepts[0].checks[1].misconceptions = ['typo_id']
  assert.ok(validateCourse(badRef).some((e) => e.includes('unknown misconception')))

  const noCorrect = structuredClone(bread)
  noCorrect.concepts[0].checks[0].options = [{ text: 'a' }, { text: 'b' }]
  assert.ok(validateCourse(noCorrect).some((e) => e.includes('no correct option')))
})

test('topoOrder places prerequisites first', () => {
  assert.deepEqual(topoOrder(bread.concepts).map((c) => c.id), ['gluten', 'fermentation'])
})

test('BKT moves mastery up on correct and down on wrong', () => {
  const start = 0.5
  assert.ok(updateMastery(start, true) > start)
  assert.ok(updateMastery(start, false) < start)
})

test('evidence weight makes a guessable MCQ move mastery less than a written answer', () => {
  const l = initLearner(bread)
  const viaMcq = recordEvidence(l, { conceptId: 'gluten', kind: 'mcq', correct: true })
  const viaFree = recordEvidence(l, { conceptId: 'gluten', kind: 'freeResponse', correct: true })
  assert.ok(viaFree.concepts.gluten.mastery > viaMcq.concepts.gluten.mastery)
})

test('downstream concepts stay locked until the prerequisite is mastered', () => {
  let l = initLearner(bread)
  assert.equal(conceptStatus(l, bread, 'fermentation'), 'locked')
  l = { ...l, concepts: { ...l.concepts, gluten: { ...l.concepts.gluten, mastery: 0.95 } } }
  assert.equal(conceptStatus(l, bread, 'fermentation'), 'available')
})

test('the policy explains before it tests', () => {
  const l = initLearner(bread)
  const a = nextAction(l, bread)
  assert.equal(a.type, 'explain')
  assert.equal(a.layer, 'intuition')
  assert.ok(a.why.includes('面筋'))
})

test('a diagnosed misconception outranks the next question', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  l = recordEvidence(l, {
    conceptId: 'gluten', kind: 'freeResponse', correct: false,
    misconceptionId: 'more_kneading_always_better', detail: { checkId: 'g2' },
  })
  const a = nextAction(l, bread)
  assert.equal(a.type, 'remediate')
  assert.equal(a.misconceptionId, 'more_kneading_always_better')
  assert.equal(a.misconception.correction, '过度揉面会撕裂已形成的网络。')
})

test('answering correctly resolves the carried misconception', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  l = recordEvidence(l, { conceptId: 'gluten', kind: 'freeResponse', correct: false, misconceptionId: 'more_kneading_always_better' })
  assert.equal(activeMisconceptions(l, 'gluten').length, 1)
  l = recordEvidence(l, { conceptId: 'gluten', kind: 'freeResponse', correct: true })
  assert.equal(activeMisconceptions(l, 'gluten').length, 0)
})

test('two wrong answers with no diagnosis re-explains from a different angle', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  // Drive mastery down without attaching a misconception.
  for (let i = 0; i < 4; i++) {
    l = recordEvidence(l, { conceptId: 'gluten', kind: 'mcq', correct: false, detail: { layer: 'intuition' } })
  }
  const a = nextAction(l, bread)
  assert.equal(a.type, 'explain')
  assert.notEqual(a.layer, 'intuition') // must not repeat the angle that failed
  assert.equal(a.scaffold, true)
})

test('hands-on lab comes before abstract checks when a concept has one', () => {
  const l = markExplained(initLearner(bread), 'gluten')
  const a = nextAction(l, bread)
  assert.equal(a.type, 'lab')
  assert.equal(a.lab.type, 'knead-sim')
})

test('after the lab the policy moves to the first open check', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  l = recordEvidence(l, { conceptId: 'gluten', kind: 'labAction', correct: true })
  const a = nextAction(l, bread)
  assert.equal(a.type, 'check')
  assert.equal(a.check.id, 'g1')
})

test('a passed check does not come back', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  l = recordEvidence(l, { conceptId: 'gluten', kind: 'mcq', correct: true, detail: { checkId: 'g1' } })
  const concept = bread.concepts[0]
  assert.deepEqual(openChecks(l, concept).map((c) => c.id), ['g2'])
})

test('passing every check after a retry never strands the learner below mastery', () => {
  // Lab right, g1 right, g2 wrong then right on retry: every check is passed but
  // mastery sits near 0.74. The policy must keep offering something to answer
  // until the concept is mastered — the tree-reader lab locks once solved.
  let l = markExplained(initLearner(bread), 'gluten')
  const ans = (kind, correct, checkId) =>
    (l = recordEvidence(l, { conceptId: 'gluten', kind, correct, detail: checkId ? { checkId } : null }))
  ans('labAction', true)
  ans('mcq', true, 'g1')
  ans('freeResponse', false, 'g2')
  ans('freeResponse', true, 'g2')

  const concept = bread.concepts[0]
  assert.deepEqual(openChecks(l, concept), [])
  assert.ok(l.concepts.gluten.mastery < MASTERY_THRESHOLD)

  const first = nextAction(l, bread)
  assert.equal(first.type, 'check')
  assert.equal(first.review, true)
  assert.equal(first.check.id, 'g2', 'the check only passed on a retry comes back first')

  for (let i = 0; i < 10 && nextAction(l, bread).type === 'check'; i++) {
    const { check } = nextAction(l, bread)
    ans(check.kind, true, check.id)
  }
  assert.equal(conceptStatus(l, bread, 'gluten'), 'mastered')
})

test('once every check has a clean pass, review rotates to the least recent', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  const at = (ts, checkId) => ({ ts, conceptId: 'gluten', kind: 'mcq', correct: true, detail: { checkId } })
  l.concepts.gluten = { ...l.concepts.gluten, evidence: [at(1, 'g1'), at(2, 'g2'), at(3, 'g1')] }
  assert.equal(reviewCheck(l, bread.concepts[0]).id, 'g2')
})

test('a misconception from another concept\'s catalogue does not stall this one', () => {
  // The ID3 lab is shared by three concepts and tags a wrong prediction with a
  // misconception only the third one defines. Remediating it in the first shows
  // no correction and no question, so the learner has nothing to do.
  let l = markExplained(initLearner(bread), 'gluten')
  l = recordEvidence(l, { conceptId: 'gluten', kind: 'labAction', correct: true })
  l = recordEvidence(l, { conceptId: 'gluten', kind: 'labAction', correct: false, misconceptionId: 'from_a_later_concept' })
  assert.notEqual(nextAction(l, bread).type, 'remediate')
})

test('mastering a concept advances to the next, then completes the course', () => {
  let l = initLearner(bread)
  l = { ...l, concepts: { ...l.concepts, gluten: { ...l.concepts.gluten, mastery: 0.95, seenExplain: true } } }
  const advance = nextAction(l, bread)
  assert.equal(advance.type, 'advance')
  assert.equal(advance.conceptId, 'fermentation')

  l = {
    ...l,
    currentConceptId: 'fermentation',
    concepts: { ...l.concepts, fermentation: { ...l.concepts.fermentation, mastery: 0.95, seenExplain: true } },
  }
  assert.equal(nextAction(l, bread).type, 'complete')
})

test('progress reports mastered count and course fraction', () => {
  let l = initLearner(bread)
  assert.deepEqual(progress(l, bread), { mastered: 0, total: 2, fraction: 0, avgMastery: 0.15 })
  l = { ...l, concepts: { ...l.concepts, gluten: { ...l.concepts.gluten, mastery: 0.95 } } }
  assert.equal(progress(l, bread).mastered, 1)
})

test('explainDecision exposes an inspectable trace, not just a verdict', () => {
  const l = markExplained(initLearner(bread), 'gluten')
  const { action, trace } = explainDecision(l, bread)
  assert.equal(action.type, 'lab')
  assert.equal(trace.concept, '面筋')
  assert.equal(trace.status, 'learning')
  assert.equal(trace.threshold, MASTERY_THRESHOLD)
  assert.deepEqual(trace.openChecks, ['g1', 'g2'])
})

test('the mastery floor stays below the struggling threshold, or the policy breaks', () => {
  // transit is applied even on wrong answers, so repeated failure converges on a
  // floor rather than reaching 0. If that floor rises above STRUGGLING_THRESHOLD
  // the "re-explain differently" branch in the policy becomes unreachable.
  let p = 0.15
  for (let i = 0; i < 20; i++) p = updateMastery(p, false, 0.6)
  assert.ok(p < STRUGGLING_THRESHOLD, `floor ${p.toFixed(3)} must stay under ${STRUGGLING_THRESHOLD}`)
  assert.ok(p > 0, 'floor should not collapse to zero either')
})

test('mastery is reachable in a sane number of attempts', () => {
  let free = 0.15
  let nFree = 0
  while (free < MASTERY_THRESHOLD && nFree < 20) { free = updateMastery(free, true, 1.0); nFree++ }
  assert.equal(nFree, 3)

  let mcq = 0.15
  let nMcq = 0
  while (mcq < MASTERY_THRESHOLD && nMcq < 20) { mcq = updateMastery(mcq, true, 0.6); nMcq++ }
  assert.equal(nMcq, 4) // guessable evidence needs more of it
})
