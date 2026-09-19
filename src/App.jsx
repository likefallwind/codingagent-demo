/**
 * The application shell.
 *
 * Steps on the left, the current step (or the capstone project) in the middle,
 * the tutor on the right. Both side panels can be collapsed; below a certain
 * width they start collapsed, so the task is never squeezed out of view.
 *
 * The shell is where the tutor's eyes are wired up. The step reports what its
 * lab shows, which question is being answered and which task is in focus; the
 * shell keeps the last few distinct states of the lab so "why did that change?"
 * has something to refer to, and clears them when the task changes so an old
 * experiment never leaks into a new one.
 *
 * It also owns the one question that crosses components: may help be given
 * right now? While an independent verification or project variant is open, the
 * answer is "ask the learner first", and a yes turns that attempt into assisted
 * practice.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { courseList, getConcept } from './courses/index.js'
import { useLearner } from './engine/useLearner.js'
import { attemptFor } from './engine/learnerModel.js'
import { TUTOR_POLICY } from './engine/tutorPolicy.js'
import { GENERATOR_VERSION } from './labs/practice.js'
import { RUNTIME_LIMITS } from './project/runtime.js'
import { PROJECT_GRADING_VERSION } from './project/grading.js'
import { projectSummary } from './project/summary.js'
import Header from './components/Header.jsx'
import ConceptNav from './components/ConceptNav.jsx'
import ConceptView from './components/ConceptView.jsx'
import TutorPanel from './components/TutorPanel.jsx'
import CapabilityProfile from './components/CapabilityProfile.jsx'
import NoticeBanner from './components/NoticeBanner.jsx'
import ProjectWorkspace from './project/ProjectWorkspace.jsx'
import { Confirm } from './components/ui.jsx'
import { CAP_SHORT } from './engine/capabilities.js'

const course = courseList[0]

function useWidth() {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

export default function App() {
  const L = useLearner(course)
  const learner = L.learner
  const latest = useRef(learner)
  latest.current = learner

  const viewId = learner.currentConceptId
  const isProject = viewId === course.project?.id
  const concept = isProject ? null : course.concepts.find((c) => c.id === viewId) ?? course.concepts[0]
  const tutorConcept = useMemo(() => (isProject ? getConcept(course.id, course.project.id) : concept), [isProject, concept])

  // --- layout ----------------------------------------------------------------------------
  const width = useWidth()
  const [navPref, setNavPref] = useState(null)
  const [tutorPref, setTutorPref] = useState(null)
  const navCollapsed = navPref ?? width < 1180
  const tutorCollapsed = tutorPref ?? width < 960

  // --- the tutor bus -----------------------------------------------------------------------
  const [focus, setFocus] = useState('explain')
  const [labScreen, setLabScreen] = useState(null)
  const [checkScreen, setCheckScreen] = useState(null)
  const [projectScreen, setProjectScreen] = useState(null)
  const [task, setTask] = useState(null)
  const [gate, setGate] = useState(null)
  const [alert, setAlert] = useState(null)
  const [inline, setInline] = useState({})
  const [profile, setProfile] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const previous = useRef([])
  const activity = useRef({ lastAt: Date.now(), interacted: false, thrash: null, sliders: new Map() })
  const sliderTimers = useRef(new Map())

  // A new step starts with a quiet tutor and nothing on record from the last one.
  useEffect(() => {
    activity.current = { lastAt: Date.now(), interacted: false, thrash: null, sliders: new Map() }
    previous.current = []
    setFocus(isProject ? 'project' : 'explain')
    setAlert(null)
    setInline({})
    setLabScreen(null)
    setCheckScreen(null)
    setProjectScreen(null)
  }, [viewId, isProject])

  // Time in a background tab is not time spent stuck.
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') activity.current.lastAt = Date.now() }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  // Earlier lab states belong to the task they came from.
  useEffect(() => { previous.current = [] }, [task?.key])

  const reportLab = useCallback((s) => {
    setLabScreen((old) => {
      if (old && old.conceptId === viewId && JSON.stringify(old.facts) !== JSON.stringify(s.facts)) {
        previous.current = [...previous.current, { doing: old.doing, facts: old.facts ?? [], at: old.at }].slice(-3)
      }
      return { ...s, conceptId: viewId, at: Date.now() }
    })
  }, [viewId])
  const reportCheck = useCallback((s) => setCheckScreen(s ? { ...s, conceptId: viewId } : null), [viewId])
  const reportProject = useCallback((s) => setProjectScreen(s ? { ...s, conceptId: viewId } : null), [viewId])
  const onInline = useCallback((object, payload) => {
    setInline((m) => {
      if (!payload) { const { [object]: _, ...rest } = m; return rest }
      return { ...m, [object]: payload }
    })
  }, [])
  const clearAlert = useCallback(() => setAlert(null), [])

  const learnerState = useMemo(() => {
    const js = learner.judgements.filter((j) => j.conceptId === viewId && j.correct !== null)
    return { attempts: js.length, correct: js.filter((j) => j.correct).length, firstTryWrong: js.filter((j) => j.firstTry && !j.correct).length }
  }, [learner.judgements, viewId])
  const misconceptionHistory = useMemo(
    () => L.misconceptionsOf(viewId).map((m) => `${m.id}（${m.status === 'supported' ? '有证据支持' : '待核实'}）`),
    [L.misconceptionsOf, viewId], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** What the tutor sees. Only what is on screen right now, plus earlier states of the same task. */
  const screen = useMemo(() => {
    if (isProject) return { focus: 'project', ...(projectScreen ?? {}), lab: null, check: null }
    const lab = labScreen?.conceptId === viewId ? labScreen : null
    const chk = checkScreen?.conceptId === viewId ? checkScreen : null
    return {
      focus,
      lab: lab ? { doing: lab.doing, facts: lab.facts ?? [], moment: lab.moment ?? null } : null,
      check: chk && (focus === 'check' || focus === 'verify')
        ? { id: chk.checkId, prompt: chk.prompt, kind: chk.kind, eliminated: chk.eliminated, draft: chk.draft, table: chk.table, diagram: chk.diagram }
        : null,
    }
  }, [isProject, projectScreen, labScreen, checkScreen, focus, viewId])

  /** The part of the screen the server needs, tagged with the task. */
  const screenPayload = useCallback((t, helpSoFar) => {
    const s = screen
    const task = t ? {
      label: t.label, activity: t.activity, attempt: t.attempt ?? '', capability: t.capability ?? '',
      capabilityStatus: t.capabilityStatus ?? '', helpSoFar,
    } : null
    if (s.focus === 'project') {
      return { focus: 'project', doing: s.doing ?? '', facts: s.facts ?? [], previous: [], check: null, code: s.code ?? null, task }
    }
    return {
      focus: s.focus === 'verify' ? 'check' : s.focus,
      doing: s.lab?.doing ?? null,
      facts: s.lab?.facts ?? [],
      previous: s.focus === 'lab' ? previous.current.map((p) => ({ doing: p.doing, facts: p.facts, ago: Math.round((Date.now() - p.at) / 1000) })) : [],
      check: s.check ?? null,
      task,
    }
  }, [screen])

  /**
   * Independent attempts still being verified anywhere in the course: open, not
   * converted, and with no rated submission yet. Help asked for elsewhere may
   * well be help for one of these, so it asks first too.
   */
  const pendingIndependent = useMemo(() => Object.values(learner.attempts).filter((a) => a.status === 'open'
    && a.resources === 'independent' && !a.converted
    && !learner.judgements.some((j) => j.attemptId === a.id && j.correct !== null)), [learner.attempts, learner.judgements])
  const pendingRef = useRef(pendingIndependent)
  pendingRef.current = pendingIndependent

  /**
   * May help be given now? Resolves at once unless an independent attempt is
   * being verified; then the learner decides. A yes converts every such attempt
   * to assisted practice (answers kept) and resolves with their ids, so the
   * help can be recorded against them; a no resolves false.
   */
  const gateRef = useRef(gate)
  gateRef.current = gate
  const requestHelp = useCallback((kind) => new Promise((resolve) => {
    const g = gateRef.current
    const targets = pendingRef.current.map((a) => ({ id: a.id, conceptId: a.conceptId, label: a.label ?? '一次独立验证', kind: a.activity }))
    if (g && !targets.some((t) => t.id === g.attemptId)) targets.unshift({ id: g.attemptId, conceptId: g.conceptId, label: g.label, kind: g.kind })
    if (!targets.length) { resolve({ converted: [] }); return }
    const here = g ? { ...targets.find((t) => t.id === g.attemptId), label: g.label } : null
    const elsewhere = targets.filter((t) => t.id !== here?.id)
    setConfirm({
      title: '现在请求帮助，会把进行中的独立验证转为辅助练习',
      body: `${here ? `${here.label}正在进行。` : `你还有一次独立验证没有完成（${elsewhere.map((t) => `「${t.label.replace(/^独立验证：/, '')}」`).join('、')}），这里的帮助也可能用在那里。`}${kind === 'explain' ? '展开讲解' : '向 AI 老师求助'}之后，它不再计入独立验证；已经填的内容都会保留，之后会换没见过的题目或数据再验证。也可以先不求助，继续独立完成。`,
      confirmLabel: '转为辅助练习并获得帮助',
      cancelLabel: '继续独立完成',
      onConfirm: () => {
        setConfirm(null)
        for (const t of targets) {
          L.convertAttempt(t.id)
          L.event({ conceptId: t.conceptId, object: t.kind, action: 'converted-to-practice', attemptId: t.id, detail: { via: kind, from: viewId } })
        }
        resolve({ converted: targets.map((t) => t.id) })
      },
      onCancel: () => {
        setConfirm(null)
        for (const t of targets) L.event({ conceptId: t.conceptId, object: t.kind, action: 'declined-help', attemptId: t.id, detail: { via: kind, from: viewId } })
        resolve(false)
      },
    })
  }), [L, viewId])

  const attemptIdFor = useCallback((key) => (key ? attemptFor(latest.current, key)?.id ?? null : null), [])

  /**
   * Activity in the main column: when the learner last did anything, sliders
   * moved back and forth, and — as behaviour events — the values sliders are
   * left at. None of it is scored.
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
    t.flips = t.flips.filter((ts) => Date.now() - ts < TUTOR_POLICY.thrashWindowMs)
    if (t.flips.length >= TUTOR_POLICY.thrashFlips) {
      a.thrash = { label, at: Date.now() }
      t.flips = []
    }
    a.sliders.set(label, t)
    clearTimeout(sliderTimers.current.get(label))
    sliderTimers.current.set(label, setTimeout(() => {
      L.event({ conceptId: viewId, object: `slider:${label}`, action: 'set', detail: { value: v } })
    }, 900))
  }, [L, viewId])

  const labAttemptIds = useMemo(
    () => Object.values(learner.attempts).filter((a) => a.conceptId === viewId && a.activity === 'lab').map((a) => a.id),
    [learner.attempts, viewId],
  )
  /** Questions open on this page: help asked for while they are visible may be used on them. */
  const openGuidedIds = useMemo(
    () => Object.values(learner.attempts).filter((a) => a.conceptId === viewId && a.status === 'open' && ['check', 'practice', 'project'].includes(a.activity)).map((a) => a.id),
    [learner.attempts, viewId],
  )

  const bus = useMemo(() => ({
    focus, setFocus, setTask, setGate, raiseAlert: (a) => setAlert({ ...a, at: Date.now() }),
    reportLab, reportCheck, reportProject, openProfile: (id) => setProfile(id ?? true),
    learnerState, misconceptionHistory, screenPayload: screenPayload(task, []),
  }), [focus, reportLab, reportCheck, reportProject, learnerState, misconceptionHistory, screenPayload, task])

  // --- navigation, export, reset ---------------------------------------------------------------
  const go = useCallback((id) => {
    L.goTo(id)
    L.event({ conceptId: id, object: 'nav', action: 'open' })
    setProfile(null)
  }, [L])

  const versions = () => ({
    course: course.version, generator: GENERATOR_VERSION, tutorPolicy: TUTOR_POLICY.version,
    runtime: RUNTIME_LIMITS.version, projectGrading: PROJECT_GRADING_VERSION, runtimeNote: RUNTIME_LIMITS.note,
  })
  const doExport = () => {
    const pkg = L.exportNow({ versions: versions() })
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `learnai-${course.id}-${learner.learnerId}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    L.event({ conceptId: viewId, object: 'record', action: 'export' })
  }
  const askReset = () => setConfirm({
    title: '重置进度？',
    body: '当前的全部记录（作答、帮助、代码、对话）会存成一份备份，然后从头开始。建议先点「导出记录」保存一份文件。',
    confirmLabel: '重置',
    cancelLabel: '取消',
    onConfirm: () => { setConfirm(null); L.reset() },
    onCancel: () => setConfirm(null),
  })

  const statusOf = (id) => {
    if (course.project?.id === id) {
      const s = projectSummary(learner, course)
      const before = (course.project.prerequisites ?? []).find((pid) => !L.doneOf(pid))
      return { key: s.key, label: s.short, review: false, suggest: before ? course.concepts.find((c) => c.id === before)?.shortTitle : null }
    }
    const c = course.concepts.find((x) => x.id === id)
    const cap = L.capabilityOf(id)
    const suggest = L.suggestedFirstOf(id)[0]
    if (!c.verify) {
      const done = L.doneOf(id)
      return { key: done ? 'done' : cap.status === 'unverified' ? 'unverified' : 'learning', label: done ? '引导学习完成（本步不验证）' : cap.status === 'unverified' ? '未开始' : '学习中', suggest: suggest?.shortTitle ?? suggest?.title }
    }
    return { key: cap.status, label: cap.status === 'unverified' ? '未开始' : CAP_SHORT[cap.status], review: cap.review, suggest: suggest?.shortTitle ?? suggest?.title }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <Header course={course} progress={L.progress} saveState={L.saveState} onRetrySave={L.retrySave}
              onExport={doExport} onProfile={() => setProfile(true)} onReset={askReset} />
      <NoticeBanner notice={L.notice} onDismiss={L.dismissNotice} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', minHeight: 0 }}>
        <ConceptNav course={course} currentId={viewId} statusOf={statusOf} onSelect={go}
                    collapsed={navCollapsed} onToggle={() => setNavPref(!navCollapsed)} />

        <main className="scroll-y" id="main"
              onPointerDownCapture={noteActivity} onKeyDownCapture={noteActivity} onInputCapture={noteActivity}
              style={{ flex: 1, minWidth: 0, padding: '16px 20px 40px' }}>
          {isProject ? (
            <ProjectWorkspace course={course} L={L} bus={bus} />
          ) : (
            <ConceptView key={concept.id} course={course} concept={concept} L={L} bus={bus}
                         requestHelp={requestHelp} inlineFor={(o) => inline[o] ?? null} onNavigate={go} />
          )}
        </main>

        <TutorPanel
          course={course}
          concept={tutorConcept}
          L={L}
          screen={screen}
          screenPayload={screenPayload}
          task={task}
          alert={alert}
          onAlertHandled={clearAlert}
          activity={activity}
          requestHelp={requestHelp}
          gate={gate}
          collapsed={tutorCollapsed}
          onToggle={() => setTutorPref(!tutorCollapsed)}
          onInline={onInline}
          attemptIdFor={attemptIdFor}
          labAttemptIds={labAttemptIds}
          openGuidedIds={openGuidedIds}
          learnerState={learnerState}
          misconceptionHistory={misconceptionHistory} />
      </div>

      <CapabilityProfile open={Boolean(profile)} focus={typeof profile === 'string' ? profile : null} course={course}
                         profile={L.profile()} misconceptionsOf={L.allMisconceptionsOf}
                         projectSummary={projectSummary(learner, course).rows}
                         onClose={() => setProfile(null)} onGo={go} />
      <Confirm open={Boolean(confirm)} title={confirm?.title} confirmLabel={confirm?.confirmLabel} cancelLabel={confirm?.cancelLabel}
               onConfirm={confirm?.onConfirm} onCancel={confirm?.onCancel}>{confirm?.body}</Confirm>
    </div>
  )
}
