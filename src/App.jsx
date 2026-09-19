/**
 * The application shell.
 *
 * Holds the linear spine of the course on the left, the current concept's
 * material and lab in the middle, and the tutor on the right. The policy's
 * decision is surfaced as a visible line — "why am I seeing this" — rather than
 * silently reordering things behind the learner's back.
 *
 * Adaptivity is scoped to within a concept: the policy chooses what to show
 * inside the step (explain / lab / which check / practice / remediate), while
 * the learner keeps free movement between unlocked concepts.
 *
 * The shell is also where the tutor's eyes are wired up. Labs report what they
 * show (see labs/screen.js), the question card reports what is being answered,
 * and the main column reports activity — so the tutor always knows what the
 * learner is doing, and can notice when they are stuck.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { courseList } from './courses/index.js'
import { useLearner } from './engine/useLearner.js'
import { getLab } from './labs/registry.js'
import { generatePractice } from './labs/practice.js'
import { LAYERS, reviewCheck, practiceSeed } from './engine/policy.js'
import { MASTERY_THRESHOLD } from './engine/learnerModel.js'
import Header from './components/Header.jsx'
import ConceptNav from './components/ConceptNav.jsx'
import TutorPanel from './components/TutorPanel.jsx'
import CheckCard from './components/CheckCard.jsx'
import { Card, Chip, Button, Feedback } from './components/ui.jsx'

const LAYER_LABEL = { intuition: '直觉', example: '例子', formal: '形式化' }

/**
 * Stand-in for a concept the learner model does not know about yet.
 *
 * Switching courses leaves one render where `course` is the new course but the
 * model is still the old one, so the lookup misses. Hooks below read this object
 * — including inside dependency arrays, which are evaluated during render — so
 * it has to be a real object rather than undefined, or the whole app throws and
 * blanks out.
 */
const PENDING_STATE = Object.freeze({
  mastery: 0, attempts: 0, correct: 0, evidence: [], misconceptions: {},
  seenExplain: false, layersSeen: [], completedAt: null,
})

/** Slider moves that reverse direction this often within the window count as thrashing. */
const THRASH_FLIPS = 4
const THRASH_WINDOW_MS = 20000

export default function App() {
  const [courseId, setCourseId] = useState(courseList[0].id)
  const course = courseList.find((c) => c.id === courseId)
  const L = useLearner(course)
  const [alert, setAlert] = useState(null)
  const [openLayers, setOpenLayers] = useState({})
  // The question currently being answered, pinned as an object rather than an
  // id: a generated practice question exists nowhere else. Without the pin,
  // answering changes what the policy wants next, the card unmounts, and the
  // explanation of why the answer was right flashes past unread.
  const [pinned, setPinned] = useState(null)
  // Bumped each time the learner moves past a question, so a re-asked check
  // with the same id comes back as a fresh card rather than the answered one.
  const [checkRound, setCheckRound] = useState(0)
  // The layer the policy opened because the learner kept getting it wrong.
  const [scaffold, setScaffold] = useState(null)
  // What the tutor can see. Tagged with the concept they came from: a new lab
  // reports before the shell's own effects run, so resetting on navigation
  // would wipe the fresh report instead of the stale one.
  const [labScreen, setLabScreen] = useState(null)
  const [checkScreen, setCheckScreen] = useState(null)
  const [focus, setFocus] = useState('explain')
  const activity = useRef({ lastAt: Date.now(), interacted: false, thrash: null, sliders: new Map() })
  const checkRef = useRef(null)
  const scaffoldMark = useRef(null)

  const concept = course.concepts.find((c) => c.id === L.learner.currentConceptId) ?? course.concepts[0]
  const modelReady = L.learner.courseId === course.id
  const state = L.learner.concepts[concept.id] ?? PENDING_STATE
  const status = L.statusOf(concept.id)
  const action = L.action
  const Lab = concept.lab ? getLab(concept.lab.type) : null
  const idx = course.concepts.indexOf(concept)

  const misconceptionHistory = useMemo(
    () => L.misconceptionsOf(concept.id).map((m) => m.id),
    // Not `L`: that object is new on every render, which would make the tutor's
    // alert effect restart its request whenever anything re-renders.
    [L.misconceptionsOf, concept.id],
  )

  const learnerState = useMemo(
    () => ({ mastery: state.mastery, attempts: state.attempts, correct: state.correct }),
    [state.mastery, state.attempts, state.correct],
  )

  // The intuition is always open at the top of the page, so arriving at a
  // concept is having been shown it. Without this the policy kept saying "first
  // build the intuition" until the learner happened to expand another layer.
  useEffect(() => {
    if (modelReady) L.explained(concept.id, 'intuition')
  }, [modelReady, concept.id, L.explained])

  // A fresh concept starts with a quiet tutor and no activity on record.
  useEffect(() => {
    activity.current = { lastAt: Date.now(), interacted: false, thrash: null, sliders: new Map() }
    setFocus('explain')
  }, [concept.id])

  /**
   * Evidence from a lab.
   *
   * The lab has already told the learner whether they were right — that came
   * from the maths and was instant. What happens here is bookkeeping plus, on a
   * mistake, waking the tutor to explain why. An `ungraded` observation (the
   * grader was unreachable) is deliberately not recorded: a network failure must
   * not move the mastery estimate.
   */
  const handleEvidence = useCallback((obs) => {
    if (obs.kind === 'ungraded') return
    L.record({
      conceptId: concept.id,
      kind: obs.kind,
      correct: obs.correct,
      // Labs can name a misconception that only another concept catalogues;
      // recording it here would stall this one.
      misconceptionId: (concept.misconceptions ?? []).some((m) => m.id === obs.misconceptionId)
        ? obs.misconceptionId
        : null,
      detail: obs.detail,
    })
    if (!obs.correct && obs.facts?.length) {
      // Authored words to fall back on if the model is unreachable, so a lab
      // mistake is never answered by an error message: the belief this action
      // suggests when the lab tagged one, otherwise a pointer back to the result.
      const belief = (concept.misconceptions ?? []).find((m) => m.id === obs.misconceptionId)?.belief
      const fallback = belief
        ? `你可能是这样想的：「${belief}」。对照实验里刚显示的结果，看看这个想法哪里站不住。`
        : '对照实验里刚显示的结果，看看它和你的判断差在哪一步。'
      setAlert({ kind: 'lab', facts: obs.facts, description: obs.description, retry: Boolean(obs.retry), fallback, at: Date.now() })
    }
  }, [L, concept])

  /**
   * A wrong answer to a check. The card has already said "wrong" and lets the
   * learner retry; the tutor panel says why. `fallback` is authored text shown
   * if the model is unreachable, so the panel is never silent after a mistake.
   * It names the suspected belief, never the right option.
   */
  const handleWrongAnswer = useCallback((info) => {
    const { check } = info
    const misId = (info.choice !== undefined ? check.options?.[info.choice]?.misconception : null)
      ?? check.misconceptions?.[0]
    const belief = (concept.misconceptions ?? []).find((m) => m.id === misId)?.belief
    const fallback = belief
      ? `你可能是这样想的：「${belief}」。对照上面的讲解想一想，这个想法哪里站不住。`
      : '回到上面讲解里的「例子」和「形式化」两部分，对照题目里的条件再看一遍。'
    setAlert({
      kind: 'check', checkId: check.id, choice: info.choice, verdict: info.verdict,
      feedback: info.feedback, fallback, at: Date.now(),
    })
  }, [concept])

  // Stable, so the tutor panel's alert effect does not restart its request on
  // every unrelated re-render of the app.
  const clearAlert = useCallback(() => setAlert(null), [])

  const onLabScreen = useCallback((s) => setLabScreen({ ...s, conceptId: concept.id }), [concept.id])
  const onCheckScreen = useCallback((s) => setCheckScreen({ ...s, conceptId: concept.id }), [concept.id])

  const openLayer = (layer) => {
    const key = `${concept.id}:${layer}`
    setOpenLayers((o) => ({ ...o, [key]: !o[key] }))
    L.explained(concept.id, layer)
  }

  const isOpen = (layer) => Boolean(openLayers[`${concept.id}:${layer}`]) || layer === 'intuition'

  // Repeated wrong answers: the policy asks for the explanation from an angle
  // not yet read. Open that layer for the learner rather than only saying so —
  // once per new piece of evidence, since opening it changes which layer the
  // policy would name next.
  useEffect(() => {
    if (action.type !== 'explain' || !action.scaffold || action.conceptId !== concept.id) return
    const mark = `${concept.id}:${state.evidence.length}`
    if (scaffoldMark.current === mark) return
    scaffoldMark.current = mark
    setOpenLayers((o) => ({ ...o, [`${concept.id}:${action.layer}`]: true }))
    setScaffold({ conceptId: concept.id, layer: action.layer })
    L.explained(concept.id, action.layer)
  }, [action, concept.id, state.evidence.length, L.explained])

  // The generated question this concept would ask next, if it has a generator.
  const seed = practiceSeed(L.learner, concept.id)
  const practiceCheck = useMemo(
    () => (concept.practice ? generatePractice(concept.practice, seed) : null),
    [concept.practice, seed],
  )

  // Which question to put in front of the learner: the pinned one while an
  // answer is on screen; otherwise whichever the policy names; otherwise the
  // first unanswered one; otherwise — while the concept is not yet mastered —
  // fresh practice or a check to review. That last case matters while the
  // policy is busy remediating or re-explaining: without it the page shows no
  // question at all and the learner has nothing to click.
  const policyCheck = action.conceptId === concept.id
    ? (action.type === 'check' ? action.check : action.type === 'practice' ? practiceCheck : null)
    : null
  const firstOpen = (concept.checks ?? []).find((c) => !(state.evidence ?? []).some((e) => e.correct && e.detail?.checkId === c.id))
  const fallbackCheck = status !== 'mastered' ? (practiceCheck ?? reviewCheck(L.learner, concept)) : null
  const activeCheck = (pinned?.conceptId === concept.id ? pinned.check : null)
    ?? policyCheck ?? firstOpen ?? fallbackCheck

  // What the tutor sees: the lab's latest report, the question being answered,
  // and which of the two the learner last touched.
  const screen = useMemo(() => {
    const lab = labScreen?.conceptId === concept.id ? labScreen : null
    const chk = checkScreen?.conceptId === concept.id && checkScreen.checkId === activeCheck?.id ? checkScreen : null
    return {
      focus,
      lab: lab ? { doing: lab.doing, facts: lab.facts ?? [], moment: lab.moment ?? null } : null,
      check: chk ? { id: chk.checkId, prompt: chk.prompt, kind: chk.kind, eliminated: chk.eliminated, draft: chk.draft, table: chk.table } : null,
    }
  }, [labScreen, checkScreen, focus, concept.id, activeCheck?.id])

  /**
   * Activity in the main column, for the tutor's "you seem stuck" nudges: when
   * the learner last did anything, and whether a slider is being dragged back
   * and forth — the visible sign of searching without knowing what for.
   */
  const noteActivity = useCallback((e) => {
    const a = activity.current
    a.lastAt = Date.now()
    a.interacted = true
    const el = e.target
    if (e.type !== 'input' || el?.type !== 'range') return
    const label = el.getAttribute('aria-label') ?? '滑块'
    const v = Number(el.value)
    const t = a.sliders.get(label) ?? { v, dir: 0, flips: [] }
    const dir = Math.sign(v - t.v)
    if (dir && t.dir && dir !== t.dir) t.flips.push(Date.now())
    if (dir) t.dir = dir
    t.v = v
    t.flips = t.flips.filter((ts) => Date.now() - ts < THRASH_WINDOW_MS)
    if (t.flips.length >= THRASH_FLIPS) {
      a.thrash = { label, at: Date.now() }
      t.flips = []
    }
    a.sliders.set(label, t)
  }, [])

  // One render can elapse between selecting a course and its model loading.
  // Every hook above has already run, so returning here is safe.
  if (!modelReady) return null

  const nextConcept = course.concepts[idx + 1]
  const canAdvance = status === 'mastered' && nextConcept
  const unpinAndGo = (id) => { L.goTo(id); setAlert(null); setPinned(null) }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Header
        course={course}
        courses={courseList}
        onCourseChange={(id) => { setCourseId(id); setAlert(null); setPinned(null) }}
        progress={L.progress}
        onReset={() => { L.reset(); setAlert(null); setPinned(null) }} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', minHeight: 0 }}>
        <ConceptNav course={course} learner={L.learner} statusOf={L.statusOf}
                    currentId={concept.id} onSelect={unpinAndGo} />

        <main className="scroll-y"
              onPointerDownCapture={noteActivity} onKeyDownCapture={noteActivity} onInputCapture={noteActivity}
              style={{
                flex: 1, minWidth: 0, padding: '18px 22px 40px',
                display: 'flex', flexDirection: 'column', gap: 16,
              }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 20,
            background: 'linear-gradient(180deg,#F1F6FF 0%,#EAF1FF 100%)',
            border: '1px solid #DCE7FA', borderRadius: 13, padding: '20px 24px',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 500 }}>
                  第 {idx + 1} / {course.concepts.length} 步
                </span>
                {concept.chapter && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{concept.chapter}</span>}
                <Chip tone={status === 'mastered' ? 'ok' : 'brand'}>
                  {status === 'mastered' ? '已掌握' : `掌握度 ${Math.round(state.mastery * 100)}%`}
                </Chip>
              </div>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--ink-strong)', letterSpacing: '-0.3px' }}>
                {concept.title}
              </h1>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.8 }}>
                {concept.objectives.map((o, i) => (
                  <div key={i}>· {o}</div>
                ))}
              </div>
            </div>
          </div>

          {/* The policy's reasoning, shown rather than hidden. */}
          <div data-testid="policy-why" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px',
            background: '#fff', border: '1px solid var(--border)', borderRadius: 11,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--brand)', flex: 'none' }} />
            <span style={{ fontSize: 12.5, color: 'var(--ink-mid)' }}>
              {/* The policy speaks about the course. When the learner has navigated
                  back to a concept they already finished, that message belongs to a
                  different step and reads as a non-sequitur here. */}
              {status === 'mastered'
                ? `「${concept.title}」已掌握，你在复习。实验室随时可以再练。`
                : action.why}
            </span>
            <div style={{ flex: 1 }} />
            {/* The question sits below the explanation and the lab, often off
                screen. Point at it rather than leaving the learner to scroll. */}
            {activeCheck && status !== 'mastered' && (
              <Button variant="primary" style={{ height: 30, fontSize: 12.5, flex: 'none' }}
                onClick={() => checkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                去做题 ↓
              </Button>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--muted-light)', flex: 'none' }}>
              掌握度到 {Math.round(MASTERY_THRESHOLD * 100)}%、每道题都做对过，解锁下一步
            </span>
          </div>

          {/* Layered explanation. Intuition is always open; the rest unfold. */}
          <div onPointerDownCapture={() => setFocus('explain')}>
            <Card title="讲解">
              {LAYERS.map((layer) => {
                const body = concept.explain[layer]
                if (!body) return null
                const open = isOpen(layer)
                const suggested = scaffold?.conceptId === concept.id && scaffold.layer === layer
                return (
                  <div key={layer} data-layer={layer} style={{ borderTop: layer === 'intuition' ? 'none' : '1px solid var(--border-faint)', paddingTop: layer === 'intuition' ? 0 : 12, marginTop: layer === 'intuition' ? 0 : 12 }}>
                    <button onClick={() => layer !== 'intuition' && openLayer(layer)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
                        padding: 0, marginBottom: open ? 8 : 0,
                        cursor: layer === 'intuition' ? 'default' : 'pointer',
                      }}>
                      <Chip tone={open ? 'brand' : 'neutral'}>{LAYER_LABEL[layer]}</Chip>
                      {suggested && <Chip tone="warn">换个角度再看一遍</Chip>}
                      {layer !== 'intuition' && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{open ? '收起' : '展开'}</span>
                      )}
                    </button>
                    {open && (
                      <div className="fade-up" style={{ fontSize: 13.5, lineHeight: 1.95, color: 'var(--ink-mid)', textWrap: 'pretty' }}>
                        {body}
                      </div>
                    )}
                  </div>
                )
              })}
            </Card>
          </div>

          {/* Remediation takes the floor when a misconception is live. */}
          {action.type === 'remediate' && action.conceptId === concept.id && action.misconception && (
            <Feedback tone="warn" title="先把这个理清楚">
              你可能以为：<b>{action.misconception.belief}</b>
              <div style={{ marginTop: 8 }}>{action.misconception.correction}</div>
            </Feedback>
          )}

          {Lab && (
            <div data-testid="lab" onPointerDownCapture={() => setFocus('lab')}>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>动手实验</div>
              <Lab key={concept.id} config={concept.lab.config} onEvidence={handleEvidence} onScreen={onLabScreen} />
            </div>
          )}

          {activeCheck && (
            <div ref={checkRef} onPointerDownCapture={() => setFocus('check')} onFocusCapture={() => setFocus('check')}>
              <CheckCard
                key={`${concept.id}:${activeCheck.id}:${checkRound}`}
                course={course}
                concept={concept}
                check={activeCheck}
                learnerState={learnerState}
                misconceptionHistory={misconceptionHistory}
                screen={screen}
                onEvidence={handleEvidence}
                onScreen={onCheckScreen}
                onAnswered={() => setPinned({ conceptId: concept.id, check: activeCheck })}
                onWrong={handleWrongAnswer}
                onContinue={() => { setPinned(null); setCheckRound((r) => r + 1) }} />
            </div>
          )}

          {status === 'mastered' && (
            <Feedback tone="ok" title={`「${concept.title}」已掌握`}>
              {nextConcept
                ? <>下一个概念「{nextConcept.title}」已解锁。</>
                : <>这门课的每个概念都达到了掌握标准。{course.conclusion}</>}
              {canAdvance && (
                <div style={{ marginTop: 12 }}>
                  <Button variant="primary" onClick={() => unpinAndGo(nextConcept.id)}>
                    进入「{nextConcept.title}」
                  </Button>
                </div>
              )}
            </Feedback>
          )}
        </main>

        <TutorPanel
          course={course}
          concept={concept}
          learnerState={learnerState}
          misconceptionHistory={misconceptionHistory}
          mastered={status === 'mastered'}
          screen={screen}
          activity={activity}
          alert={alert}
          onAlertHandled={clearAlert}
          attemptsInStep={state.attempts} />
      </div>
    </div>
  )
}
