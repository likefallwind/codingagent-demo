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
 *
 * A wrong answer never locks the card: the learner tries again in place, and
 * `onWrong` wakes the tutor panel to explain what went wrong. For multiple
 * choice the correct option stays hidden until it is picked — revealing it on a
 * miss would turn the retry into copying.
 */

import React, { useRef, useState } from 'react'
import { gradeAnswer } from '../api.js'
import { Button, Feedback, Card } from './ui.jsx'

const VERDICT_TONE = { correct: 'ok', partial: 'warn', misconception: 'bad' }
const VERDICT_LABEL = { correct: '答对了', partial: '方向对，但还差一点', misconception: '这里有个理解偏差' }

export default function CheckCard({ course, concept, check, learnerState, misconceptionHistory, onEvidence, onAnswered, onWrong, onContinue }) {
  const [choice, setChoice] = useState(null)
  const [wrongPicks, setWrongPicks] = useState([])
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const isMcq = check.kind === 'mcq'
  const solved = isMcq && choice !== null && Boolean(check.options[choice].correct)

  const submitMcq = (i) => {
    if (solved || wrongPicks.includes(i)) return
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
    if (!correct) {
      setWrongPicks((w) => [...w, i])
      onWrong?.({ checkId: check.id, choice: i })
    }
  }

  const submitWritten = async () => {
    const text = answer.trim()
    if (!text || busy) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setError(null)
    setResult(null)
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
      if (res.verdict !== 'correct') onWrong?.({ checkId: check.id, verdict: res.verdict, feedback: res.feedback })
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

  const accepted = result?.verdict === 'correct'

  return (
    <Card title={check.kind === 'prediction' ? '先预测，再验证' : '检查一下'}>
      <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink-strong)', marginBottom: 14, textWrap: 'pretty' }}>
        {check.prompt}
      </div>

      {isMcq ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {check.options.map((o, i) => {
            const missed = wrongPicks.includes(i)
            const locked = solved || missed
            const tone = solved && o.correct ? 'ok' : missed ? 'bad' : 'idle'
            const bd = tone === 'ok' ? 'var(--ok-line)' : tone === 'bad' ? 'var(--bad-line)' : 'var(--border)'
            const bg = tone === 'ok' ? 'var(--ok-bg)' : tone === 'bad' ? 'var(--bad-bg)' : '#fff'
            return (
              <button key={i} onClick={() => submitMcq(i)} disabled={locked}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  border: `1.5px solid ${bd}`, background: bg, borderRadius: 10, padding: '12px 14px',
                  fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-mid)',
                  cursor: locked ? 'default' : 'pointer',
                }}>
                <span style={{
                  width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: '50%',
                  border: `1.5px solid ${bd}`, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, color: 'var(--muted)',
                }}>
                  {tone === 'ok' ? '✓' : missed ? '✕' : String.fromCharCode(65 + i)}
                </span>
                <span style={{ flex: 1 }}>{o.text}</span>
              </button>
            )
          })}
          {solved && (
            <>
              {check.explain && (
                <Feedback tone="ok" title="答对了" style={{ marginTop: 4 }}>
                  {check.explain}
                </Feedback>
              )}
              <div style={{ marginTop: 6 }}>
                <Button variant="primary" onClick={onContinue}>继续</Button>
              </div>
            </>
          )}
          {!solved && wrongPicks.length > 0 && (
            <Feedback tone="warn" title="不对，再选一次" style={{ marginTop: 4 }}>
              打 ✕ 的选项已经排除了。右边 AI 老师给了一点提示，看完再选。
            </Feedback>
          )}
        </div>
      ) : (
        <div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="用自己的话写下来，两三句就够。"
            rows={4}
            disabled={busy || accepted}
            style={{
              width: '100%', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px',
              fontSize: 13.5, lineHeight: 1.8, color: 'var(--ink-mid)', outline: 'none',
              resize: 'vertical', background: accepted ? 'var(--bg)' : '#fff',
            }} />
          {result && !accepted && (
            <Feedback tone={VERDICT_TONE[result.verdict]} title={VERDICT_LABEL[result.verdict]} style={{ marginTop: 12 }}>
              具体哪里不对，右边 AI 老师写了说明。在上面改一改，再提交一次。
            </Feedback>
          )}

          {!accepted && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <Button variant="primary" onClick={submitWritten} disabled={busy || !answer.trim()}>
                {busy ? '批改中…' : result ? '重新提交' : '提交'}
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

          {accepted && (
            <>
              <Feedback tone="ok" title={VERDICT_LABEL.correct} style={{ marginTop: 12 }}>
                {result.feedback}
              </Feedback>
              <div style={{ marginTop: 12 }}>
                <Button variant="primary" onClick={onContinue}>继续</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
