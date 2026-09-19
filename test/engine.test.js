import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCourse, topoOrder } from '../src/engine/schema.js'
import {
  initLearner, recordJudgement, judgeInAttempt, startAttempt, recordEvent, recordHelp, convertAttempt,
  markExplained, updateMastery, activeMisconceptions, misconceptionList, openAttemptFor, attemptFor,
  BKT, STRUGGLING_THRESHOLD,
} from '../src/engine/learnerModel.js'
import { nextAction, explainDecision, progress, conceptDone, suggestedFirst, reviewCheck } from '../src/engine/policy.js'
import { capabilityStatus } from '../src/engine/capabilities.js'
import { migrateV1, loadLearner, saveLearner, keyV1, keyV2, exportPackage, OBSERVATION_SCOPE } from '../src/engine/persistence.js'

/**
 * A course about baking bread. Nothing to do with decision trees — if the engine
 * can teach and verify this without modification, the content/engine
 * separation is real.
 */
const bread = {
  id: 'bread',
  version: 'b1',
  title: '烤面包',
  concepts: [
    {
      id: 'gluten',
      title: '面筋',
      prerequisites: [],
      capability: { id: 'knead', title: '能判断面团揉到位没有' },
      verify: { version: 'v1', resources: '只看题目', items: [{ type: 'dough', criterion: '判断一团新面团' }] },
      practice: { type: 'dough', targets: ['more_kneading_always_better'] },
      objectives: ['解释面筋网络如何形成'],
      explain: { intuition: '揉面把蛋白质连成网。', example: '想象一团缠在一起的毛线。', formal: '麦谷蛋白与醇溶蛋白交联。' },
      lab: { type: 'knead-sim', config: {} },
      misconceptions: [
        { id: 'more_kneading_always_better', belief: '揉得越久越好', correction: '过度揉面会撕裂已形成的网络。' },
        { id: 'salt_kills_gluten', belief: '盐会破坏面筋', correction: '适量的盐反而让面筋更紧。' },
      ],
      checks: [
        { id: 'g1', kind: 'mcq', prompt: '面筋来自什么？', options: [{ text: '蛋白质', correct: true }, { text: '糖', misconception: 'salt_kills_gluten' }] },
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
      checks: [{ id: 'f1', kind: 'mcq', prompt: '酵母产生什么？', options: [{ text: '二氧化碳', correct: true }, { text: '氧气' }] }],
    },
  ],
}

let seq = 0
const jid = () => `j${++seq}`

/** Answer a check: open (or resume) its attempt and record one submission. */
function answer(l, conceptId, taskId, correct, extra = {}) {
  const spec = { conceptId, taskId, activity: extra.activity ?? 'check', instanceKey: extra.instanceKey ?? `check:${conceptId}:${taskId}`, capability: extra.capability, resources: extra.resources }
  return judgeInAttempt(l, bread, spec, { id: jid(), kind: extra.kind ?? 'mcq', correct, misconceptionId: extra.mis, targets: extra.targets, stated: extra.stated, closes: correct === true, reveals: extra.reveals ?? true })
}

/** A fresh learner who has read the intuition and tried the lab. */
function started() {
  let l = markExplained(initLearner(bread), 'gluten')
  l = answer(l, 'gluten', 'lab-step', true, { activity: 'lab', instanceKey: 'lab:gluten:knead:1', kind: 'labAction' })
  return l
}

/** Pass the verification for gluten independently. */
function verify(l, correct = true, { help = false } = {}) {
  const key = `verify:gluten:v1:${++seq}`
  l = startAttempt(l, { conceptId: 'gluten', taskId: 'verify', taskVersion: 'v1', activity: 'verify', instanceKey: key, capability: 'knead', resources: 'independent' })
  const a = openAttemptFor(l, key)
  if (help) l = recordHelp(l, { conceptId: 'gluten', source: 'hint', level: 1, attemptIds: [a.id] })
  return recordJudgement(l, bread, { id: jid(), attemptId: a.id, kind: 'verify', correct, criteria: [{ id: 'i0', text: '判断一团新面团', met: correct }], closes: true, reveals: true })
}

test('a well-formed course validates clean', () => {
  assert.deepEqual(validateCourse(bread, { generators: ['dough'] }), [])
})

test('validator catches a verification that names no generator, or has no capability', () => {
  assert.ok(validateCourse(bread, { generators: [] }).some((e) => e.includes('generator "dough" does not exist')))
  const bad = structuredClone(bread)
  delete bad.concepts[0].capability
  assert.ok(validateCourse(bad).some((e) => e.includes('verify needs a capability')))
})

test('validator catches the mistakes an authoring pipeline actually makes', () => {
  const dangling = structuredClone(bread)
  dangling.concepts[1].prerequisites = ['nonexistent']
  assert.ok(validateCourse(dangling).some((e) => e.includes('unknown prerequisite')))
  const cyc = structuredClone(bread)
  cyc.concepts[0].prerequisites = ['fermentation']
  assert.ok(validateCourse(cyc).some((e) => e.includes('cycle')))
  const optMis = structuredClone(bread)
  optMis.concepts[0].checks[0].options[1].misconception = 'nope'
  assert.ok(validateCourse(optMis).some((e) => e.includes('unknown misconception')))
})

test('topoOrder places prerequisites first', () => {
  assert.deepEqual(topoOrder([...bread.concepts].reverse()).map((c) => c.id), ['gluten', 'fermentation'])
})

test('BKT moves the estimate up on correct and down on wrong', () => {
  assert.ok(updateMastery(0.5, true) > 0.5)
  assert.ok(updateMastery(0.5, false) < 0.5)
})

test('the estimate floor stays below the struggling threshold, or the policy breaks', () => {
  let m = BKT.init
  for (let i = 0; i < 60; i++) m = updateMastery(m, false)
  assert.ok(m < STRUGGLING_THRESHOLD, `floor ${m.toFixed(3)} must sit below ${STRUGGLING_THRESHOLD}`)
})

// --- FR-01: evidence ------------------------------------------------------------

test('AC-01: exploring a lab is a behaviour event — no estimate change, no misconception', () => {
  const l0 = markExplained(initLearner(bread), 'gluten')
  const l = recordEvent(l0, { conceptId: 'gluten', object: 'lab', action: 'explore', detail: { labStep: 'over-knead', description: '揉到面团断裂' } })
  assert.equal(l.concepts.gluten.mastery, l0.concepts.gluten.mastery)
  assert.equal(misconceptionList(l, 'gluten').length, 0)
  assert.equal(l.judgements.length, 0)
  assert.equal(l.events.at(-1).action, 'explore')
})

test('a wrong option is a lead (suspected), not a finding', () => {
  const l = answer(started(), 'gluten', 'g1', false, { mis: 'salt_kills_gluten' })
  const m = misconceptionList(l, 'gluten').find((x) => x.id === 'salt_kills_gluten')
  assert.equal(m.status, 'suspected')
})

test('a belief stated in the learner\'s own words is supported; so is the same lead on a second instance', () => {
  let l = answer(started(), 'gluten', 'g2', false, { kind: 'freeResponse', mis: 'more_kneading_always_better', stated: true })
  assert.equal(misconceptionList(l, 'gluten')[0].status, 'supported')
  l = answer(started(), 'gluten', 'g1', false, { mis: 'salt_kills_gluten' })
  l = answer(l, 'gluten', 'p:dough:0', false, { activity: 'practice', instanceKey: 'gen:dough:x', mis: 'salt_kills_gluten' })
  assert.equal(misconceptionList(l, 'gluten').find((m) => m.id === 'salt_kills_gluten').status, 'supported')
})

test('AC-03: a correct answer to an unrelated question does not clear a misconception', () => {
  let l = answer(started(), 'gluten', 'g2', false, { kind: 'freeResponse', mis: 'more_kneading_always_better', stated: true })
  l = answer(l, 'gluten', 'other', true, { instanceKey: 'check:gluten:other', targets: [] })
  assert.equal(activeMisconceptions(l, 'gluten')[0].id, 'more_kneading_always_better')
})

test('a first-try correct answer to a targeting task on a new instance resolves it; a retry of the same instance does not', () => {
  let l = answer(started(), 'gluten', 'g1', false, { mis: 'salt_kills_gluten' })
  l = answer(l, 'gluten', 'g1', true, { targets: ['salt_kills_gluten'] }) // same instance, retry
  assert.equal(misconceptionList(l, 'gluten')[0].status, 'suspected')
  l = answer(l, 'gluten', 'p:dough:1', true, { activity: 'practice', instanceKey: 'gen:dough:y', targets: ['salt_kills_gluten'] })
  assert.equal(misconceptionList(l, 'gluten')[0].status, 'resolved')
})

test('only a first try on a first attempt moves the estimate; a retry of the same instance is not new evidence', () => {
  let l = answer(started(), 'gluten', 'g1', false)
  const afterWrong = l.concepts.gluten.mastery
  l = answer(l, 'gluten', 'g1', true)
  assert.equal(l.concepts.gluten.mastery, afterWrong)
  const retry = l.judgements.at(-1)
  assert.equal(retry.firstTry, false)
  assert.equal(retry.independent, false)
})

test('AC-05: an answer after help stays assisted — and so does the attempt after a reload and a re-answer', () => {
  let l = started()
  l = startAttempt(l, { conceptId: 'gluten', taskId: 'g1', activity: 'check', instanceKey: 'check:gluten:g1' })
  const a = openAttemptFor(l, 'check:gluten:g1')
  l = recordHelp(l, { conceptId: 'gluten', source: 'hint', level: 2, attemptIds: [a.id] })
  // "reload": the stored model is all that survives
  l = JSON.parse(JSON.stringify(l))
  l = answer(l, 'gluten', 'g1', true)
  const j = l.judgements.at(-1)
  assert.equal(j.assisted, true)
  assert.equal(j.independent, false)
  // coming back to the same, now revealed, question is a new attempt that still is not independent
  l = answer(l, 'gluten', 'g1', true)
  assert.equal(l.judgements.at(-1).ordinal, 2)
  assert.equal(l.judgements.at(-1).independent, false)
})

test('an unrated judgement (grader failed) moves nothing and keeps the attempt open', () => {
  const l0 = started()
  const l = answer(l0, 'gluten', 'g2', null, { kind: 'freeResponse' })
  assert.equal(l.concepts.gluten.mastery, l0.concepts.gluten.mastery)
  assert.equal(l.judgements.at(-1).verdict, 'unrated')
  assert.equal(attemptFor(l, 'check:gluten:g2').status, 'open')
})

test('judgements, events and help are idempotent on their ids', () => {
  let l = started()
  l = startAttempt(l, { conceptId: 'gluten', taskId: 'g1', instanceKey: 'k1' })
  const a = openAttemptFor(l, 'k1')
  const j = { id: 'same', attemptId: a.id, kind: 'mcq', correct: true }
  const once = recordJudgement(l, bread, j)
  assert.equal(recordJudgement(once, bread, j), once)
  const e = recordEvent(l, { id: 'e1', conceptId: 'gluten', object: 'x', action: 'y' })
  assert.equal(recordEvent(e, { id: 'e1', conceptId: 'gluten', object: 'x', action: 'y' }), e)
  const h = recordHelp(l, { id: 'h1', source: 'hint', attemptIds: [a.id] })
  assert.equal(recordHelp(h, { id: 'h1', source: 'hint', attemptIds: [a.id] }), h)
})

test('an invitation (level 0) does not make an attempt assisted', () => {
  let l = startAttempt(started(), { conceptId: 'gluten', taskId: 'g1', instanceKey: 'k2' })
  const a = openAttemptFor(l, 'k2')
  l = recordHelp(l, { source: 'nudge', level: 0, attemptIds: [a.id] })
  assert.equal(l.attempts[a.id].assisted, false)
})

// --- FR-02 / FR-03: capabilities and verification ------------------------------

test('AC-04: everything right first time and a high estimate still leads to verification', () => {
  let l = started()
  l = answer(l, 'gluten', 'g1', true)
  l = answer(l, 'gluten', 'g2', true, { kind: 'freeResponse' })
  l.concepts.gluten.mastery = 0.99
  const a = nextAction(l, bread)
  assert.equal(a.type, 'verify')
  assert.ok(a.why && a.basis && a.goal)
  assert.equal(conceptDone(l, bread, 'gluten'), false)
  assert.equal(capabilityStatus(l, bread, 'gluten').status, 'learning')
})

test('an independent pass verifies the capability and carries its trace', () => {
  const l = verify(answer(answer(started(), 'gluten', 'g1', true), 'gluten', 'g2', true, { kind: 'freeResponse' }))
  const s = capabilityStatus(l, bread, 'gluten')
  assert.equal(s.status, 'verified')
  const pass = s.trace.find((t) => t.counts)
  assert.equal(pass.activity, 'verify')
  assert.equal(pass.help, '独立完成')
  assert.deepEqual(pass.criteria.map((c) => c.met), [true])
  assert.equal(nextAction(l, bread).type, 'done')
})

test('a verification passed with help is shown as assisted and does not verify', () => {
  const l = verify(answer(answer(started(), 'gluten', 'g1', true), 'gluten', 'g2', true, { kind: 'freeResponse' }), true, { help: true })
  const s = capabilityStatus(l, bread, 'gluten')
  assert.equal(s.status, 'learning')
  assert.equal(s.trace.find((t) => t.activity === 'verify').help, '有帮助')
})

test('a converted verification keeps its answers but cannot count', () => {
  let l = started()
  l = startAttempt(l, { conceptId: 'gluten', taskId: 'verify', taskVersion: 'v1', activity: 'verify', instanceKey: 'vk', resources: 'independent' })
  const a = openAttemptFor(l, 'vk')
  l = convertAttempt(l, a.id)
  l = recordJudgement(l, bread, { id: jid(), attemptId: a.id, kind: 'verify', correct: true, closes: true })
  assert.equal(l.judgements.at(-1).independent, false)
  assert.equal(capabilityStatus(l, bread, 'gluten').status, 'learning')
})

test('after a failed verification the policy asks for practice before a new verification', () => {
  let l = answer(answer(started(), 'gluten', 'g1', true), 'gluten', 'g2', true, { kind: 'freeResponse' })
  l.concepts.gluten.mastery = 0.95
  l = verify(l, false)
  assert.equal(nextAction(l, bread).type, 'practice')
  l = answer(l, 'gluten', 'p:dough:3', true, { activity: 'practice', instanceKey: 'gen:dough:z' })
  // Verification is open again — either recommended outright, or offered next
  // to one more practice question while the internal estimate is still low.
  const a = nextAction(l, bread)
  assert.ok(a.type === 'verify' || (a.type === 'practice' && a.offerVerify), `${a.type} ${a.offerVerify}`)
})

test('a stale verification (older task version) does not count and is flagged in the trace', () => {
  let l = started()
  l = startAttempt(l, { conceptId: 'gluten', taskId: 'verify', taskVersion: 'v0', activity: 'verify', instanceKey: 'old', resources: 'independent' })
  l = recordJudgement(l, bread, { id: jid(), attemptId: openAttemptFor(l, 'old').id, kind: 'verify', correct: true, closes: true })
  const s = capabilityStatus(l, bread, 'gluten')
  assert.equal(s.status, 'learning')
  assert.ok(s.trace.find((t) => t.staleVersion))
})

test('browsing is open: visiting a step grants nothing, and prerequisites are advice', () => {
  const l = initLearner(bread)
  assert.deepEqual(suggestedFirst(l, bread, 'fermentation').map((c) => c.id), ['gluten'])
  assert.equal(capabilityStatus(l, bread, 'gluten').status, 'unverified')
  const a = nextAction({ ...l, currentConceptId: 'fermentation' }, bread)
  assert.equal(a.conceptId, 'fermentation')
})

test('a step with no verification is done when guided work is complete, and never verifies a capability', () => {
  let l = markExplained(initLearner(bread), 'fermentation')
  l = answer(l, 'fermentation', 'f1', true)
  assert.equal(conceptDone(l, bread, 'fermentation'), true)
})

test('the policy explains before it tests, then lab, then checks', () => {
  const l = initLearner(bread)
  assert.equal(nextAction(l, bread).type, 'explain')
  const l2 = markExplained(l, 'gluten')
  assert.equal(nextAction(l2, bread).type, 'lab')
  assert.equal(nextAction(started(), bread).type, 'check')
})

test('a suspected lead routes to a question that can confirm it', () => {
  let l = started()
  l = answer(l, 'gluten', 'lab-2', false, { activity: 'lab', instanceKey: 'lab:gluten:knead:2', kind: 'labAction', mis: 'more_kneading_always_better' })
  const a = nextAction(l, bread)
  assert.equal(a.type, 'check')
  assert.equal(a.check.id, 'g2')
  assert.equal(a.diagnose, 'more_kneading_always_better')
})

test('a supported misconception is remediated with a task that can clear it — never the question it came up on', () => {
  // Stated in g2's answer: a retry of g2 cannot confirm it is cleared, so a fresh practice question is used.
  let l = answer(started(), 'gluten', 'g1', true)
  l = answer(l, 'gluten', 'g2', false, { kind: 'freeResponse', mis: 'more_kneading_always_better', stated: true })
  let a = nextAction(l, bread)
  assert.equal(a.type, 'remediate')
  assert.equal(a.check, null)
  assert.equal(a.practice.type, 'dough')
  // Raised twice in the lab: the untouched check g2 can confirm it.
  l = started()
  l = answer(l, 'gluten', 'lab-a', false, { activity: 'lab', instanceKey: 'lab:gluten:knead:a', kind: 'labAction', mis: 'more_kneading_always_better' })
  l = answer(l, 'gluten', 'lab-b', false, { activity: 'lab', instanceKey: 'lab:gluten:knead:b', kind: 'labAction', mis: 'more_kneading_always_better' })
  a = nextAction(l, bread)
  assert.equal(a.type, 'remediate')
  assert.equal(a.check.id, 'g2')
})

test('repeated wrong answers re-explain from a layer not read yet, and stop once none is left', () => {
  let l = started()
  l = answer(l, 'gluten', 'g1', false)
  l = answer(l, 'gluten', 'g1', false)
  l = answer(l, 'gluten', 'x', false, { instanceKey: 'x' })
  l.concepts.gluten.mastery = 0.1
  const a = nextAction(l, bread)
  assert.equal(a.type, 'explain')
  assert.equal(a.layer, 'example')
  l = markExplained(markExplained(l, 'gluten', 'example'), 'gluten', 'formal')
  assert.notEqual(nextAction(l, bread).type, 'explain')
})

test('marking an already-seen layer returns the same model, so render-driven calls cannot loop', () => {
  const l = markExplained(initLearner(bread), 'gluten', 'intuition')
  assert.equal(markExplained(l, 'gluten', 'intuition'), l)
})

test('review rotates to a check never passed on a first try', () => {
  let l = markExplained(initLearner(bread), 'gluten')
  l = answer(l, 'gluten', 'g1', false)
  l = answer(l, 'gluten', 'g1', true)
  l = answer(l, 'gluten', 'g2', true, { kind: 'freeResponse' })
  assert.equal(reviewCheck(l, bread.concepts[0]).id, 'g1')
})

test('progress counts steps done and capabilities verified; the trace never shows the raw estimate as a score', () => {
  const l = verify(answer(answer(started(), 'gluten', 'g1', true), 'gluten', 'g2', true, { kind: 'freeResponse' }))
  const p = progress(l, bread)
  assert.equal(p.verified, 1)
  assert.equal(p.capabilities, 1)
  assert.equal(p.done, 1)
  assert.ok(!('mastery' in explainDecision(l, bread).trace))
})

// --- persistence -------------------------------------------------------------------

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    keys: () => [...m.keys()],
    map: m,
  }
}

const V1 = {
  courseId: 'bread',
  version: 1,
  startedAt: 1,
  currentConceptId: 'gluten',
  concepts: {
    gluten: {
      mastery: 0.97, attempts: 4, correct: 4, seenExplain: true, layersSeen: ['intuition'], completedAt: 5,
      evidence: [
        { ts: 2, kind: 'labAction', correct: true, detail: { labStep: 'x' } },
        { ts: 3, kind: 'mcq', correct: true, detail: { checkId: 'g1' } },
        { ts: 4, kind: 'freeResponse', correct: true, detail: { checkId: 'g2' } },
      ],
      misconceptions: { more_kneading_always_better: { count: 1, resolved: false } },
    },
  },
  log: [],
}

test('AC-12: an old "mastered" save is kept as history and the capability awaits verification', () => {
  const storage = memoryStorage({ [keyV1('bread')]: JSON.stringify(V1) })
  const { learner, notice } = loadLearner(bread, storage)
  assert.equal(notice.kind, 'migrated')
  assert.ok(notice.reverify.includes('能判断面团揉到位没有'))
  assert.equal(capabilityStatus(learner, bread, 'gluten').status, 'learning')
  // An open old misconception is carried as a lead to check, not enforced as a finding.
  assert.equal(misconceptionList(learner, 'gluten')[0].status, 'suspected')
  assert.equal(nextAction(learner, bread).type, 'verify')
  // the old save is not deleted
  assert.ok(storage.getItem(keyV1('bread')))
  // passed checks are not asked again, and the lab counts as tried
  assert.equal(learner.legacy.concepts.gluten.passedChecks.length, 2)
  assert.equal(capabilityStatus(learner, bread, 'gluten').trace.at(-1).activity, 'legacy')
})

test('migrated open misconceptions become suspected leads, not supported findings', () => {
  const l = migrateV1(V1, bread)
  assert.equal(l.misconceptions.gluten.more_kneading_always_better.status, 'suspected')
})

test('a failed write is reported, never assumed', () => {
  const full = { getItem: () => null, setItem: () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e } }
  const r = saveLearner(initLearner(bread), full)
  assert.equal(r.ok, false)
  assert.match(r.error, /存储空间已满/)
})

test('an unreadable save is set aside, not overwritten', () => {
  const storage = memoryStorage({ [keyV2('bread')]: '{not json' })
  const { notice } = loadLearner(bread, storage)
  assert.equal(notice.kind, 'unreadable')
  assert.ok(storage.keys().some((k) => k.startsWith(`${keyV2('bread')}:unreadable:`)))
})

test('a course upgrade keeps records and names the results earned on an older task version', () => {
  let l = started()
  l = startAttempt(l, { conceptId: 'gluten', taskId: 'verify', taskVersion: 'v0', activity: 'verify', instanceKey: 'o', resources: 'independent' })
  l = recordJudgement(l, bread, { id: 'old-pass', attemptId: openAttemptFor(l, 'o').id, kind: 'verify', correct: true, closes: true })
  l.courseVersion = 'b0'
  const storage = memoryStorage({ [keyV2('bread')]: JSON.stringify(l) })
  const { learner, notice } = loadLearner(bread, storage)
  assert.equal(notice.kind, 'course-updated')
  assert.deepEqual(notice.reverify, ['能判断面团揉到位没有'])
  assert.ok(learner.judgements.some((j) => j.id === 'old-pass'))
})

test('the export states its observation scope and carries evidence, help and versions', () => {
  let l = started()
  l = recordHelp(l, { conceptId: 'gluten', source: 'hint', level: 1, attemptIds: [] })
  const pkg = exportPackage(l, bread, { versions: { tutorPolicy: 't1' } })
  assert.equal(pkg.observationScope, OBSERVATION_SCOPE)
  assert.equal(pkg.course.version, 'b1')
  assert.equal(pkg.help.length, 1)
  assert.equal(pkg.judgements.length, 1)
  assert.equal(pkg.versions.tutorPolicy, 't1')
  assert.equal(pkg.capabilities[0].status, 'learning')
})

test('a submission the grader could not rate does not use up the first try', () => {
  let l = answer(started(), 'gluten', 'g2', null, { kind: 'freeResponse' })
  l = answer(l, 'gluten', 'g2', true, { kind: 'freeResponse' })
  const j = l.judgements.at(-1)
  assert.equal(j.firstTry, true)
  assert.equal(j.independent, true)
})

test('every record says which session it was made in', () => {
  let l = { ...started(), sessions: [{ id: 's1', startedAt: 1 }] }
  l = recordEvent(l, { conceptId: 'gluten', object: 'x', action: 'y' })
  l = answer(l, 'gluten', 'g1', true)
  l = recordHelp(l, { conceptId: 'gluten', source: 'hint', level: 1 })
  assert.equal(l.events.at(-1).sessionId, 's1')
  assert.equal(l.judgements.at(-1).sessionId, 's1')
  assert.equal(l.help.at(-1).sessionId, 's1')
  assert.equal(Object.values(l.attempts).find((a) => a.taskId === 'g1').sessionId, 's1')
})
