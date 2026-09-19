/**
 * A question: an authored check or a generated practice question.
 *
 * Multiple choice is graded locally and instantly — the correct option is in the
 * course document or computed by the generator, so there is nothing to ask a
 * model. Written answers go to the grader, which returns a verdict, per-point
 * results, a misconception id drawn from the author's catalogue, a confidence
 * and feedback.
 *
 * The card's state comes from the learner record, not from component state: the
 * options already ruled out, the last grading, the draft. A refresh brings the
 * same question back exactly as it was, help marks and all.
 *
 * Grading outcomes are explicit: 批改中, 已评定 (with the points hit and
 * missed), 未评定 (the grader failed — recorded, changes nothing, retry
 * allowed), 待核实 (the grader was unsure — kept for a teacher, changes
 * nothing). None of them silently becomes right or wrong.
 *
 * Authored options are shown in a fixed shuffled order per question: in the
 * course document the right answer is nearly always written first, and
 * position must not give it away. A wrong pick never reveals the right option.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { gradeAnswer } from '../api.js'
import { contentHash, hashString } from '../engine/ids.js'
import { Button, Feedback, Card } from './ui.jsx'

const VERDICT_TONE = { correct: 'ok', partial: 'warn', misconception: 'bad', incorrect: 'bad' }
/** Longer than the server's own deadline: normally the server reports the timeout first. */
const CLIENT_GRADING_DEADLINE_MS = 90000
const VERDICT_LABEL = { correct: '答对了', partial: '方向对，但还差一点', misconception: '这里有个理解偏差', incorrect: '这样答不对' }

/** A permutation of option indices that depends only on the question's id. */
export function displayOrder(check) {
  const n = check.options?.length ?? 0
  const idx = [...Array(n).keys()]
  if (check.generated) return idx
  let h = parseInt(hashString(check.id), 16)
  for (let i = n - 1; i > 0; i--) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    const j = h % (i + 1)
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  // Never leave the right answer in first place, where the author wrote it.
  if (n > 1 && check.options[idx[0]]?.correct) [idx[0], idx[1]] = [idx[1], idx[0]]
  return idx
}

export default function CheckCard({
  course, concept, check, attempt, history, draft, onDraft, learnerState, misconceptionHistory, screen,
  onJudge, onScreen, onAnswered, onWrong, onContinue, inline, title: titleOverride, contextKey,
}) {
  const [answer, setAnswer] = useState(draft ?? '')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)
  const isMcq = check.kind === 'mcq'
  const order = useMemo(() => displayOrder(check), [check])

  const picks = (history ?? []).filter((j) => Number.isInteger(j.answer?.choice))
  const wrongPicks = picks.filter((j) => j.correct === false).map((j) => j.answer.choice)
  const solved = isMcq && picks.some((j) => j.correct === true)
  const written = (history ?? []).filter((j) => !isMcq)
  const last = written.at(-1) ?? null
  const accepted = last?.correct === true

  useEffect(() => () => abortRef.current?.abort(), [])

  // Report to the tutor. The draft is debounced: every keystroke re-rendering
  // the whole page (labs included) makes typing lag.
  useEffect(() => {
    const t = setTimeout(() => onScreen?.({
      checkId: check.id,
      kind: check.kind,
      prompt: check.prompt,
      table: check.table ? [check.table.columns.join(' | '), ...check.table.rows.map((r) => r.join(' | '))] : null,
      diagram: check.diagram ?? null,
      eliminated: wrongPicks.map((i) => check.options[i].text),
      draft: isMcq ? '' : answer.slice(0, 400),
    }), isMcq ? 0 : 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, wrongPicks.join(','), answer, isMcq, onScreen])

  // Drafts are saved with the attempt, so leaving and coming back keeps them.
  useEffect(() => {
    if (isMcq) return undefined
    const t = setTimeout(() => onDraft?.(answer), 500)
    return () => clearTimeout(t)
  }, [answer, isMcq, onDraft])

  const submitMcq = (i) => {
    if (!attempt || solved || wrongPicks.includes(i)) return
    // Pin this question before recording, or the evidence immediately changes
    // which question the policy wants and this card is swapped out mid-feedback.
    onAnswered?.()
    const opt = check.options[i]
    const correct = Boolean(opt.correct)
    onJudge({
      id: `${attempt.id}:c${i}`,
      kind: 'mcq',
      correct,
      // The option's own misconception when it names one — a lead, not a finding.
      misconceptionId: correct ? null : (opt.misconception ?? null),
      targets: [...new Set([...(check.misconceptions ?? []), ...check.options.map((o) => o.misconception).filter(Boolean)])],
      answer: { choice: i, text: opt.text },
      grading: { method: check.generated ? 'algorithm' : 'answer-key', version: check.generatorVersion ?? course.version },
      closes: correct,
      reveals: correct,
      detail: { label: check.generated ? `练习题：${check.prompt.slice(0, 24)}…` : `课程题：${check.prompt.slice(0, 24)}…` },
    })
    if (!correct) onWrong?.({ check, choice: i })
  }

  const submitWritten = async () => {
    const text = answer.trim()
    if (!text || busy || !attempt) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    // Backstop in case the server's own deadline never arrives (network gone).
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ac.abort() }, CLIENT_GRADING_DEADLINE_MS)
    setBusy(true)
    onAnswered?.()
    const id = `${attempt.id}:w${attempt.submissions}:${contentHash(text).slice(0, 8)}`
    const base = {
      id,
      kind: check.kind === 'prediction' ? 'prediction' : 'freeResponse',
      answer: { text },
      targets: check.misconceptions ?? [],
      detail: { label: `课程题：${check.prompt.slice(0, 24)}…` },
    }
    try {
      const res = await gradeAnswer({
        courseId: course.id,
        conceptId: concept.id,
        checkId: check.id,
        answer: text,
        learner: learnerState,
        misconceptionHistory,
        screen,
        contextKey,
      }, ac.signal)
      const unsure = Number.isFinite(res.confidence) && res.confidence < 0.5
      const criteria = (res.points ?? []).map((p, k) => ({ id: `p${k}`, text: p.text, met: p.met }))
      onJudge({
        ...base,
        correct: unsure ? null : res.verdict === 'correct',
        verdict: unsure ? 'needs-review' : res.verdict,
        criteria: criteria.length ? criteria : null,
        misconceptionId: unsure ? null : (res.misconception_id || null),
        stated: res.verdict === 'misconception' && (res.confidence ?? 1) >= 0.6,
        needsReview: unsure,
        grading: { method: 'llm', version: res.gradingVersion ?? null, confidence: res.confidence ?? null, feedback: res.feedback, evidence: res.evidence ?? '' },
        closes: !unsure && res.verdict === 'correct',
        reveals: !unsure && res.verdict === 'correct',
      })
      if (!unsure && res.verdict !== 'correct') onWrong?.({ check, verdict: res.verdict, feedback: res.feedback })
    } catch (err) {
      // Recorded as unrated: a network failure or a timeout must not move any
      // conclusion. A stop by the learner records nothing at all.
      if (timedOut) onJudge({ ...base, correct: null, verdict: 'unrated', grading: { method: 'llm', error: '批改超时，已停止' } })
      else if (!ac.signal.aborted) onJudge({ ...base, correct: null, verdict: 'unrated', grading: { method: 'llm', error: err.message } })
    } finally {
      clearTimeout(timer)
      if (abortRef.current === ac) setBusy(false)
    }
  }

  const title = titleOverride ?? (check.generated ? '练一道新题' : check.kind === 'prediction' ? '先预测，再验证' : '课程题')
  const assisted = attempt?.assisted
  const status = busy ? '批改中' : last?.verdict === 'unrated' ? '未评定' : last?.verdict === 'needs-review' ? '待核实' : null

  return (
    <div data-check-id={check.id} data-check-kind={check.kind} data-object={`check:${check.id}`}>
    <Card title={title}
          right={(
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--muted-light)' }}>
              {check.generated && <span>由真实计算生成，不会重复</span>}
              {attempt?.ordinal > 1 && <span data-testid="retry-mark">第 {attempt.ordinal} 次做这道题</span>}
              {assisted && <span data-testid="assisted-mark" style={{ color: 'var(--warn)' }}>已用过提示 · 记为辅助</span>}
            </span>
          )}>
      <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink-strong)', marginBottom: 14, textWrap: 'pretty' }}>
        {check.prompt}
      </div>

      {check.diagram && <Diagram lines={check.diagram} />}
      {check.table && <QuestionTable table={check.table} />}

      {isMcq ? (
        <div role="group" aria-label="选项" style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {order.map((i, pos) => {
            const o = check.options[i]
            const missed = wrongPicks.includes(i)
            const locked = solved || missed
            const tone = solved && o.correct ? 'ok' : missed ? 'bad' : 'idle'
            const bd = tone === 'ok' ? 'var(--ok-line)' : tone === 'bad' ? 'var(--bad-line)' : 'var(--border)'
            const bg = tone === 'ok' ? 'var(--ok-bg)' : tone === 'bad' ? 'var(--bad-bg)' : '#fff'
            return (
              <button key={i} data-option={i} onClick={() => submitMcq(i)} disabled={locked || !attempt}
                aria-label={`${String.fromCharCode(65 + pos)}. ${o.text}${missed ? '（已排除）' : tone === 'ok' ? '（正确）' : ''}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  border: `1.5px solid ${bd}`, background: bg, borderRadius: 10, padding: '12px 14px',
                  fontSize: 13.5, lineHeight: 1.7, color: 'var(--ink-mid)',
                  cursor: locked ? 'default' : 'pointer',
                }}>
                <span aria-hidden="true" style={{
                  width: 18, height: 18, flex: 'none', marginTop: 1, borderRadius: '50%',
                  border: `1.5px solid ${bd}`, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, color: 'var(--muted)',
                }}>
                  {tone === 'ok' ? '✓' : missed ? '✕' : String.fromCharCode(65 + pos)}
                </span>
                <span style={{ flex: 1 }}>{o.text}</span>
              </button>
            )
          })}
          {solved && (
            <>
              {check.explain && (
                <Feedback tone="ok" title={wrongPicks.length ? '这次对了（排除过选项，记为重试）' : '答对了'} style={{ marginTop: 4 }}>
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
              打 ✕ 的选项已经排除了。这道题接下来的作答记为重试，不算首次独立答对。
              <InlineTutor inline={inline} />
            </Feedback>
          )}
        </div>
      ) : (
        <div>
          <label className="sr-only" htmlFor={`answer-${check.id}`}>你的回答</label>
          <textarea
            id={`answer-${check.id}`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="用自己的话写下来，两三句就够。"
            rows={4}
            disabled={busy || accepted}
            style={{
              width: '100%', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px',
              fontSize: 13.5, lineHeight: 1.8, color: 'var(--ink-mid)',
              resize: 'vertical', background: accepted ? 'var(--bg)' : '#fff',
            }} />

          {last && ['correct', 'partial', 'misconception', 'incorrect'].includes(last.verdict) && !accepted && (
            <Feedback tone={VERDICT_TONE[last.verdict]} title={VERDICT_LABEL[last.verdict]} style={{ marginTop: 12 }}>
              <PointList criteria={last.criteria} />
              {last.grading?.feedback && <div style={{ marginTop: 6 }}>{last.grading.feedback}</div>}
              <div style={{ marginTop: 6, color: 'var(--muted)' }}>改一改再提交一次（记为重试）。</div>
            </Feedback>
          )}

          {!accepted && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <Button variant="primary" onClick={submitWritten} disabled={busy || !answer.trim() || !attempt}>
                {busy ? '批改中…' : last ? '重新提交' : '提交'}
              </Button>
              {busy && (
                <Button variant="quiet" style={{ height: 32, fontSize: 12.5 }} onClick={() => abortRef.current?.abort()} data-testid="stop-grading">
                  停止批改
                </Button>
              )}
              <span role="status" data-testid="grading-status" data-status={status ?? ''} style={{ fontSize: 12, color: 'var(--muted)' }}>
                {busy && 'AI 正在对照评分要点批改，大约需要几秒。停止后回答保留，不计入任何结论。'}
              </span>
            </div>
          )}

          {!busy && last?.verdict === 'unrated' && (
            <Feedback tone="warn" title="未评定" style={{ marginTop: 12 }}>
              这次没能批改（{last.grading?.error ?? '服务不可用'}）。回答已经保存，但不计入任何结论——网络问题不该影响对你的判断。
              <div style={{ marginTop: 10 }}>
                <Button variant="quiet" onClick={submitWritten}>重试批改</Button>
              </div>
            </Feedback>
          )}

          {!busy && last?.verdict === 'needs-review' && (
            <Feedback tone="warn" title="待核实" style={{ marginTop: 12 }}>
              这次批改拿不准，已标记为待核实（老师可以在导出记录里看到你的原文和评分依据），不计入任何结论。
              可以把理由写得更具体再提交，也可以先继续往下。
              <div style={{ marginTop: 10 }}>
                <Button variant="quiet" onClick={onContinue}>先继续</Button>
              </div>
            </Feedback>
          )}

          {accepted && (
            <>
              <Feedback tone="ok" title={written.length > 1 ? '这次对了（记为重试）' : VERDICT_LABEL.correct} style={{ marginTop: 12 }}>
                <PointList criteria={last.criteria} />
                {last.grading?.feedback}
              </Feedback>
              <div style={{ marginTop: 12 }}>
                <Button variant="primary" onClick={onContinue}>继续</Button>
              </div>
            </>
          )}
          {!accepted && last && ['partial', 'misconception', 'incorrect'].includes(last.verdict) && <InlineTutor inline={inline} />}
        </div>
      )}
    </Card>
    </div>
  )
}

/** Scoring points hit and missed, with symbols as well as colour. */
export function PointList({ criteria }) {
  if (!criteria?.length) return null
  return (
    <ul style={{ margin: '0 0 4px', paddingLeft: 0, listStyle: 'none' }}>
      {criteria.map((c) => (
        <li key={c.id} style={{ display: 'flex', gap: 6, fontSize: 12.5, lineHeight: 1.7 }}>
          <span aria-hidden="true" style={{ color: c.met ? 'var(--ok-deep)' : c.met === false ? 'var(--bad)' : 'var(--muted)' }}>{c.met ? '✓' : c.met === false ? '✗' : '?'}</span>
          <span><span className="sr-only">{c.met ? '已命中：' : c.met === false ? '未命中：' : '未评定：'}</span>{c.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** The tutor's explanation, shown next to the question it is about as well as in the panel. */
function InlineTutor({ inline }) {
  if (!inline) return null
  return (
    <div data-testid="inline-tutor" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--warn-line)', fontSize: 13, lineHeight: 1.85 }}>
      <span style={{ fontWeight: 500, color: 'var(--brand)' }}>AI 老师：</span>
      {inline.error ? <span style={{ color: 'var(--muted)' }}>{inline.error}</span> : inline.text || <span className="streaming" />}
    </div>
  )
}

export function Diagram({ lines }) {
  return (
    <pre className="mono" aria-label="题目里的树" style={{
      margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, background: 'var(--bg)',
      border: '1px solid var(--border-soft)', fontSize: 12.5, lineHeight: 1.75, overflowX: 'auto', color: 'var(--ink-mid)',
    }}>{lines.join('\n')}</pre>
  )
}

export function QuestionTable({ table }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 14 }}>
      <table className="data" style={{ minWidth: '60%', width: 'auto' }}>
        <thead>
          <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} className="mono">{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
