/**
 * One step of the course: its task, explanation, lab, questions and
 * verification — and the bookkeeping that turns what happens on the page into
 * evidence.
 *
 *   - A lab's committed judgement (a prediction, a pick) is a judgement in an
 *     attempt on that lab step. A lab's exploration is a behaviour event: it
 *     never moves the estimate and never diagnoses a misconception.
 *   - A question on screen has an attempt from the moment it is shown, so help
 *     asked for while it is visible is linked to it.
 *   - The verification is started explicitly, after its resources are stated,
 *     and while it is open and independent every route to help asks first.
 *
 * What the tutor needs — what is on screen, which task is in focus, which
 * attempts help would touch — is reported upward through `bus`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getLab } from '../labs/registry.js'
import { practiceInstance, verifyInstance, checkInstanceKey, labInstanceKey } from '../labs/tasks.js'
import { generateVerifyItem } from '../labs/practice.js'
import { attemptFor, openAttemptFor, labAttempted, openChecks, pendingChecks } from '../engine/learnerModel.js'
import { verifyAttempts } from '../engine/policy.js'
import { newId } from '../engine/ids.js'
import TaskBar from './TaskBar.jsx'
import Explanation from './Explanation.jsx'
import CheckCard from './CheckCard.jsx'
import VerifyCard from './VerifyCard.jsx'
import { Feedback, Button, showObject } from './ui.jsx'

/** Rebuild a submitted verification's questions from the seeds stored on its attempt. */
function rebuildVerify(concept, attempt) {
  if (!attempt?.items) return null
  const items = attempt.items.map((it) => generateVerifyItem(concept, it.index, it.seed))
  return items.every(Boolean) ? { items, seeds: attempt.items, instanceKey: attempt.instanceKey } : null
}

export default function ConceptView({ course, concept, L, bus, requestHelp, inlineFor, onNavigate }) {
  const learner = L.learner
  const cid = concept.id
  const idx = course.concepts.indexOf(concept)
  const action = L.actionFor(cid)
  const cap = L.capabilityOf(cid)
  const state = learner.concepts[cid]
  const done = L.doneOf(cid)
  const Lab = concept.lab ? getLab(concept.lab.type) : null
  const latest = useRef(learner)
  latest.current = learner

  const [openLayers, setOpenLayers] = useState([])
  const [scaffold, setScaffold] = useState(null)
  const [pinned, setPinned] = useState(null)
  const [verifyPinned, setVerifyPinned] = useState(null)
  const [mode, setMode] = useState(null)
  const [round, setRound] = useState(0)
  const scaffoldMark = useRef(null)

  // Arriving at a step is having been shown its intuition.
  useEffect(() => { L.explained(cid, 'intuition') }, [cid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Repeated wrong answers: open a layer not read yet, once per new judgement.
  const judgementCount = learner.judgements.filter((j) => j.conceptId === cid).length
  useEffect(() => {
    if (action.type !== 'explain' || !action.scaffold) return
    const mark = `${cid}:${judgementCount}`
    if (scaffoldMark.current === mark) return
    scaffoldMark.current = mark
    setOpenLayers((o) => (o.includes(action.layer) ? o : [...o, action.layer]))
    setScaffold(action.layer)
    L.explained(cid, action.layer)
    L.event({ conceptId: cid, object: `explain:${action.layer}`, action: 'auto-open', detail: { reason: 'struggling' } })
  }, [action, cid, judgementCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLayer = async (layer) => {
    const opening = !openLayers.includes(layer)
    if (opening && !(await requestHelp('explain'))) return
    setOpenLayers((o) => (opening ? [...o, layer] : o.filter((x) => x !== layer)))
    if (opening) {
      L.explained(cid, layer)
      L.event({ conceptId: cid, object: `explain:${layer}`, action: 'open' })
    }
  }

  // --- which question is on screen -------------------------------------------------

  const practiceSig = Object.values(learner.attempts)
    .filter((a) => a.conceptId === cid && a.activity === 'practice').map((a) => `${a.id}:${a.status}`).join(',')
  const practiceTarget = action.type === 'remediate' && action.practice ? action.misconceptionId : null
  const practice = useMemo(() => (concept.practice ? practiceInstance(latest.current, concept, { target: practiceTarget }) : null),
    [concept, practiceSig, round, practiceTarget]) // eslint-disable-line react-hooks/exhaustive-deps

  const authored = (check) => check && { check, activity: 'check', taskId: check.id, instanceKey: checkInstanceKey(cid, check) }
  const practiced = practice && { check: practice.check, activity: 'practice', taskId: practice.check.id, instanceKey: practice.instanceKey, seed: practice.seed }
  const open = openChecks(learner, concept, { pending: false })
  const pending = pendingChecks(learner, concept)

  const openVerify = verifyAttempts(learner, cid).find((a) => a.status === 'open') ?? null
  const wantsVerify = concept.verify && !done && (Boolean(openVerify) || (action.type === 'verify' && mode !== 'practice') || mode === 'verify')

  let guided = null
  if (pinned?.conceptId === cid) guided = pinned
  else if (mode?.kind === 'check') guided = authored(concept.checks.find((c) => c.id === mode.id))
  else if (openVerify && !openVerify.converted) guided = null
  else if (action.type === 'check' || (action.type === 'remediate' && action.check)) guided = authored(action.check)
  else if ((action.type === 'practice' || (action.type === 'remediate' && action.practice)) && mode !== 'verify') guided = practiced
  else if (mode === 'practice') guided = practiced
  else if (!done && !wantsVerify && open[0]) guided = authored(open[0])

  const guidedAttempt = guided ? attemptFor(learner, guided.instanceKey) : null
  const guidedHistory = guidedAttempt ? learner.judgements.filter((j) => j.attemptId === guidedAttempt.id) : []

  // A question on screen has an attempt, so help asked while it is visible is linked to it.
  useEffect(() => {
    if (!guided || pinned?.conceptId === cid) return
    if (openAttemptFor(latest.current, guided.instanceKey)) return
    L.startAttempt({
      conceptId: cid, taskId: guided.taskId, taskVersion: guided.check.generatorVersion ?? course.version,
      activity: guided.activity, instanceKey: guided.instanceKey, capability: concept.capability?.id,
      seed: guided.seed ?? null, label: guided.check.prompt.slice(0, 40),
    })
  }, [guided?.instanceKey, pinned, cid]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- verification ------------------------------------------------------------------

  const verifyCount = verifyAttempts(learner, cid).length
  const verifyInst = useMemo(() => {
    if (verifyPinned) return rebuildVerify(concept, learner.attempts[verifyPinned])
    return wantsVerify ? verifyInstance(latest.current, concept) : null
  }, [concept, wantsVerify, openVerify?.id, verifyCount, verifyPinned]) // eslint-disable-line react-hooks/exhaustive-deps

  // An open verification that can no longer be rebuilt (the generator changed)
  // is closed as invalid — never counted, never passed.
  useEffect(() => {
    if (verifyInst?.stale) L.closeAttempt(verifyInst.stale, 'invalidated')
  }, [verifyInst?.stale]) // eslint-disable-line react-hooks/exhaustive-deps

  const verifyAttempt = verifyPinned ? learner.attempts[verifyPinned] : openVerify
  const verifyJudgement = verifyAttempt ? learner.judgements.filter((j) => j.attemptId === verifyAttempt.id).at(-1) ?? null : null
  const choices = verifyAttempt ? learner.drafts[`verify:${verifyAttempt.id}`] ?? {} : {}

  // While an independent verification is open, every route to help asks first.
  useEffect(() => {
    bus.setGate(openVerify && !openVerify.converted
      ? { attemptId: openVerify.id, conceptId: cid, kind: 'verify', label: `「${concept.capability.title}」的独立验证` }
      : null)
    return () => bus.setGate(null)
  }, [openVerify?.id, openVerify?.converted, cid]) // eslint-disable-line react-hooks/exhaustive-deps

  const startVerify = () => {
    if (!verifyInst || verifyInst.unavailable || verifyInst.resumed) return
    L.startAttempt({
      id: newId('att'), conceptId: cid, taskId: 'verify', taskVersion: concept.verify.version, activity: 'verify',
      instanceKey: verifyInst.instanceKey, capability: concept.capability.id, resources: 'independent',
      items: verifyInst.seeds, parts: verifyInst.parts, label: `独立验证：${concept.capability.title}`,
    })
    L.event({ conceptId: cid, object: 'verify', action: 'start' })
    bus.setFocus('verify')
    setMode(null)
  }

  // --- the lab -------------------------------------------------------------------------

  const busRef = useRef(bus)
  busRef.current = bus
  const labStepKey = (obs) => obs.detail?.labStep ?? 'judgement'
  const handleLabEvidence = useCallback((obs) => {
    if (obs.kind === 'labExplore' || obs.kind === 'labEvent') {
      L.event({ conceptId: cid, object: 'lab', action: 'explore', detail: { labStep: labStepKey(obs), description: obs.description ?? null } })
      return
    }
    if (obs.kind !== 'labAction') return
    const step = labStepKey(obs)
    const instanceKey = labInstanceKey(cid, concept.lab.type, step)
    const catalogue = (concept.misconceptions ?? []).map((m) => m.id)
    const mis = catalogue.includes(obs.misconceptionId) ? obs.misconceptionId : null
    L.judgeIn(
      { conceptId: cid, taskId: `lab:${step}`, taskVersion: course.version, activity: 'lab', instanceKey, capability: concept.capability?.id, label: `实验：${step}` },
      {
        id: newId('lab'), kind: 'labAction', correct: Boolean(obs.correct), misconceptionId: obs.correct ? null : mis,
        targets: (obs.targets ?? (obs.misconceptionId ? [obs.misconceptionId] : [])).filter((t) => catalogue.includes(t)),
        answer: obs.detail ?? null, grading: { method: 'algorithm', version: course.version },
        reveals: true, detail: { label: `实验里的判断：${obs.description ?? step}` },
      },
    )
    if (!obs.correct && obs.facts?.length) {
      const belief = (concept.misconceptions ?? []).find((m) => m.id === mis)?.belief
      busRef.current.raiseAlert({
        kind: 'lab', object: 'lab', attemptKey: instanceKey, facts: obs.facts, description: obs.description, retry: Boolean(obs.retry),
        contextKey: `${cid}:lab`, contextLabel: '本步实验',
        fallback: belief
          ? `你可能是这样想的：「${belief}」。对照实验里刚显示的结果，看看这个想法哪里站不住。`
          : '对照实验里刚显示的结果，看看它和你的判断差在哪一步。',
      })
    }
  }, [cid, concept, course.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleWrong = useCallback((info) => {
    const { check } = info
    const misId = (info.choice !== undefined ? check.options?.[info.choice]?.misconception : null) ?? check.misconceptions?.[0]
    const belief = (concept.misconceptions ?? []).find((m) => m.id === misId)?.belief
    bus.raiseAlert({
      kind: 'check', object: `check:${check.id}`, checkId: check.id, choice: info.choice, verdict: info.verdict,
      feedback: info.feedback, attemptKey: guided?.instanceKey,
      // The alert belongs to this question's task, whatever the panel's focus
      // was a moment ago: the click that answered it also moved the focus.
      contextKey: guidedAttempt ? `${cid}:${guided.activity}:${guided.taskId}:${guidedAttempt.id}` : null,
      contextLabel: guided ? `${guided.activity === 'practice' ? '练习题' : '课程题'}「${guided.check.prompt.slice(0, 20)}…」` : null,
      fallback: belief
        ? `你可能是这样想的：「${belief}」。对照上面的讲解想一想，这个想法哪里站不住。`
        : '回到上面讲解里的「例子」和「形式化」两部分，对照题目里的条件再看一遍。',
    })
  }, [concept, bus, guided?.instanceKey, guidedAttempt?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- what the tutor can see, and which task is in focus ------------------------------------

  const focus = bus.focus
  const labAttemptIds = Object.values(learner.attempts).filter((a) => a.conceptId === cid && a.activity === 'lab').map((a) => a.id)
  const task = useMemo(() => {
    const capInfo = { capability: concept.capability?.title ?? null, capabilityStatus: cap.label }
    if (focus === 'verify' && verifyAttempt) {
      return { key: `${cid}:verify:${verifyAttempt.id}`, label: `独立验证：${concept.capability.title}`, activity: 'verify', attemptIds: [verifyAttempt.id], object: 'verify', ...capInfo,
        attempt: verifyAttempt.converted ? '已转为辅助练习' : verifyAttempt.status === 'open' ? '独立进行中' : '已提交' }
    }
    if (focus === 'check' && guided && guidedAttempt) {
      return { key: `${cid}:${guided.activity}:${guided.taskId}:${guidedAttempt.id}`, label: `${guided.activity === 'practice' ? '练习题' : '课程题'}「${guided.check.prompt.slice(0, 20)}…」`,
        activity: guided.activity, attemptIds: [guidedAttempt.id], object: `check:${guided.check.id}`, ...capInfo,
        attempt: `第 ${guidedAttempt.ordinal} 次做这道题${guidedAttempt.assisted ? '，已经用过帮助' : ''}` }
    }
    if (focus === 'lab') return { key: `${cid}:lab`, label: '本步实验', activity: 'lab', attemptIds: labAttemptIds, object: 'lab', ...capInfo }
    return { key: `${cid}:explain`, label: '讲解', activity: 'explain', attemptIds: [], object: 'explain', ...capInfo }
  }, [focus, cid, verifyAttempt?.id, verifyAttempt?.converted, verifyAttempt?.status, guided?.instanceKey, guidedAttempt?.id, guidedAttempt?.assisted, labAttemptIds.join(','), cap.label]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bus.setTask(task) }, [task]) // eslint-disable-line react-hooks/exhaustive-deps

  // The verification is visible to the tutor only once it has become practice.
  const verifyScreen = verifyAttempt?.converted && verifyInst?.items ? verifyInst.items[0] : null
  useEffect(() => {
    if (focus !== 'verify') return
    bus.reportCheck(verifyScreen
      ? { checkId: verifyScreen.id, kind: 'mcq', prompt: verifyScreen.prompt, table: verifyScreen.table ? [verifyScreen.table.columns.join(' | '), ...verifyScreen.table.rows.map((r) => r.join(' | '))] : null, diagram: verifyScreen.diagram ?? null, eliminated: [], draft: '' }
      : null)
  }, [focus, verifyScreen?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- layout -------------------------------------------------------------------------------

  const passed = (concept.checks?.length ?? 0) - openChecks(learner, concept).length
  const phaseKey = { explain: 'explain', lab: 'lab', check: 'checks', remediate: 'checks', practice: 'checks', verify: 'verify', done: 'done' }[action.type]
  const phases = [
    { key: 'explain', label: '讲解', done: state.seenExplain, target: 'explain' },
    ...(concept.lab ? [{ key: 'lab', label: '实验', done: labAttempted(learner, cid), target: 'lab' }] : []),
    { key: 'checks', label: `课程题 ${passed}/${concept.checks?.length ?? 0}`, done: open.length === 0, target: 'guided' },
    ...(concept.verify ? [{ key: 'verify', label: '独立验证', done: cap.status === 'verified' || cap.status === 'transfer', target: 'verify' }] : []),
  ].map((p) => ({ ...p, current: p.key === phaseKey }))
  const target = { explain: 'explain', lab: 'lab', check: 'guided', remediate: 'guided', practice: 'guided', verify: 'verify' }[action.type]
  const nextStep = course.concepts.find((c) => c.id === action.next) ?? null

  const shownAction = {
    ...action,
    target,
    targetLabel: { lab: '去做实验', verify: '去验证', explain: '去读讲解' }[action.type] ?? '去做题',
    basis: [action.basis, pending.length ? `${pending.length} 道课程题还在等批改，不影响往下走` : null].filter(Boolean).join('；') || null,
  }

  const continueGuided = () => {
    setPinned(null)
    setMode((m) => (m?.kind === 'check' ? null : m))
    setRound((r) => r + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <TaskBar course={course} concept={concept} index={idx} cap={cap} phases={phases} action={shownAction}
               onGo={(t) => showObject(t)} onOpenProfile={() => bus.openProfile(cid)}
               suggestFirst={L.suggestedFirstOf(cid)} onNavigate={onNavigate} />

      <div onPointerDownCapture={() => bus.setFocus('explain')}>
        <Explanation concept={concept} open={openLayers} onToggle={toggleLayer} suggested={scaffold} />
      </div>

      {action.type !== 'remediate' && L.misconceptionsOf(cid).filter((m) => m.status === 'supported').map((m) => {
        const detail = (concept.misconceptions ?? []).find((x) => x.id === m.id)
        return detail && (
          <Feedback key={m.id} tone="warn" title="有证据支持的误解（还需要一道新题确认它已澄清）">
            你可能以为：<b>{detail.belief}</b>
            <div style={{ marginTop: 8 }}>{detail.correction}</div>
          </Feedback>
        )
      })}

      {action.type === 'remediate' && action.misconception && (
        <Feedback tone="warn" title="先把这个理清楚">
          你可能以为：<b>{action.misconception.belief}</b>
          <div style={{ marginTop: 8 }}>{action.misconception.correction}</div>
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>下面这道题用来确认它是否已经澄清。</div>
        </Feedback>
      )}

      {Lab && (
        <section data-testid="lab" data-object="lab" aria-label="动手实验"
                 onPointerDownCapture={() => bus.setFocus('lab')} onFocusCapture={() => bus.setFocus('lab')}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>动手实验 · 数字都来自本页的真实计算（JavaScript 实现的 CART / ID3）</div>
          <Lab key={cid} config={concept.lab.config} onEvidence={handleLabEvidence} onScreen={bus.reportLab} />
          {inlineFor('lab') && (
            <div data-testid="inline-tutor-lab" className="panel" style={{ marginTop: 10, padding: '10px 14px', fontSize: 13, lineHeight: 1.85 }}>
              <span style={{ fontWeight: 500, color: 'var(--brand)' }}>AI 老师：</span>
              {inlineFor('lab').error ?? (inlineFor('lab').text || <span className="streaming" />)}
            </div>
          )}
        </section>
      )}

      {guided && (
        <section data-object="guided" aria-label="题目" onPointerDownCapture={() => bus.setFocus('check')} onFocusCapture={() => bus.setFocus('check')}>
          <CheckCard
            // Keyed by which attempt this is, not by its id: the card must not
            // remount (and drop what is being typed) when the attempt record is
            // created a moment after the question appears.
            key={`${guided.instanceKey}:${guidedAttempt?.status === 'open' || !guidedAttempt ? (guidedAttempt?.ordinal ?? Object.values(learner.attempts).filter((a) => a.instanceKey === guided.instanceKey).length + 1) : guidedAttempt.ordinal}`}
            course={course}
            concept={concept}
            check={guided.check}
            attempt={guidedAttempt}
            history={guidedHistory}
            draft={guidedAttempt ? learner.drafts[`check:${guidedAttempt.id}`] : ''}
            onDraft={(t) => guidedAttempt && L.draft(`check:${guidedAttempt.id}`, t)}
            learnerState={bus.learnerState}
            misconceptionHistory={bus.misconceptionHistory}
            screen={bus.screenPayload}
            onJudge={(j) => guidedAttempt && L.judge({ ...j, attemptId: guidedAttempt.id })}
            onScreen={bus.reportCheck}
            onAnswered={() => setPinned({ ...guided, conceptId: cid })}
            onWrong={handleWrong}
            onContinue={continueGuided}
            inline={inlineFor(`check:${guided.check.id}`)}
            contextKey={guidedAttempt ? `${cid}:${guided.activity}:${guided.taskId}:${guidedAttempt.id}` : null} />
          {action.type === 'practice' && action.offerVerify && !pinned && concept.verify && (
            <div style={{ marginTop: 8 }}>
              <Button variant="quiet" style={{ height: 32, fontSize: 12.5 }} onClick={() => setMode('verify')}>我有把握了，直接开始独立验证</Button>
            </div>
          )}
        </section>
      )}

      {pending.length > 0 && !guided && (
        <Feedback tone="neutral" title="等待批改的课程题">
          {pending.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <span style={{ flex: 1 }}>「{c.prompt.slice(0, 30)}…」上次没能批改（未评定），不影响往下走。</span>
              <Button variant="quiet" style={{ height: 28, fontSize: 12 }} onClick={() => setMode({ kind: 'check', id: c.id })}>重新提交</Button>
            </div>
          ))}
        </Feedback>
      )}

      {(wantsVerify || verifyPinned) && verifyInst && (
        <section aria-label="独立验证" onPointerDownCapture={() => bus.setFocus('verify')} onFocusCapture={() => bus.setFocus('verify')}>
          <VerifyCard
            concept={concept}
            instance={verifyInst}
            attempt={verifyAttempt}
            judgement={verifyJudgement}
            choices={choices}
            onChoose={(i, k) => {
              L.draft(`verify:${verifyAttempt.id}`, { ...choices, [i]: k })
              L.event({ conceptId: cid, object: 'verify', action: 'choose', attemptId: verifyAttempt.id, detail: { item: i } })
            }}
            onStart={startVerify}
            onSubmit={(j) => {
              L.judge({ ...j, attemptId: verifyAttempt.id })
              setVerifyPinned(verifyAttempt.id)
            }}
            onContinue={() => { setVerifyPinned(null); setMode(null); setRound((r) => r + 1) }}
            onPracticeFirst={concept.practice && !openVerify ? () => setMode('practice') : null} />
        </section>
      )}

      {done && !verifyPinned && !pinned && mode !== 'practice' && (
        <Feedback tone="ok" title={concept.verify ? `✓ 已通过独立验证：${concept.capability.title}` : `「${concept.title}」的引导学习完成了`}>
          {concept.verify
            ? '这项能力有了独立证据。可以继续下一步，也可以留下来再练（练习不会改变这个结论）。'
            : '本步没有配置独立验证，所以这里不给「已验证」标记。'}
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            {nextStep && <Button variant="primary" onClick={() => onNavigate(nextStep.id)}>进入「{nextStep.title}」</Button>}
            {!nextStep && course.project && <Button variant="primary" onClick={() => onNavigate(course.project.id)}>去结课项目</Button>}
            {concept.practice && <Button variant="quiet" onClick={() => setMode('practice')}>再练一道（可选）</Button>}
          </div>
        </Feedback>
      )}
    </div>
  )
}
