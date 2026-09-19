/**
 * Independent verification: a small set of unseen, generated questions.
 *
 * It is taken the way a test is taken. What the learner may use is stated
 * before it starts. Answers can be changed until submission; nothing says right
 * or wrong before then — no colour, no label, no order, no tutor. Submitting
 * reveals every answer and retires the instances: they will never be issued to
 * this learner again, for practice or for verification.
 *
 * Asking for help is always possible. The page asks first, and if the learner
 * goes ahead the round becomes assisted practice — the choices made so far are
 * kept — and a fresh unseen round is needed to verify the capability.
 */

import React from 'react'
import { Card, Button, Feedback, Chip } from './ui.jsx'
import { Diagram, QuestionTable } from './CheckCard.jsx'
import { GENERATOR_VERSION } from '../labs/practice.js'

export default function VerifyCard({
  concept, instance, attempt, judgement, choices, onChoose, onStart, onSubmit, onContinue, onPracticeFirst,
}) {
  const v = concept.verify
  const cap = concept.capability
  const items = instance?.items ?? []
  const submitted = Boolean(judgement)
  const converted = Boolean(attempt?.converted)

  if (instance?.unavailable) {
    return (
      <Card title={`独立验证 · ${cap.title}`} data-object="verify" data-testid="verify-card">
        <Feedback tone="warn" title="现在无法验证">
          {instance.reason}
        </Feedback>
      </Card>
    )
  }
  if (!instance) return null

  const answered = items.every((_, i) => Number.isInteger(choices?.[i]))
  const status = submitted
    ? (converted || judgement.assisted ? '辅助练习（不计入）' : judgement.correct ? '通过' : '未通过')
    : attempt ? (converted ? '已转为辅助练习' : '独立进行中') : '未开始'

  const submit = () => {
    if (!attempt || submitted || !answered) return
    const results = items.map((q, i) => Boolean(q.options[choices[i]]?.correct))
    const firstWrong = items.findIndex((q, i) => !results[i])
    onSubmit({
      id: `${attempt.id}:submit`,
      kind: 'verify',
      correct: results.every(Boolean),
      criteria: items.map((q, i) => ({ id: `item${i}`, text: v.items[i].criterion, met: results[i] })),
      misconceptionId: firstWrong >= 0 ? (items[firstWrong].options[choices[firstWrong]]?.misconception ?? null) : null,
      targets: [...new Set(items.flatMap((q) => q.targets ?? []))],
      answer: { choices: items.map((q, i) => ({ id: q.id, choice: choices[i], text: q.options[choices[i]]?.text })) },
      grading: { method: 'algorithm', version: GENERATOR_VERSION },
      closes: true,
      reveals: true,
      detail: { label: `独立验证：${cap.title}`, seeds: attempt.items },
    })
  }

  return (
    <div data-object="verify" data-testid="verify-card" data-status={status}>
      <Card title={`独立验证 · ${cap.title}`}
            right={<Chip tone={submitted ? (judgement.correct && !judgement.assisted ? 'ok' : 'warn') : converted ? 'warn' : 'brand'}>{status}</Chip>}>
        <div style={{
          fontSize: 12.5, lineHeight: 1.8, color: 'var(--ink-soft)', background: 'var(--bg)',
          border: '1px solid var(--border-soft)', borderRadius: 10, padding: '10px 12px', marginBottom: 14,
        }}>
          <b style={{ color: 'var(--ink-mid)' }}>{items.length} 道没见过的新题，全部答对即通过。</b>
          提交之前不会显示对错；提交之后显示答案，这几道题以后不会再出现。
          <div style={{ marginTop: 4 }}>{v.resources}</div>
        </div>

        {!attempt && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={onStart} data-testid="verify-start">开始独立验证</Button>
            {onPracticeFirst && <Button variant="quiet" onClick={onPracticeFirst}>先再练一道</Button>}
          </div>
        )}

        {attempt && converted && !submitted && (
          <Feedback tone="warn" title="这一组已转为辅助练习" style={{ marginBottom: 14 }}>
            你在验证中请求了帮助。已经选的答案都还在，可以做完它当作练习；它不计入独立验证，之后会换一组新题再验证。
          </Feedback>
        )}

        {attempt && items.map((q, i) => {
          const chosen = choices?.[i]
          const right = q.options.findIndex((o) => o.correct)
          return (
            <div key={q.id} data-verify-item={i} style={{ borderTop: i ? '1px solid var(--border-faint)' : 'none', paddingTop: i ? 16 : 0, marginTop: i ? 16 : 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>第 {i + 1} 题 · 检验：{v.items[i].criterion}</div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--ink-strong)', marginBottom: 12 }}>{q.prompt}</div>
              {q.diagram && <Diagram lines={q.diagram} />}
              {q.table && <QuestionTable table={q.table} />}
              <div role="radiogroup" aria-label={`第 ${i + 1} 题的选项`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {q.options.map((o, k) => {
                  const picked = chosen === k
                  const showRight = submitted && k === right
                  const showWrong = submitted && picked && k !== right
                  const bd = showRight ? 'var(--ok-line)' : showWrong ? 'var(--bad-line)' : picked ? 'var(--brand)' : 'var(--border)'
                  const bg = showRight ? 'var(--ok-bg)' : showWrong ? 'var(--bad-bg)' : picked ? 'var(--brand-tint)' : '#fff'
                  return (
                    <button key={k} role="radio" aria-checked={picked} data-option={k} disabled={submitted}
                      onClick={() => onChoose(i, k)}
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', borderRadius: 10,
                        border: `1.5px solid ${bd}`, background: bg, padding: '10px 13px', fontSize: 13.5, lineHeight: 1.7,
                        color: 'var(--ink-mid)', cursor: submitted ? 'default' : 'pointer',
                      }}>
                      <span aria-hidden="true" style={{ width: 18, flex: 'none', color: 'var(--muted)', fontSize: 12 }}>
                        {showRight ? '✓' : showWrong ? '✕' : picked ? '●' : String.fromCharCode(65 + k)}
                      </span>
                      <span style={{ flex: 1 }}>{o.text}</span>
                    </button>
                  )
                })}
              </div>
              {submitted && (
                <Feedback tone={chosen === right ? 'ok' : 'warn'} title={chosen === right ? '这题对了' : '这题没对'} style={{ marginTop: 10 }}>
                  {q.explain}
                </Feedback>
              )}
            </div>
          )
        })}

        {attempt && !submitted && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <Button variant="primary" onClick={submit} disabled={!answered} data-testid="verify-submit">提交（提交后显示答案）</Button>
            {!answered && <span style={{ fontSize: 12, color: 'var(--muted)' }}>每道题都选一个答案后才能提交。</span>}
          </div>
        )}

        {submitted && (
          <Feedback tone={judgement.correct && !judgement.assisted ? 'ok' : 'warn'} style={{ marginTop: 16 }}
                    title={judgement.assisted ? '辅助练习完成' : judgement.correct ? `通过独立验证：${cap.title}` : '这次没有全部答对'}>
            {judgement.assisted
              ? '这一组用过帮助，不计入独立验证。练一道新题之后，会换一组没见过的题再验证。'
              : judgement.correct
                ? '这组题你没见过、没用帮助，全部答对。这条证据已经记进能力档案，可以展开查看来源。'
                : '没关系，答案都已经显示。先练一道新题，再换一组没见过的题重新验证——同一组题不会再用来验证。'}
            <div style={{ marginTop: 10 }}>
              <Button variant="primary" onClick={onContinue}>继续</Button>
            </div>
          </Feedback>
        )}
      </Card>
    </div>
  )
}
