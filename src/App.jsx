/**
 * The application shell.
 *
 * Holds the linear spine of the course on the left, the current concept's
 * material and lab in the middle, and the tutor on the right. The policy's
 * decision is surfaced as a visible line — "why am I seeing this" — rather than
 * silently reordering things behind the learner's back.
 *
 * Adaptivity is scoped to within a concept: the policy chooses what to show
 * inside the step (explain / lab / which check / remediate), while the learner
 * keeps free movement between unlocked concepts.
 */

import React, { useCallback, useMemo, useState } from 'react'
import { courseList } from './courses/index.js'
import { useLearner } from './engine/useLearner.js'
import { getLab } from './labs/registry.js'
import { LAYERS } from './engine/policy.js'
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
  seenExplain: false, completedAt: null,
})

export default function App() {
  const [courseId, setCourseId] = useState(courseList[0].id)
  const course = courseList.find((c) => c.id === courseId)
  const L = useLearner(course)
  const [alert, setAlert] = useState(null)
  const [openLayers, setOpenLayers] = useState({})
  // The question currently being answered. Without this, answering correctly
  // changes what the policy wants next, the card unmounts, and the explanation
  // of why the answer was right flashes past unread.
  const [pinnedCheckId, setPinnedCheckId] = useState(null)

  const concept = course.concepts.find((c) => c.id === L.learner.currentConceptId) ?? course.concepts[0]
  const modelReady = L.learner.courseId === course.id
  const state = L.learner.concepts[concept.id] ?? PENDING_STATE
  const status = L.statusOf(concept.id)
  const action = L.action
  const Lab = concept.lab ? getLab(concept.lab.type) : null

  const misconceptionHistory = useMemo(
    () => L.misconceptionsOf(concept.id).map((m) => m.id),
    [L, concept.id],
  )

  const learnerState = useMemo(
    () => ({ mastery: state.mastery, attempts: state.attempts, correct: state.correct }),
    [state.mastery, state.attempts, state.correct],
  )

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
      misconceptionId: obs.misconceptionId,
      detail: obs.detail,
    })
    if (!obs.correct && obs.facts?.length) {
      setAlert({ facts: obs.facts, description: obs.description, at: Date.now() })
    }
  }, [L, concept.id])

  const openLayer = (layer) => {
    setOpenLayers((o) => ({ ...o, [`${concept.id}:${layer}`]: !o[`${concept.id}:${layer}`] }))
    L.explained(concept.id)
  }

  const isOpen = (layer) => Boolean(openLayers[`${concept.id}:${layer}`]) || layer === 'intuition'

  // Which check to put in front of the learner: the pinned one while an answer
  // is on screen, otherwise whichever the policy names, otherwise the first
  // unanswered one.
  const activeCheck = (pinnedCheckId && (concept.checks ?? []).find((c) => c.id === pinnedCheckId))
    || (action.type === 'check' ? action.check : null)
    || (concept.checks ?? []).find((c) => !(state.evidence ?? []).some((e) => e.correct && e.detail?.checkId === c.id))

  // One render can elapse between selecting a course and its model loading.
  // Every hook above has already run, so returning here is safe.
  if (!modelReady) return null

  const idx = course.concepts.indexOf(concept)
  const nextConcept = course.concepts[idx + 1]
  const canAdvance = status === 'mastered' && nextConcept

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Header
        course={course}
        courses={courseList}
        onCourseChange={(id) => { setCourseId(id); setAlert(null); setPinnedCheckId(null) }}
        progress={L.progress}
        onReset={() => { L.reset(); setAlert(null); setPinnedCheckId(null) }} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', minHeight: 0 }}>
        <ConceptNav course={course} learner={L.learner} statusOf={L.statusOf}
                    currentId={concept.id}
                    onSelect={(id) => { L.goTo(id); setPinnedCheckId(null); setAlert(null) }} />

        <main className="scroll-y" style={{
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
          <div style={{
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
            <span style={{ fontSize: 11.5, color: 'var(--muted-light)' }}>
              掌握度达到 {Math.round(MASTERY_THRESHOLD * 100)}% 解锁下一步
            </span>
          </div>

          {/* Layered explanation. Intuition is always open; the rest unfold. */}
          <Card title="讲解">
            {LAYERS.map((layer) => {
              const body = concept.explain[layer]
              if (!body) return null
              const open = isOpen(layer)
              return (
                <div key={layer} style={{ borderTop: layer === 'intuition' ? 'none' : '1px solid var(--border-faint)', paddingTop: layer === 'intuition' ? 0 : 12, marginTop: layer === 'intuition' ? 0 : 12 }}>
                  <button onClick={() => layer !== 'intuition' && openLayer(layer)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
                      padding: 0, marginBottom: open ? 8 : 0,
                      cursor: layer === 'intuition' ? 'default' : 'pointer',
                    }}>
                    <Chip tone={open ? 'brand' : 'neutral'}>{LAYER_LABEL[layer]}</Chip>
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

          {/* Remediation takes the floor when a misconception is live. */}
          {action.type === 'remediate' && action.misconception && (
            <Feedback tone="warn" title="先把这个理清楚">
              你可能以为：<b>{action.misconception.belief}</b>
              <div style={{ marginTop: 8 }}>{action.misconception.correction}</div>
            </Feedback>
          )}

          {Lab && (
            <div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>动手实验</div>
              <Lab onEvidence={handleEvidence} />
            </div>
          )}

          {activeCheck && (
            <CheckCard
              key={`${concept.id}:${activeCheck.id}`}
              course={course}
              concept={concept}
              check={activeCheck}
              learnerState={learnerState}
              misconceptionHistory={misconceptionHistory}
              onEvidence={handleEvidence}
              onAnswered={() => setPinnedCheckId(activeCheck.id)}
              onContinue={() => setPinnedCheckId(null)} />
          )}

          {status === 'mastered' && (
            <Feedback tone="ok" title={`「${concept.title}」已掌握`}>
              {nextConcept
                ? <>下一个概念「{nextConcept.title}」已解锁。</>
                : <>这门课的每个概念都达到了掌握标准。{course.conclusion}</>}
              {canAdvance && (
                <div style={{ marginTop: 12 }}>
                  <Button variant="primary" onClick={() => { L.goTo(nextConcept.id); setAlert(null); setPinnedCheckId(null) }}>
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
          alert={alert}
          onAlertHandled={() => setAlert(null)}
          attemptsInStep={state.attempts}
          labState={`掌握度 ${Math.round(state.mastery * 100)}%，已尝试 ${state.attempts} 次`} />
      </div>
    </div>
  )
}
