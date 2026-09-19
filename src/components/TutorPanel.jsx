/**
 * The AI tutor panel.
 *
 * Its behaviour follows one rule: speak up when the learner has demonstrably
 * gone wrong, stay out of the way otherwise. The deterministic layer decides
 * "demonstrably" — a lab action scored incorrect, or a graded answer carrying a
 * misconception — and only then does this panel push. Everything else is pull:
 * a hint button, suggested questions, a free-text box.
 *
 * The panel never blocks. Lab feedback has already appeared in the main column
 * by the time a request starts here, because the maths is instant and the model
 * takes three to eight seconds. What arrives here is the "why", late and
 * optional, never the verdict.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { askTutor, requestHint, diagnose, checkHint } from '../api.js'

const STATUS = {
  idle: { label: '待命', dot: 'var(--muted-faint)' },
  working: { label: '正在想', dot: 'var(--brand)' },
  alert: { label: '发现一个问题', dot: 'var(--warn)' },
}

/** Label over a tutor message, by what prompted it. */
const TAG_LABEL = {
  'alert-check': '关于你刚才那道题',
  'alert-lab': '关于你刚才那一步',
  hint: '提示',
  answer: null,
}

let nextId = 0
const newId = () => `m${++nextId}`

export default function TutorPanel({
  course, concept, learnerState, misconceptionHistory, alert, onAlertHandled, attemptsInStep, labState,
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
  }), [course.id, concept.id, learnerState, misconceptionHistory])
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

  // Switching concepts starts a fresh conversation — a hint about the previous
  // step would be actively confusing next to a different lab.
  useEffect(() => {
    cancel()
    setMessages([])
  }, [concept.id, cancel])

  useEffect(() => () => activeRef.current?.ac.abort(), [])

  /**
   * A mistake the deterministic layer detected — a lab action scored wrong, or a
   * wrong answer to a check. This is the only path that speaks without the
   * learner asking.
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
      : diagnose({ ...body, action: { facts: alert.facts, description: alert.description } }, ac.signal)

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

  const doHint = () => converse('给我一个提示', requestHint, { attemptsInStep, labState }, 'hint')

  const streaming = messages.some((m) => m.streaming)

  // One question at a time: a second question would cut off the answer to the
  // first and leave it hanging in the conversation with no reply.
  const doAsk = (q) => {
    const text = (q ?? question).trim()
    if (!text || streaming) return
    setQuestion('')
    converse(text, askTutor, { question: text }, 'answer')
  }

  const lastTutor = [...messages].reverse().find((m) => m.role === 'tutor')
  const status = streaming ? STATUS.working : lastTutor?.tag?.startsWith('alert') ? STATUS.alert : STATUS.idle
  // Authored per concept. Never the check prompts — offering a quiz question as
  // something to ask hands the learner the answer before they attempt it.
  // Ones already asked drop out; the answer is right there in the conversation.
  const asked = new Set(messages.filter((m) => m.role === 'user').map((m) => m.text))
  const suggestions = (concept.suggestions ?? []).filter((s) => !asked.has(s))

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
              我在旁边看着。你操作出问题的时候我会主动说，其余时候需要了再叫我。
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
          <TutorMessage key={m.id} m={m} onStop={cancel} />
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
function TutorMessage({ m, onStop }) {
  const alert = m.tag?.startsWith('alert')
  const label = TAG_LABEL[m.tag]
  return (
    <div className="fade-up" style={{
      background: alert ? 'var(--warn-bg)' : 'var(--bg)',
      border: `1px solid ${alert ? 'var(--warn-line)' : 'var(--border)'}`,
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
    </div>
  )
}
