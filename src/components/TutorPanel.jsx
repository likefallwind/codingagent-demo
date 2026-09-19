/**
 * The AI tutor panel.
 *
 * It sees what the learner sees: every request carries the lab's current
 * snapshot and the question being answered (see labs/screen.js), and the panel
 * says so in a line under its header, so the learner knows the tutor is looking
 * at the same thing they are.
 *
 * It speaks without being asked in four situations, all decided by the
 * deterministic layer rather than the model:
 *   - a mistake: a lab action scored wrong, or a wrong answer to a check;
 *   - a moment: the lab reports a notable state the learner has just reached;
 *   - a stall: no activity for a while after starting on the concept;
 *   - thrashing: a slider dragged back and forth without settling.
 * Only the first calls the model straight away. The others post a short,
 * deterministic remark with a button to ask for more, so the tutor never spends
 * a model call — or the learner's attention — on something they did not want.
 * "我自己先看" silences everything but mistakes for the rest of the concept.
 *
 * The panel never blocks. Lab feedback has already appeared in the main column
 * by the time a request starts here, because the maths is instant and the model
 * takes seconds. What arrives here is the "why", late and optional, never the
 * verdict.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { askTutor, requestHint, diagnose, checkHint } from '../api.js'

const STATUS = {
  idle: { label: '在看', dot: 'var(--ok)' },
  working: { label: '正在想', dot: 'var(--brand)' },
  alert: { label: '发现一个问题', dot: 'var(--warn)' },
}

/** Label over a tutor message, by what prompted it. */
const TAG_LABEL = {
  'alert-check': '关于你刚才那道题',
  'alert-lab': '关于你刚才那一步',
  nudge: '我注意到',
  hint: '提示',
  answer: null,
}

/** How long without activity counts as stuck. `?idle=5` (seconds) overrides it for testing. */
const IDLE_MS = (() => {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('idle'))
    return v > 0 ? v * 1000 : 60000
  } catch {
    return 60000
  }
})()
/** Minimum gap between unprompted remarks, so the panel never chatters. */
const NUDGE_GAP_MS = 40000
/** Moments are tied to something the learner just did, so they may come sooner. */
const MOMENT_GAP_MS = 8000

let nextId = 0
const newId = () => `m${++nextId}`

/** What the tutor is looking at, in one line for the header. */
function seeingLine(screen, concept) {
  if (screen?.focus === 'check' && screen.check) {
    const p = screen.check.prompt
    const out = screen.check.eliminated?.length ? `，已排除 ${screen.check.eliminated.length} 个选项` : ''
    return `在做题「${p.length > 18 ? `${p.slice(0, 18)}…` : p}」${out}`
  }
  if (screen?.focus === 'lab' && screen.lab?.doing) return screen.lab.doing
  return `在读「${concept.shortTitle ?? concept.title}」的讲解`
}

/** The part of the screen the server needs — moments are the panel's own business. */
function screenPayload(screen) {
  if (!screen) return null
  return {
    focus: screen.focus,
    doing: screen.lab?.doing ?? null,
    facts: screen.lab?.facts ?? [],
    check: screen.check ?? null,
  }
}

export default function TutorPanel({
  course, concept, learnerState, misconceptionHistory, mastered, screen, activity,
  alert, onAlertHandled, attemptsInStep,
}) {
  // The conversation for this concept. The learner's own questions are kept as
  // messages too, so every answer sits under the question it answers.
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  // The one request in flight, and the message it is writing into. Starting a
  // new request stops the old one — the tutor answers one thing at a time.
  const activeRef = useRef(null)
  const bodyRef = useRef(null)

  const baseBody = useCallback(() => ({
    courseId: course.id,
    conceptId: concept.id,
    learner: learnerState,
    misconceptionHistory,
    screen: screenPayload(screen),
  }), [course.id, concept.id, learnerState, misconceptionHistory, screen])
  // Read through a ref by the alert effect, so a mastery change mid-request does
  // not re-run it and post the same explanation twice.
  const baseRef = useRef(baseBody)
  baseRef.current = baseBody

  const patch = useCallback((id, fields) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fields } : m)))
  }, [])

  const push = (...ms) => setMessages((prev) => [...prev, ...ms])

  /** Stop the request in flight, keeping whatever it wrote and saying it stopped. */
  const cancel = useCallback(() => {
    const a = activeRef.current
    if (!a) return
    activeRef.current = null
    a.ac.abort()
    patch(a.id, { streaming: false, stopped: true })
  }, [patch])

  /** Open a tutor message and make it the one the next request writes into. */
  const begin = (tag) => {
    cancel()
    const ac = new AbortController()
    const id = newId()
    activeRef.current = { ac, id }
    return { ac, id, msg: { id, role: 'tutor', tag, text: '', streaming: true, error: null } }
  }

  const finish = (ac, id, fields = {}) => {
    if (activeRef.current?.ac !== ac) return
    activeRef.current = null
    patch(id, { streaming: false, ...fields })
  }

  // --- unprompted remarks -----------------------------------------------------
  const muted = useRef(new Set())
  const lastNudgeAt = useRef(0)
  const seenMoments = useRef(new Set())
  const pendingMoment = useRef(null)
  const idleNudgedAt = useRef(0)
  const masteredRef = useRef(mastered)
  masteredRef.current = mastered
  const screenRef = useRef(screen)
  screenRef.current = screen

  // Switching concepts starts a fresh conversation — a hint about the previous
  // step would be actively confusing next to a different lab.
  useEffect(() => {
    cancel()
    setMessages([])
    lastNudgeAt.current = 0
    idleNudgedAt.current = 0
    pendingMoment.current = null
  }, [concept.id, cancel])

  useEffect(() => () => activeRef.current?.ac.abort(), [])

  const mayNudge = (gap) => !muted.current.has(concept.id) && !masteredRef.current
    && !activeRef.current && Date.now() - lastNudgeAt.current > gap

  const nudge = (text, actions) => {
    lastNudgeAt.current = Date.now()
    push({ id: newId(), role: 'tutor', tag: 'nudge', text, actions, streaming: false, error: null })
  }

  // A notable state the lab just reported. Queued rather than posted outright:
  // it often arrives while the tutor is still answering something else, and a
  // moment dropped then would never come back.
  const moment = screen?.lab?.moment
  const postMoment = () => {
    const p = pendingMoment.current
    if (!p || !mayNudge(MOMENT_GAP_MS)) return false
    pendingMoment.current = null
    // Stale by now — the learner has moved on from whatever it was about.
    if (Date.now() - p.at > 60000) return false
    seenMoments.current.add(p.key)
    nudge(p.moment.text, [
      { label: p.moment.askLabel ?? '为什么会这样？', ask: p.moment.ask ?? '为什么会这样？' },
      { label: '我自己先看', mute: true },
    ])
    return true
  }
  useEffect(() => {
    if (!moment) return
    const key = `${concept.id}:${moment.id}`
    if (seenMoments.current.has(key) || pendingMoment.current?.key === key) return
    pendingMoment.current = { key, moment, at: Date.now() }
    postMoment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.id, concept.id])

  // Stalls and thrashing, read off the shell's activity record.
  useEffect(() => {
    const timer = setInterval(() => {
      if (postMoment()) return
      const a = activity?.current
      if (!a?.interacted || document.visibilityState !== 'visible') return
      const s = screenRef.current
      // Thrashing waits its turn behind whatever else the tutor is saying, so it
      // is judged by its own age, not by whether it came after the last remark.
      if (a.thrash && Date.now() - a.thrash.at > 30000) a.thrash = null
      if (a.thrash && mayNudge(MOMENT_GAP_MS)) {
        const label = a.thrash.label
        a.thrash = null
        nudge(`你在来回拖「${label}」。在找什么？我可以告诉你该盯着哪个数字看。`, [
          { label: '我该看哪里？', ask: `我在来回拖「${label}」，我该重点看界面上的哪个数字？` },
          { label: '我自己先看', mute: true },
        ])
        return
      }
      if (Date.now() - a.lastAt > IDLE_MS && idleNudgedAt.current < a.lastAt && mayNudge(NUDGE_GAP_MS)) {
        idleNudgedAt.current = Date.now()
        const onCheck = s?.focus === 'check' && s.check
        nudge(onCheck
          ? '这道题停了一会儿了。要不要一个提示？我不会直接说答案。'
          : `你在「${s?.lab?.doing ?? concept.title}」这里停了一会儿。卡住了吗？`, [
          { label: '给我一个提示', hint: true },
          { label: '我自己先想想', mute: true },
        ])
      }
    }, 1500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept.id, activity])

  /**
   * A mistake the deterministic layer detected — a lab action scored wrong, or a
   * wrong answer to a check. The one unprompted situation that calls the model
   * immediately: the learner has just been told they are wrong and deserves the
   * why without having to ask.
   */
  useEffect(() => {
    if (!alert) return
    const tag = alert.kind === 'check' ? 'alert-check' : 'alert-lab'

    // A graded written answer already carries the grader's explanation.
    if (alert.feedback) {
      cancel()
      push({ id: newId(), role: 'tutor', tag, text: alert.feedback, streaming: false, error: null })
      onAlertHandled?.()
      return
    }

    const { ac, id, msg } = begin(tag)
    push(msg)
    const body = baseRef.current()
    const request = alert.kind === 'check'
      ? checkHint({ ...body, checkId: alert.checkId, choice: alert.choice }, ac.signal)
      : diagnose({ ...body, action: { facts: alert.facts, description: alert.description, retry: alert.retry } }, ac.signal)

    request
      .then((res) => {
        finish(ac, id, { text: res.feedback })
        onAlertHandled?.(res)
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        // The main column already told the learner they were wrong; failing to
        // explain why is a degraded experience, not a broken one. Fall back to
        // the author's words where there are some.
        finish(ac, id, alert.fallback ? { text: alert.fallback } : { error: err.message })
      })
    // Only a new alert restarts this. Clearing the alert (onAlertHandled) must
    // not abort the answer that is still arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages])

  /** Post the learner's message, then stream the tutor's reply under it. */
  const converse = async (said, fn, extra, tag) => {
    const { ac, id, msg } = begin(tag)
    push({ id: newId(), role: 'user', text: said }, msg)
    try {
      await fn({ ...baseRef.current(), ...extra }, (t) => patch(id, { text: t }), ac.signal)
      finish(ac, id)
    } catch (err) {
      if (!ac.signal.aborted) finish(ac, id, { error: err.message })
    }
  }

  const doHint = () => converse('给我一个提示', requestHint, { attemptsInStep }, 'hint')

  const streaming = messages.some((m) => m.streaming)

  // One question at a time: a second question would cut off the answer to the
  // first and leave it hanging in the conversation with no reply.
  const doAsk = (q) => {
    const text = (q ?? question).trim()
    if (!text || streaming) return
    setQuestion('')
    converse(text, askTutor, { question: text }, 'answer')
  }

  /** A button under an unprompted remark. Every choice retires the buttons. */
  const takeAction = (m, a) => {
    patch(m.id, { actionsDone: true })
    if (a.mute) {
      muted.current.add(concept.id)
      return
    }
    if (a.hint) doHint()
    else if (a.ask) doAsk(a.ask)
  }

  const lastTutor = [...messages].reverse().find((m) => m.role === 'tutor')
  const status = streaming ? STATUS.working : lastTutor?.tag?.startsWith('alert') ? STATUS.alert : STATUS.idle
  // Authored per concept. Never the check prompts — offering a quiz question as
  // something to ask hands the learner the answer before they attempt it.
  // Ones already asked drop out; the answer is right there in the conversation.
  const asked = new Set(messages.filter((m) => m.role === 'user').map((m) => m.text))
  const suggestions = (concept.suggestions ?? []).filter((s) => !asked.has(s))
  const seeing = seeingLine(screen, concept)

  return (
    <aside style={{
      width: 292, flex: 'none', background: 'var(--panel)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px',
        borderBottom: '1px solid var(--border-faint)', flex: 'none',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: 'var(--brand-tint-3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="9.3" cy="11" r="1.2" fill="var(--brand)" stroke="none" />
            <circle cx="14.7" cy="11" r="1.2" fill="var(--brand)" stroke="none" />
            <path d="M9.5 15.2c1.6 1 3.4 1 5 0" />
          </svg>
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-strong)' }}>AI 老师</span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)',
          background: 'var(--bg)', borderRadius: 6, padding: '3px 7px',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.dot }} />
          {status.label}
        </span>
      </div>

      <div data-testid="tutor-sees" title={seeing} style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', flex: 'none',
        fontSize: 11.5, color: 'var(--muted)', borderBottom: '1px solid var(--border-faint)', background: '#fbfcfe',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" aria-hidden="true" style={{ flex: 'none' }}>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          看到你{seeing.startsWith('在') ? seeing : `在：${seeing}`}
        </span>
      </div>

      <div ref={bodyRef} className="scroll-y" style={{
        padding: 16, display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0,
      }}>
        {messages.length === 0 && (
          <div style={{ border: '1px dashed #d6dfee', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <svg viewBox="0 0 160 110" style={{ width: 104, opacity: 0.8 }} aria-hidden="true">
              <ellipse cx="80" cy="103" rx="30" ry="5" fill="#EDF1F9" />
              <path d="M80 20v-6" stroke="#8FB0EE" strokeWidth="3" />
              <circle cx="80" cy="11" r="4" fill="#5BC8E8" />
              <rect x="48" y="22" width="64" height="50" rx="20" fill="#E8EFFB" stroke="#B9CDEF" strokeWidth="2" />
              <rect x="57" y="32" width="46" height="30" rx="14" fill="#2B3E66" />
              <circle cx="70" cy="47" r="6" fill="#5BC8E8" />
              <circle cx="90" cy="47" r="6" fill="#5BC8E8" />
              <rect x="60" y="76" width="40" height="24" rx="10" fill="#DCE6F8" stroke="#B9CDEF" strokeWidth="2" />
            </svg>
            <div style={{ fontSize: 12.5, lineHeight: 1.8, color: 'var(--muted)', marginTop: 6, textWrap: 'pretty' }}>
              我在旁边看着你做的每一步。操作出了问题、卡住了、或者走到关键的地方，我会说一句；其余时候需要了再叫我。
            </div>
          </div>
        )}

        {messages.map((m) => (m.role === 'user' ? (
          <div key={m.id} className="fade-up" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{
              maxWidth: '86%', background: 'var(--brand)', color: '#fff', borderRadius: '12px 12px 4px 12px',
              padding: '9px 12px', fontSize: 13, lineHeight: 1.7, textWrap: 'pretty', whiteSpace: 'pre-wrap',
            }}>
              {m.text}
            </div>
          </div>
        ) : (
          <TutorMessage key={m.id} m={m} onStop={cancel} onAction={(a) => takeAction(m, a)} busy={streaming} />
        )))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: messages.length ? 4 : 0 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {messages.length ? '你还可以问' : '这一步你可能会问'}
          </div>
          {[{ text: '给我一个提示', onClick: doHint }, ...suggestions.map((s) => ({ text: s, onClick: () => doAsk(s) }))].map((s) => (
            <button key={s.text} onClick={s.onClick} disabled={streaming}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)',
                borderRadius: 9, padding: '9px 12px', fontSize: 12.5, color: 'var(--ink-mid)',
                background: '#fff', textAlign: 'left', opacity: streaming ? 0.5 : 1,
                cursor: streaming ? 'default' : 'pointer',
              }}>
              <span style={{ flex: 1, lineHeight: 1.5 }}>{s.text}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted-faint)"
                   strokeWidth="2.2" style={{ flex: 'none' }} aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 'none', padding: '10px 16px 12px', borderTop: '1px solid var(--border-faint)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e1e7f1',
          borderRadius: 11, padding: '11px 12px', background: '#fbfcfe',
        }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAsk() } }}
            placeholder={streaming ? 'AI 老师正在回答…' : '有其他问题随时问我…'}
            aria-label="向 AI 老师提问"
            style={{
              flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--ink-mid)',
            }} />
          <svg onClick={() => doAsk()} width="17" height="17" viewBox="0 0 24 24" fill="none"
               stroke="var(--brand)" strokeWidth="1.9"
               style={{ cursor: streaming ? 'default' : 'pointer', flex: 'none', opacity: streaming ? 0.35 : 1 }}
               role="button" aria-label="发送">
            <path d="M4 12l16-7-7 16-2.4-6.6L4 12Z" />
          </svg>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--muted-light)', marginTop: 7 }}>
          Enter 发送
        </div>
      </div>
    </aside>
  )
}

/** One tutor message: a label for what prompted it, then the text as it streams. */
function TutorMessage({ m, onStop, onAction, busy }) {
  const alert = m.tag?.startsWith('alert')
  const nudge = m.tag === 'nudge'
  const label = TAG_LABEL[m.tag]
  return (
    <div className="fade-up" data-tag={m.tag} data-streaming={m.streaming ? '1' : '0'} style={{
      background: alert ? 'var(--warn-bg)' : nudge ? 'var(--brand-tint)' : 'var(--bg)',
      border: `1px solid ${alert ? 'var(--warn-line)' : nudge ? 'var(--brand-line)' : 'var(--border)'}`,
      borderRadius: '12px 12px 12px 4px', padding: '11px 13px', maxWidth: '94%',
    }}>
      {(label || m.streaming) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {label && (
            <span style={{ fontSize: 12, fontWeight: 500, color: alert ? 'var(--warn)' : 'var(--brand)' }}>{label}</span>
          )}
          <span style={{ flex: 1 }} />
          {m.streaming && (
            <span onClick={onStop} style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>停止</span>
          )}
        </div>
      )}
      {m.error ? (
        <div style={{ fontSize: 13, lineHeight: 1.85, color: 'var(--bad)' }}>
          AI 老师没能回应（{m.error}）。这不影响你继续做实验——界面上的判断和数字都是本地算出来的。
        </div>
      ) : (
        <div className={m.streaming && !m.text ? 'streaming' : undefined}
             style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-mid)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>
          {m.text}
          {m.streaming && m.text ? <span className="streaming" /> : null}
          {m.stopped && (
            <span style={{ fontSize: 12, color: 'var(--muted-light)' }}>{m.text ? ' （已停止）' : '已停止回答。'}</span>
          )}
        </div>
      )}
      {m.actions && !m.actionsDone && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {m.actions.map((a, i) => (
            <button key={a.label} onClick={() => onAction(a)} disabled={busy && !a.mute}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8,
                border: `1px solid ${i === 0 ? 'var(--brand)' : 'var(--border)'}`,
                background: i === 0 ? 'var(--brand)' : '#fff', color: i === 0 ? '#fff' : 'var(--ink-soft)',
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
