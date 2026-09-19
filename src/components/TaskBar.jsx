/**
 * The top of a step: what this step asks of the learner, what counts as done,
 * and what the system suggests next — with the capability it serves, the
 * evidence behind the suggestion, and what the suggested task will check.
 *
 * The phases below the title are the step's path. They are shown, not
 * enforced: the learner can go anywhere on the page.
 */

import React from 'react'
import { Chip, Button } from './ui.jsx'
import { CAP_LABEL } from '../engine/capabilities.js'

const CAP_TONE = { unverified: 'neutral', learning: 'brand', verified: 'ok', transfer: 'ok' }

export default function TaskBar({ course, concept, index, cap, phases, action, onGo, onOpenProfile, suggestFirst = [], onNavigate }) {
  const criteria = concept.verify
    ? `在 ${concept.verify.items.length} 道没见过的新题上独立答对（不用讲解和 AI 提示）。`
    : '做完实验和本步的课程题。本步没有配置独立验证，所以不会给出「已验证」的标记。'
  return (
    <section aria-label="本步任务" style={{
      background: 'linear-gradient(180deg,#F1F6FF 0%,#EAF1FF 100%)',
      border: '1px solid #DCE7FA', borderRadius: 13, padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 500 }}>第 {index + 1} / {course.concepts.length} 步</span>
        {concept.chapter && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{concept.chapter}</span>}
        {cap.capability && (
          <button onClick={onOpenProfile} data-testid="cap-chip" data-status={cap.status}
                  style={{ background: 'none', border: 'none', padding: 0 }} title="查看这项能力的证据">
            <Chip tone={CAP_TONE[cap.status]}>
              {cap.status === 'verified' || cap.status === 'transfer' ? '✓ ' : ''}能力：{cap.capability.title} · {CAP_LABEL[cap.status]}{cap.review ? ' · 待复习' : ''}
            </Chip>
          </button>
        )}
      </div>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink-strong)', letterSpacing: '-0.3px' }}>{concept.title}</h1>
      {suggestFirst.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          建议先完成{suggestFirst.map((c, i) => (
            <React.Fragment key={c.id}>{i ? '、' : ''}「<button onClick={() => onNavigate(c.id)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand)', fontSize: 12 }}>{c.shortTitle ?? c.title}</button>」</React.Fragment>
          ))}，再来这一步。也可以先看看——浏览不会改变任何记录。
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16, marginTop: 10 }} className="taskbar-grid">
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>本步任务</div>
          {concept.objectives.map((o, i) => <div key={i}>· {o}</div>)}
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>完成标准</div>
          <div>{criteria}</div>
        </div>
      </div>

      <ol aria-label="本步的路径" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
        {phases.map((p, i) => (
          <li key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={() => onGo(p.target)} data-phase={p.key} data-done={p.done ? '1' : '0'} style={{
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '4px 9px', borderRadius: 7,
              border: `1px solid ${p.current ? 'var(--brand)' : p.done ? 'var(--ok-line)' : 'var(--border)'}`,
              background: p.current ? 'var(--brand-tint)' : p.done ? 'var(--ok-bg)' : '#fff',
              color: p.done ? 'var(--ok-deep)' : p.current ? 'var(--brand)' : 'var(--muted)',
            }}>
              <span aria-hidden="true">{p.done ? '✓' : p.current ? '▸' : '○'}</span>
              {p.label}
              <span className="sr-only">{p.done ? '（已完成）' : p.current ? '（建议现在做）' : ''}</span>
            </button>
            {i < phases.length - 1 && <span aria-hidden="true" style={{ color: 'var(--muted-faint)', fontSize: 12 }}>→</span>}
          </li>
        ))}
      </ol>

      <div data-testid="policy-why" data-action={action.type} style={{
        display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 12, padding: '10px 14px',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 11,
      }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, marginTop: 8, borderRadius: '50%', background: 'var(--brand)', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.75 }}>
          <div style={{ color: 'var(--ink-mid)' }}><span className="sr-only">建议：</span>{action.why}</div>
          {(action.basis || action.goal) && (
            <div style={{ color: 'var(--muted)' }}>
              {action.basis && <span>依据：{action.basis}</span>}
              {action.basis && action.goal && <span> · </span>}
              {action.goal && <span>这一项检验：{action.goal}</span>}
            </div>
          )}
        </div>
        {action.target && (
          <Button variant="primary" style={{ height: 30, fontSize: 12.5, flex: 'none' }} onClick={() => onGo(action.target)}>
            {action.targetLabel ?? '去做'} ↓
          </Button>
        )}
      </div>
    </section>
  )
}
