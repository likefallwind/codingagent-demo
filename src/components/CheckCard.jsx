/**
 * A check question.
 *
 * Multiple choice is graded locally and instantly — the correct option is in the
 * course document, so there is nothing to ask a model. Written answers go to the
 * grader, which returns a verdict, a misconception id drawn from the author's
 * catalogue, and feedback.
 *
 * When the grader is unreachable the answer is still recorded, marked as
 * ungraded and left out of the mastery estimate. Silently scoring it either way
 * would corrupt the learner model on a network error.
 */

import React, { useRef, useState } from 'react'
import { gradeAnswer } from '../api.js'
import { Button, Feedback, Card } from './ui.jsx'

const VERDICT_TONE = { correct: 'ok', partial: 'warn', misconception: 'bad' }
const VERDICT_LABEL = { correct: '答对了', partial: '方向对，但还差一点', misconception: '这里有个理解偏差' }

export default function CheckCard({ course, concept, check, learnerState, misconceptionHistory, onEvidence, onAnswered, onContinue }) {
  const [choice, setChoice] = useState(null)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const isMcq = check.kind === 'mcq'

  const submitMcq = (i) => {
    if (choice !== null) return
    setChoice(i)
    // Pin this question before recording, or the evidence immediately changes
    // which check the policy wants and this card is swapped out mid-feedback.
    onAnswered?.()
    const correct = Boolean(check.options[i].correct)
    onEvidence({
      kind: 'mcq',
      correct,
      misconceptionId: correct ? null : (check.misconceptions?.[0] ?? null),
      detail: { checkId: check.id },
    })
  }

  const submitWritten = async () => {
    const text = answer.trim()
    if (!text || busy) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setError(null)
    onAnswered?.()
    try {
      const res = await gradeAnswer({
        courseId: course.id,
        conceptId: concept.id,
        checkId: check.id,
        answer: text,
        learner: learnerState,
        misconceptionHistory,
      }, ac.signal)
      setResult(res)
      onEvidence({
        kind: check.kind === 'prediction' ? 'prediction' : 'freeResponse',
        correct: res.verdict === 'correct',
        misconceptionId: res.misconception_id || null,
        detail: { checkId: check.id, verdict: res.verdict },
      })
    } catch (err) {
      if (!ac.signal.aborted) {
        // Recorded but not scored — see the note at the top of this file.
        setError(err.message)
        onEvidence({ kind: 'ungraded', correct: null, detail: { checkId: check.id, answer: text } })
      }
    } finally {
      if (abortRef.current === ac) setBusy(false)
    }
  }

  return (
    <Card title={check.kind === 'prediction' ? '先预测，再验证' : '检查一下'}>
      <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink-strong)', marginBottom: 14, textWrap: 'pretty' }}>
        {check.prompt}
      </div>

      {isMcq ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {check.options.map((o, i) => {
            const picked = choice === i
            const revealed = choice !== null
            const tone = revealed && o.correct ? 'ok' : picked ? 'bad' : 'idle'
            const bd = tone === 'ok' ? 'var(--ok-line)' : tone === 'bad' ? 'var(--bad-line)' : 'var(--border)'
            const bg = tone === 'ok' ? 'var(--ok-bg)' : tone === 'bad' ? 'var(--bad-bg)' : '#fff'
            return (
              <button key={i} onClick={() => submitMcq(i)} disabled={revealed}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  border: `1.5px solid ${bd}`, background: bg, borderRadius: 10, padding: '12px 14px',
                  fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-mid)',
                  cursor: revealed ? 'default' : 'pointer',
                }}>
                <span style={{
                  width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: '50%',
                  border: `1.5px solid ${bd}`, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, color: 'var(--muted)',
                }}>
                  {revealed && o.correct ? '✓' : picked ? '✕' : String.fromCharCode(65 + i)}
                </span>
                <span style={{ flex: 1 }}>{o.text}</span>
              </button>
            )
          })}
          {choice !== null && (
            <>
              {check.explain && (
                <Feedback tone={check.options[choice].correct ? 'ok' : 'warn'}
                          title={check.options[choice].correct ? '答对了' : '再想想'}
                          style={{ marginTop: 4 }}>
                  {check.explain}
                </Feedback>
              )}
              <div style={{ marginTop: 6 }}>
                <Button variant="primary" onClick={onContinue}>继续</Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="用自己的话写下来，两三句就够。"
            rows={4}
            disabled={busy || Boolean(result)}
            style={{
              width: '100%', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px',
              fontSize: 13.5, lineHeight: 1.8, color: 'var(--ink-mid)', outline: 'none',
              resize: 'vertical', background: result ? 'var(--bg)' : '#fff',
            }} />
          {!result && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <Button variant="primary" onClick={submitWritten} disabled={busy || !answer.trim()}>
                {busy ? '批改中…' : '提交'}
              </Button>
              {busy && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  AI 正在对照评分标准批改，大约需要几秒。
                </span>
              )}
            </div>
          )}

          {error && (
            <Feedback tone="warn" title="没能批改" style={{ marginTop: 12 }}>
              {error}。你的回答已经保存，但这次没有计入掌握度——网络问题不该影响对你的判断。
              <div style={{ marginTop: 10 }}>
                <Button variant="quiet" onClick={() => { setError(null); submitWritten() }}>重试</Button>
              </div>
            </Feedback>
          )}

          {result && (
            <>
              <Feedback tone={VERDICT_TONE[result.verdict]} title={VERDICT_LABEL[result.verdict]} style={{ marginTop: 12 }}>
                {result.feedback}
              </Feedback>
              <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Button variant="primary" onClick={onContinue}>继续</Button>
                {result.verdict !== 'correct' && (
                  <Button variant="quiet" onClick={() => { setResult(null); setAnswer('') }}>换个说法再答一次</Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
