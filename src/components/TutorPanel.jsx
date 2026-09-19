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
import { askTutor, requestHint, diagnose } from '../api.js'
import { Button } from './ui.jsx'

const STATUS = {
  idle: { label: '待命', dot: 'var(--muted-faint)' },
  working: { label: '正在想', dot: 'var(--brand)' },
  alert: { label: '发现一个问题', dot: 'var(--warn)' },
}

export default function TutorPanel({
  course, concept, learnerState, misconceptionHistory, alert, onAlertHandled, attemptsInStep, labState,
}) {
  const [mode, setMode] = useState('idle') // idle | hint | ask | alert
  const [text, setText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState(null)
  const [question, setQuestion] = useState('')
  const abortRef = useRef(null)
  const bodyRef = useRef(null)

  const baseBody = useCallback(() => ({
    courseId: course.id,
    conceptId: concept.id,
    learner: learnerState,
    misconceptionHistory,
  }), [course.id, concept.id, learnerState, misconceptionHistory])

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  // Switching concepts resets the panel — a hint about the previous step would
  // be actively confusing next to a different lab.
  useEffect(() => {
    cancel()
    setMode('idle')
    setText('')
    setError(null)
  }, [concept.id])

  useEffect(() => () => abortRef.current?.abort(), [])

  /**
   * A mistake the deterministic layer detected. This is the only path that opens
   * the panel without the learner asking.
   */
  useEffect(() => {
    if (!alert) return
    let cancelled = false
    const ac = new AbortController()
    abortRef.current?.abort()
    abortRef.current = ac

    setMode('alert')
    setText('')
    setError(null)
    setStreaming(true)

    diagnose({ ...baseBody(), action: { facts: alert.facts, description: alert.description } }, ac.signal)
      .then((res) => {
        if (cancelled) return
        setText(res.feedback)
        onAlertHandled?.(res)
      })
      .catch((err) => {
        if (cancelled || ac.signal.aborted) return
        // The lab already told the learner they were wrong; failing to explain
        // why is a degraded experience, not a broken one.
        setError(err.message)
      })
      .finally(() => { if (!cancelled) setStreaming(false) })

    return () => { cancelled = true; ac.abort() }
  }, [alert, baseBody, onAlertHandled])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [text])

  const runStream = async (fn, extra) => {
    cancel()
    const ac = new AbortController()
    abortRef.current = ac
    setText('')
    setError(null)
    setStreaming(true)
    try {
      await fn({ ...baseBody(), ...extra }, setText, ac.signal)
    } catch (err) {
      if (!ac.signal.aborted) setError(err.message)
    } finally {
      if (abortRef.current === ac) setStreaming(false)
    }
  }

  const doHint = () => { setMode('hint'); runStream(requestHint, { attemptsInStep, labState }) }

  const doAsk = (q) => {
    const text = (q ?? question).trim()
    if (!text) return
    setQuestion('')
    setMode('ask')
    runStream(askTutor, { question: text })
  }

  const status = streaming ? STATUS.working : mode === 'alert' ? STATUS.alert : STATUS.idle
  // Authored per concept. Never the check prompts — offering a quiz question as
  // something to ask hands the learner the answer before they attempt it.
  const suggestions = concept.suggestions ?? []

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
        {mode === 'idle' && !text && (
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
            <Button variant="ghost" onClick={doHint} style={{ width: '100%', marginTop: 12 }}>
              给我一个提示
            </Button>
          </div>
        )}

        {(text || streaming || error) && (
          <div style={{
            background: mode === 'alert' ? 'var(--warn-bg)' : 'var(--bg)',
            border: `1px solid ${mode === 'alert' ? 'var(--warn-line)' : 'var(--border)'}`,
            borderRadius: 12, padding: '14px 15px',
          }} className="fade-up">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
              <span style={{
                fontSize: 12, fontWeight: 500,
                color: mode === 'alert' ? 'var(--warn)' : 'var(--brand)',
              }}>
                {mode === 'alert' ? '关于你刚才那一步' : mode === 'hint' ? '提示' : '回答'}
              </span>
              <span style={{ flex: 1 }} />
              {streaming ? (
                <span onClick={cancel} style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>停止</span>
              ) : (
                <span onClick={() => { setText(''); setError(null); setMode('idle') }}
                      style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>收起</span>
              )}
            </div>

            {error ? (
              <div style={{ fontSize: 13, lineHeight: 1.85, color: 'var(--bad)' }}>
                AI 老师没能回应（{error}）。这不影响你继续做实验——界面上的判断和数字都是本地算出来的。
              </div>
            ) : (
              <div className={streaming && !text ? 'streaming' : undefined}
                   style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-mid)', textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>
                {text}
                {streaming && text ? <span className="streaming" /> : null}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 1, background: 'var(--border-faint)' }} />

        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>这一步你可能会问</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {suggestions.map((s) => (
            <button key={s} onClick={() => doAsk(s)} disabled={streaming}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)',
                borderRadius: 9, padding: '11px 12px', fontSize: 13, color: 'var(--ink-mid)',
                background: '#fff', textAlign: 'left', opacity: streaming ? 0.5 : 1,
              }}>
              <span style={{ flex: 1, lineHeight: 1.5 }}>{s}</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted-faint)"
                   strokeWidth="2.2" style={{ flex: 'none' }} aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 12 }} />

        <div style={{ flex: 'none' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e1e7f1',
            borderRadius: 11, padding: '11px 12px', background: '#fbfcfe',
          }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAsk() } }}
              placeholder="有其他问题随时问我…"
              aria-label="向 AI 老师提问"
              style={{
                flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: 'var(--ink-mid)',
              }} />
            <svg onClick={() => doAsk()} width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="var(--brand)" strokeWidth="1.9" style={{ cursor: 'pointer', flex: 'none' }}
                 role="button" aria-label="发送">
              <path d="M4 12l16-7-7 16-2.4-6.6L4 12Z" />
            </svg>
          </div>
          <div style={{ textAlign: 'right', fontSize: 11.5, color: 'var(--muted-light)', marginTop: 7 }}>
            Enter 发送
          </div>
        </div>
      </div>
    </aside>
  )
}
