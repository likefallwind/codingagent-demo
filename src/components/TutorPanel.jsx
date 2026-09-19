/**
 * The AI tutor panel.
 *
 * It sees what the learner sees — every request carries the task in focus, what
 * is on screen, earlier states of the same task, the learner's code and errors
 * in the project, and the help already given for this task — and a follow-up
 * question carries the conversation so far about that task.
 *
 * Every piece of help it shows is recorded with the attempts it touched, so an
 * answer given after a hint is never mistaken for independent work. Help comes
 * in levels: where to look, a question to think about, a contrasting example,
 * part of the steps, and — asked for explicitly — the full solution.
 *
 * It speaks unprompted only in narrow, deterministic situations, and never
 * claims to know that the learner is stuck or mistaken:
 *   - after a submitted mistake: an explanation of what the result shows;
 *   - a notable moment the lab reports: one sentence and an offer;
 *   - a long pause, or a slider moved back and forth: an invitation with
 *     "我在比较 / 继续自己想 / 需要提示" — nothing more.
 * All of it can be switched off ("主动提醒") and back on; questions still work.
 * During an independent verification it stays silent, and asking it for help
 * first asks whether to turn the verification into assisted practice.
 *
 * Replies belong to the task they were asked in. Changing task stops a reply in
 * flight, so a late answer can never appear as feedback on the new task.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { askTutor, requestHint, diagnose, checkHint } from '../api.js'
import { tutorPolicy, helpLevel } from '../engine/tutorPolicy.js'
import { newId } from '../engine/ids.js'
import { Toggle, Confirm, showObject } from './ui.jsx'

const POLICY = tutorPolicy()

const TAG_LABEL = {
  'alert-check': '关于你刚才那道题',
  'alert-lab': '关于你刚才那一步',
  nudge: '邀请',
  moment: '我注意到',
  hint: '提示',
  answer: null,
  note: null,
}

/** What the tutor is looking at, in one line for the header. */
function seeingLine(screen, task, concept) {
  if (task?.activity === 'verify') {
    return task.attempt === '独立进行中' ? '在做独立验证（我先不说话）' : task.attempt === '已提交' ? '在看独立验证的结果' : '在做已转为练习的验证题'
  }
  if (screen?.focus === 'project') return screen.doing || '在写项目代码'
  if (screen?.focus === 'check' && screen.check) {
    const p = screen.check.prompt
    const out = screen.check.eliminated?.length ? `，已排除 ${screen.check.eliminated.length} 个选项` : ''
    return `在做题「${p.length > 18 ? `${p.slice(0, 18)}…` : p}」${out}`
  }
  if (screen?.focus === 'lab' && screen.lab?.doing) return screen.lab.doing
  return `在读「${concept.shortTitle ?? concept.title}」的讲解`
}

export default function TutorPanel({
  course, concept, L, screen, screenPayload, task, alert, onAlertHandled, activity, requestHelp, gate,
  collapsed, onToggle, onInline, attemptIdFor, labAttemptIds, openGuidedIds = [], learnerState, misconceptionHistory,
}) {
  const learner = L.learner
  const proactive = learner.settings?.proactive !== false
  const [messages, setMessages] = useState(() => learner.conversations[concept.id] ?? [])
  const [question, setQuestion] = useState('')
  const [confirm, setConfirm] = useState(null)
  const activeRef = useRef(null)
  const bodyRef = useRef(null)
  const unread = useRef(0)
  const [, force] = useState(0)

  const taskRef = useRef(task)
  taskRef.current = task
  const screenRef = useRef(screen)
  screenRef.current = screen
  const gateRef = useRef(gate)
  gateRef.current = gate
  const proactiveRef = useRef(proactive)
  proactiveRef.current = proactive
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  /** The request body every call shares, built at call time so it reflects the screen now. */
  const baseBody = () => {
    const t = taskRef.current
    const helpSoFar = learner.help.filter((h) => h.contextKey === t?.key && h.level > 0)
      .slice(-6).map((h) => `${h.source === 'hint' ? `第 ${h.level} 级提示` : h.source}：${(h.text ?? '').slice(0, 60)}`)
    return {
      courseId: course.id,
      conceptId: concept.id,
      contextKey: t?.key ?? null,
      learner: learnerState,
      misconceptionHistory,
      screen: screenPayload(t, helpSoFar),
    }
  }

  const patch = useCallback((id, fields) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fields } : m)))
  }, [])
  const push = (...ms) => {
    setMessages((prev) => [...prev, ...ms])
    if (collapsed) { unread.current += ms.filter((m) => m.role === 'tutor').length; force((x) => x + 1) }
  }

  /** Stop the request in flight, keeping whatever it wrote and saying why it stopped. */
  const cancel = useCallback((why = null) => {
    const a = activeRef.current
    if (!a) return
    activeRef.current = null
    a.ac.abort()
    patch(a.id, { streaming: false, stopped: true, stopReason: why })
    if (a.object) onInline(a.object, null)
  }, [patch, onInline])

  /** Open a reply. It belongs to `extra.contextKey` when given (an alert about a specific question), else to the task in focus. */
  const begin = (tag, extra = {}) => {
    cancel()
    const ac = new AbortController()
    const id = newId('m')
    const t = taskRef.current
    const contextKey = extra.contextKey ?? t?.key
    const contextLabel = extra.contextLabel ?? t?.label
    // In the project, a reply is about one version of the code and its run.
    const resultVersion = screenRef.current?.focus === 'project' ? screenRef.current?.code?.version ?? null : null
    activeRef.current = { ac, id, contextKey, object: extra.object ?? null, resultVersion }
    return {
      ac, id,
      msg: { id, role: 'tutor', tag, text: '', streaming: true, error: null, contextKey, contextLabel, object: extra.object ?? t?.object ?? null, level: extra.level ?? null, resultVersion, ts: Date.now() },
    }
  }

  const finish = (ac, id, fields = {}) => {
    if (activeRef.current?.ac !== ac) return false
    activeRef.current = null
    patch(id, { streaming: false, ...fields })
    return true
  }

  // --- conversations belong to a step and survive a reload ------------------------------

  const loadedFor = useRef(concept.id)
  useEffect(() => {
    if (loadedFor.current === concept.id) return
    cancel('你换到了另一步')
    loadedFor.current = concept.id
    setMessages(learner.conversations[concept.id] ?? [])
  }, [concept.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messages.some((m) => m.streaming)) return undefined
    const t = setTimeout(() => L.conversation(concept.id, messages), 300)
    return () => clearTimeout(t)
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => activeRef.current?.ac.abort(), [])

  // A reply belongs to the task it was asked in: switching task stops it.
  useEffect(() => {
    const a = activeRef.current
    if (a && a.contextKey !== task?.key) cancel('你换到了别的任务，这条回答没有继续')
  }, [task?.key, cancel])

  useEffect(() => {
    if (!collapsed) { unread.current = 0; force((x) => x + 1) }
  }, [collapsed])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages])

  // --- recording help --------------------------------------------------------------------

  const record = (source, level, text, attemptIds, extra = {}) => {
    L.help({
      id: extra.id ?? newId('help'), conceptId: concept.id, source, level, text,
      attemptIds: [...new Set((attemptIds ?? []).filter(Boolean))],
      revealedAnswer: level >= 5, contextKey: extra.contextKey ?? taskRef.current?.key ?? null,
      policyVersion: POLICY.version, requested: Boolean(extra.requested),
      resultVersion: screenRef.current?.focus === 'project' ? screenRef.current?.code?.version ?? null : null,
    })
  }

  // --- unprompted remarks ------------------------------------------------------------------

  const muted = useRef(new Map())
  const lastNudgeAt = useRef(0)
  const seenMoments = useRef(new Set())
  const pendingMoment = useRef(null)
  const idleNudgedAt = useRef(0)

  const isMuted = (kind) => {
    const set = muted.current.get(taskRef.current?.key)
    return Boolean(set && (set.has('all') || set.has(kind)))
  }
  const mute = (kind) => {
    const k = taskRef.current?.key
    const set = muted.current.get(k) ?? new Set()
    set.add(kind)
    muted.current.set(k, set)
  }

  const mayNudge = (gap, kind) => proactiveRef.current && !gateRef.current && !isMuted(kind)
    && !activeRef.current && Date.now() - lastNudgeAt.current > gap

  const nudge = (text, actions, tag = 'nudge', level = 0) => {
    lastNudgeAt.current = Date.now()
    const t = taskRef.current
    push({ id: newId('m'), role: 'tutor', tag, text, actions, streaming: false, error: null, contextKey: t?.key, contextLabel: t?.label, object: t?.object, ts: Date.now() })
    record(tag === 'moment' ? 'moment' : 'nudge', level, text, level > 0 ? labAttemptIds : [])
  }

  const moment = screen?.lab?.moment
  const postMoment = () => {
    const p = pendingMoment.current
    if (!p || !mayNudge(POLICY.momentGapMs, 'moment')) return false
    pendingMoment.current = null
    if (Date.now() - p.at > POLICY.momentMaxAgeMs) return false
    seenMoments.current.add(p.key)
    nudge(p.moment.text, [
      { label: p.moment.askLabel ?? '为什么会这样？', ask: p.moment.ask ?? '为什么会这样？' },
      { label: '继续自己看', mute: 'moment' },
    ], 'moment', 1)
    return true
  }
  useEffect(() => {
    if (!moment) return
    const key = `${concept.id}:${moment.id}`
    if (seenMoments.current.has(key) || pendingMoment.current?.key === key) return
    pendingMoment.current = { key, moment, at: Date.now() }
    postMoment()
  }, [moment?.id, concept.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      if (postMoment()) return
      const a = activity?.current
      if (!a?.interacted || document.visibilityState !== 'visible') return
      if (a.thrash && Date.now() - a.thrash.at > 30000) a.thrash = null
      if (a.thrash && mayNudge(POLICY.momentGapMs, 'thrash')) {
        const label = a.thrash.label
        a.thrash = null
        nudge(`在比较「${label}」的几种取值吗？需要的话，我可以指出该盯着哪个数字。`, [
          { label: '我在比较', mute: 'thrash' },
          { label: '需要提示', hint: true },
        ])
        return
      }
      if (Date.now() - a.lastAt > POLICY.idleMs && idleNudgedAt.current < a.lastAt && mayNudge(POLICY.nudgeGapMs, 'idle')) {
        idleNudgedAt.current = Date.now()
        nudge('需要的话，我可以给一个提示——不会直接给答案。', [
          { label: '继续自己想', mute: 'idle' },
          { label: '需要提示', hint: true },
        ])
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [concept.id, activity]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- a submitted mistake ----------------------------------------------------------------------

  const explainAlert = (al) => {
    const tag = al.kind === 'check' ? 'alert-check' : 'alert-lab'
    const attemptIds = [attemptIdFor(al.attemptKey)]
    const t = taskRef.current
    const contextKey = al.contextKey ?? t?.key
    const contextLabel = al.contextLabel ?? t?.label
    if (al.feedback) {
      cancel()
      push({ id: newId('m'), role: 'tutor', tag, text: al.feedback, streaming: false, error: null, contextKey, contextLabel, object: al.object, ts: Date.now() })
      onInline(al.object, { text: al.feedback })
      record('grader-feedback', 1, al.feedback, attemptIds, { contextKey })
      return
    }
    const { ac, id, msg } = begin(tag, { object: al.object, level: 2, contextKey, contextLabel })
    push(msg)
    onInline(al.object, { text: '' })
    const body = baseBody()
    const request = al.kind === 'check'
      ? checkHint({ ...body, checkId: al.checkId, choice: al.choice }, ac.signal)
      : diagnose({ ...body, action: { facts: al.facts, description: al.description, retry: al.retry } }, ac.signal)
    request
      .then((res) => {
        if (!finish(ac, id, { text: res.feedback })) return
        onInline(al.object, { text: res.feedback })
        record(al.kind === 'check' ? 'check-hint' : 'diagnose', 2, res.feedback, attemptIds, { contextKey })
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        // The main column already showed the result; failing to explain why is
        // a degraded experience, not a broken one. Fall back to authored words.
        finish(ac, id, al.fallback ? { text: al.fallback, fallback: true } : { error: err.message })
        onInline(al.object, al.fallback ? { text: al.fallback } : { error: `AI 老师暂时没能解释（${err.message}）` })
        if (al.fallback) record(al.kind === 'check' ? 'check-hint' : 'diagnose', 1, al.fallback, attemptIds, { contextKey })
      })
  }

  useEffect(() => {
    if (!alert) return
    onAlertHandled?.()
    // No unprompted help during an independent verification.
    if (gateRef.current) return
    if (!proactiveRef.current) {
      const t = taskRef.current
      push({
        id: newId('m'), role: 'tutor', tag: 'note', streaming: false, error: null, contextKey: alert.contextKey ?? t?.key, contextLabel: alert.contextLabel ?? t?.label, object: alert.object, ts: Date.now(),
        text: '刚才的结果和你的判断不一样。主动提醒关着，所以我没有自己开口；需要的话点下面。',
        actions: [{ label: '解释一下', alert }],
      })
      return
    }
    explainAlert(alert)
  }, [alert]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- asking -------------------------------------------------------------------------------------

  const historyFor = (key) => messagesRef.current
    .filter((m) => m.contextKey === key && (m.role === 'user' || (m.role === 'tutor' && m.text && !m.error && m.tag !== 'nudge' && m.tag !== 'note')))
    .slice(-POLICY.historyTurns * 2)
    .map((m) => ({ role: m.role, text: m.text }))

  /**
   * Ask the model on the learner's request. The help is recorded against the
   * task in focus, any question open on the page (it may well be used there),
   * and any independent attempt the learner just agreed to turn into practice.
   */
  const converse = async (said, fn, extra, tag, helpSource, level) => {
    const ok = await requestHelp('tutor')
    if (!ok) return
    const touched = [...openGuidedIds, ...(ok.converted ?? [])]
    const t = taskRef.current
    const history = historyFor(t?.key)
    const { ac, id, msg } = begin(tag, { level })
    push({ id: newId('m'), role: 'user', text: said, contextKey: t?.key, contextLabel: t?.label, ts: Date.now() }, msg)
    let text = ''
    try {
      text = await fn({ ...baseBody(), history, ...extra }, (x) => { text = x; patch(id, { text: x }) }, ac.signal)
      if (finish(ac, id)) record(helpSource, level, text, [...(t?.attemptIds ?? []), ...touched], { requested: true, contextKey: t?.key })
    } catch (err) {
      if (!ac.signal.aborted) finish(ac, id, { error: err.message })
      // Stopped part-way: whatever was shown is still help the learner saw.
      else if (text) record(helpSource, level, text, [...(t?.attemptIds ?? []), ...touched], { requested: true, contextKey: t?.key })
    }
  }

  const streaming = messages.some((m) => m.streaming)
  const key = task?.key
  const hintsHere = messages.filter((m) => m.contextKey === key && m.tag === 'hint' && !m.error).length
  const nextLevel = Math.min(5, hintsHere + 1)

  const doHint = (level = nextLevel) => {
    const lv = helpLevel(level)
    const go = () => converse(lv.level === 1 ? '给我一个提示' : `${lv.ask}（第 ${lv.level} 级：${lv.label}）`, requestHint, { level: lv.level }, 'hint', 'hint', lv.level)
    if (lv.level === 5) {
      setConfirm({
        title: '直接看完整解法？',
        body: '看完整解法之后，这道题会记为「辅助完成」，不算独立答对。之后要验证这项能力，还需要在没见过的新题上独立完成。',
        confirmLabel: '看解法',
        onConfirm: () => { setConfirm(null); go() },
      })
      return
    }
    go()
  }

  const doAsk = (q) => {
    const text = (q ?? question).trim()
    if (!text || streaming) return
    setQuestion('')
    converse(text, askTutor, { question: text }, 'answer', 'ask', 2)
  }

  /** A button under an unprompted remark. Every choice retires the buttons and is recorded. */
  const takeAction = (m, a) => {
    patch(m.id, { actionsDone: true })
    L.event({ conceptId: concept.id, object: 'tutor', action: a.mute ? `dismiss:${a.mute}` : a.hint ? 'accept-hint' : a.ask ? 'accept-ask' : 'accept-explain', detail: { label: a.label, message: m.tag } })
    if (a.mute) { mute(a.mute); return }
    if (a.hint) doHint()
    else if (a.ask) doAsk(a.ask)
    else if (a.alert) explainAlert(a.alert)
  }

  const setProactive = (v) => {
    L.setting('proactive', v)
    L.event({ conceptId: concept.id, object: 'tutor', action: v ? 'proactive-on' : 'proactive-off' })
  }

  const lastTutor = [...messages].reverse().find((m) => m.role === 'tutor')
  const status = gate ? { label: '独立验证中，暂不提示', dot: 'var(--muted)' }
    : streaming ? { label: '正在想', dot: 'var(--brand)' }
      : lastTutor?.tag?.startsWith('alert') ? { label: '看到一个问题', dot: 'var(--warn)' } : { label: '在看', dot: 'var(--ok)' }
  const asked = new Set(messages.filter((m) => m.role === 'user').map((m) => m.text))
  const suggestions = (concept.suggestions ?? []).filter((s) => !asked.has(s))
  const seeing = seeingLine(screen, task, concept)

  if (collapsed) {
    return (
      <aside aria-label="AI 老师（已收起）" style={{
        width: 48, flex: 'none', background: 'var(--panel)', borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10, gap: 8,
      }}>
        <button onClick={onToggle} data-testid="tutor-expand" aria-label={`展开 AI 老师${unread.current ? `，${unread.current} 条新消息` : ''}`}
                title="展开 AI 老师" style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid var(--brand-line)', background: 'var(--brand-tint)', color: 'var(--brand)', fontSize: 12, position: 'relative' }}>
          AI
          {unread.current > 0 && <span aria-hidden="true" style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--warn)', color: '#fff', fontSize: 10, lineHeight: '16px' }}>{unread.current}</span>}
        </button>
        <span style={{ writingMode: 'vertical-rl', fontSize: 12, color: 'var(--muted)', letterSpacing: 2 }}>AI 老师</span>
      </aside>
    )
  }

  return (
    <aside aria-label="AI 老师" data-testid="tutor" style={{
      width: 300, flex: 'none', background: 'var(--panel)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border-faint)', flex: 'none', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-strong)' }}>AI 老师</span>
        <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)', background: 'var(--bg)', borderRadius: 6, padding: '3px 7px' }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: status.dot }} />
          {status.label}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onToggle} data-testid="tutor-collapse" aria-label="收起 AI 老师" title="收起（对话和任务状态都会保留）"
                style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--muted)', fontSize: 13 }}>»</button>
        <div style={{ width: '100%' }}>
          <Toggle checked={proactive} onChange={setProactive} label="主动提醒"
                  hint="关掉后，我不会自己开口（邀请、关键时刻、答错后的解释）；你随时可以提问，界面上的对错和运行状态照常显示。" />
        </div>
      </div>

      <div data-testid="tutor-sees" title={seeing} style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', flex: 'none',
        fontSize: 11.5, color: 'var(--muted)', borderBottom: '1px solid var(--border-faint)', background: '#fbfcfe',
      }}>
        <span aria-hidden="true">👁</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>看到你{seeing.startsWith('在') ? seeing : `在：${seeing}`}</span>
      </div>

      <div ref={bodyRef} className="scroll-y" aria-live="polite" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
        {messages.length === 0 && (
          <div style={{ border: '1px dashed #d6dfee', borderRadius: 12, padding: 14, fontSize: 12.5, lineHeight: 1.8, color: 'var(--muted)', textWrap: 'pretty' }}>
            我看得到你在做的实验、题目和代码。你提交的判断和结果不一致时，我会解释；停下来很久或来回调参时，我只会问一句要不要帮忙。
            任何时候都可以问我。帮助会记在这道题上——用过提示的作答算辅助完成。
          </div>
        )}

        {messages.map((m) => (m.role === 'user' ? (
          <div key={m.id} className="fade-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            {m.contextKey !== key && m.contextLabel && <span style={{ fontSize: 11, color: 'var(--muted-light)', marginBottom: 2 }}>关于：{m.contextLabel}</span>}
            <div style={{
              maxWidth: '88%', background: 'var(--brand)', color: '#fff', borderRadius: '12px 12px 4px 12px',
              padding: '8px 12px', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap',
            }}>{m.text}</div>
          </div>
        ) : (
          <TutorMessage key={m.id} m={m} current={m.contextKey === key} onStop={() => cancel()} onAction={(a) => takeAction(m, a)} busy={streaming} />
        )))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: messages.length ? 4 : 0 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{gate ? '独立验证进行中：请求帮助前我会先问你一句' : messages.length ? '你还可以' : '这一步你可能会问'}</div>
          <HelpButton onClick={() => doHint()} disabled={streaming} testid="hint"
            text={hintsHere === 0 ? '给我一个提示' : nextLevel < 5 ? `${helpLevel(nextLevel).ask}（第 ${nextLevel} 级：${helpLevel(nextLevel).label}）` : '直接讲解法（第 5 级，记为辅助完成）'} />
          {suggestions.map((s) => <HelpButton key={s} text={s} onClick={() => doAsk(s)} disabled={streaming} />)}
        </div>
      </div>

      <div style={{ flex: 'none', padding: '10px 14px 12px', borderTop: '1px solid var(--border-faint)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e1e7f1', borderRadius: 11, padding: '9px 11px', background: '#fbfcfe' }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); doAsk() } }}
            placeholder={streaming ? 'AI 老师正在回答…' : '有问题随时问我…'}
            aria-label="向 AI 老师提问"
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--ink-mid)' }} />
          <button onClick={() => doAsk()} disabled={streaming || !question.trim()} aria-label="发送"
                  style={{ border: 'none', background: 'none', color: 'var(--brand)', opacity: streaming || !question.trim() ? 0.35 : 1, fontSize: 14 }}>➤</button>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted-light)', marginTop: 6 }}>Enter 发送 · 提醒策略 {POLICY.version}</div>
      </div>

      <Confirm open={Boolean(confirm)} title={confirm?.title} confirmLabel={confirm?.confirmLabel}
               onConfirm={confirm?.onConfirm} onCancel={() => setConfirm(null)}>{confirm?.body}</Confirm>
    </aside>
  )
}

function HelpButton({ text, onClick, disabled, testid }) {
  return (
    <button onClick={onClick} disabled={disabled} data-testid={testid}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px',
        fontSize: 12.5, color: 'var(--ink-mid)', background: '#fff', textAlign: 'left', opacity: disabled ? 0.5 : 1,
      }}>
      <span style={{ flex: 1, lineHeight: 1.5 }}>{text}</span>
      <span aria-hidden="true" style={{ color: 'var(--muted-faint)' }}>›</span>
    </button>
  )
}

/** One tutor message: what prompted it, which task it is about, the text, and a link to the object. */
function TutorMessage({ m, current, onStop, onAction, busy }) {
  const alert = m.tag?.startsWith('alert')
  const invite = m.tag === 'nudge' || m.tag === 'moment' || m.tag === 'note'
  const label = m.tag === 'hint' && m.level ? `第 ${m.level} 级提示 · ${helpLevel(m.level).label}` : TAG_LABEL[m.tag]
  const showHeader = label || m.streaming || !current || m.resultVersion
  return (
    <div className="fade-up" data-tag={m.tag} data-streaming={m.streaming ? '1' : '0'} data-context={m.contextKey ?? ''} style={{
      background: alert ? 'var(--warn-bg)' : invite ? 'var(--brand-tint)' : 'var(--bg)',
      border: `1px solid ${alert ? 'var(--warn-line)' : invite ? 'var(--brand-line)' : 'var(--border)'}`,
      borderRadius: '12px 12px 12px 4px', padding: '10px 12px', maxWidth: '96%', opacity: current ? 1 : 0.8,
    }}>
      {showHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
          {label && <span style={{ fontSize: 12, fontWeight: 500, color: alert ? 'var(--warn)' : 'var(--brand)' }}>{label}</span>}
          {!current && m.contextLabel && <span style={{ fontSize: 11, color: 'var(--muted-light)' }}>关于之前的任务：{m.contextLabel}</span>}
          {m.resultVersion && <span style={{ fontSize: 11, color: 'var(--muted-light)' }}>针对代码 {m.resultVersion}</span>}
          <span style={{ flex: 1 }} />
          {m.streaming && <button onClick={onStop} style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none' }}>停止</button>}
        </div>
      )}
      {m.error ? (
        <div style={{ fontSize: 13, lineHeight: 1.85, color: 'var(--bad)' }}>
          AI 老师没能回应（{m.error}）。这不影响你继续——界面上的判断、数字和代码运行都在本地完成。
        </div>
      ) : (
        <div className={m.streaming && !m.text ? 'streaming' : undefined}
             style={{ fontSize: 13.5, lineHeight: 1.85, color: 'var(--ink-mid)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>
          {m.text}
          {m.stopped && (
            <span style={{ fontSize: 12, color: 'var(--muted-light)' }}>{m.text ? ' ' : ''}（{m.stopReason ?? '已停止'}）</span>
          )}
        </div>
      )}
      {m.object && current && !m.streaming && (
        <button onClick={() => showObject(m.object)} style={{ marginTop: 6, fontSize: 12, color: 'var(--brand)', background: 'none', border: 'none', padding: 0 }}>
          查看相关对象 ↗
        </button>
      )}
      {m.actions && !m.actionsDone && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {m.actions.map((a, i) => (
            <button key={a.label} onClick={() => onAction(a)} disabled={busy && !a.mute}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8,
                border: `1px solid ${i === m.actions.length - 1 && !a.mute ? 'var(--brand)' : 'var(--border)'}`,
                background: i === m.actions.length - 1 && !a.mute ? 'var(--brand)' : '#fff',
                color: i === m.actions.length - 1 && !a.mute ? '#fff' : 'var(--ink-soft)',
                opacity: busy && !a.mute ? 0.5 : 1,
              }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
