/**
 * The capability profile: every capability the course teaches, its status, and
 * — one click away — the evidence behind it. Each conclusion can be traced to
 * the attempts it rests on: the task, the date, the help involved, and the
 * scoring points met or still missing. Misconceptions are listed with their
 * state (a lead to check, supported by evidence, or cleared by a targeted
 * question) rather than as a verdict.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Chip, Button } from './ui.jsx'
import { PointList } from './CheckCard.jsx'
import { CAP_LABEL } from '../engine/capabilities.js'
import { OBSERVATION_SCOPE } from '../engine/persistence.js'

const TONE = { unverified: 'neutral', learning: 'brand', verified: 'ok', transfer: 'ok' }
const MIS_LABEL = { suspected: '待核实的线索', supported: '已有证据支持', resolved: '已通过针对性题目澄清' }

export default function CapabilityProfile({ open, focus, course, profile, misconceptionsOf, projectSummary, onClose, onGo }) {
  const ref = useRef(null)
  const [expanded, setExpanded] = useState(null)
  useEffect(() => {
    if (!open) return undefined
    setExpanded(focus ?? null)
    ref.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, focus, onClose])
  if (!open) return null

  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,35,61,.22)', zIndex: 40, display: 'flex', justifyContent: 'flex-end' }}>
      <aside ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="能力档案" data-testid="profile"
             onClick={(e) => e.stopPropagation()} className="scroll-y fade-up"
             style={{ width: 'min(560px, 100%)', height: '100%', background: 'var(--panel)', padding: '18px 20px 30px', boxShadow: '-8px 0 30px rgba(22,35,61,.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>能力档案</h2>
          <span style={{ flex: 1 }} />
          <Button variant="quiet" onClick={onClose} style={{ height: 30 }}>关闭</Button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8, marginBottom: 14 }}>
          每项能力只看证据：「{CAP_LABEL.verified}」要求在没见过的新题上、不用帮助、第一次就答对；
          「{CAP_LABEL.transfer}」还要求在结课项目的新数据上独立通过。内部的掌握度估计只用来推荐练习，不在这里出现。
          <br />{OBSERVATION_SCOPE}
        </div>

        {profile.map((c) => {
          const isOpen = expanded === c.conceptId
          const mis = misconceptionsOf(c.conceptId)
          return (
            <div key={c.conceptId} data-cap={c.capability.id} data-status={c.status} style={{ border: '1px solid var(--border)', borderRadius: 11, marginBottom: 10 }}>
              <button onClick={() => setExpanded(isOpen ? null : c.conceptId)} aria-expanded={isOpen}
                style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '11px 13px', background: 'none', border: 'none', textAlign: 'left' }}>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--ink-strong)' }}>{c.capability.title}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{c.concept.shortTitle ?? c.concept.title} · {c.basis}</span>
                </span>
                <Chip tone={TONE[c.status]}>{c.status === 'verified' || c.status === 'transfer' ? '✓ ' : ''}{c.label}</Chip>
                {c.review && <Chip tone="warn">待复习</Chip>}
                <span aria-hidden="true" style={{ color: 'var(--muted)' }}>{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div style={{ padding: '0 13px 12px', fontSize: 12.5 }}>
                  {c.missing.length > 0 && (
                    <div style={{ color: 'var(--ink-soft)', marginBottom: 8 }}>
                      还缺：{c.missing.join('；')}
                    </div>
                  )}
                  {mis.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {mis.map((m) => {
                        const detail = c.concept.misconceptions?.find((x) => x.id === m.id)
                        return (
                          <div key={m.id} style={{ color: 'var(--ink-soft)' }}>
                            误解「{detail?.belief ?? m.id}」：{MIS_LABEL[m.status]}（{m.evidence.length} 条相关作答）
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 4px' }}>证据来源（最新在前）</div>
                  {c.trace.length === 0 && <div style={{ color: 'var(--muted-light)' }}>还没有记录。</div>}
                  <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {c.trace.slice(0, 30).map((t) => (
                      <li key={t.id} data-counts={t.counts ? '1' : '0'} style={{ borderTop: '1px solid var(--border-faint)', padding: '7px 0' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                          <span style={{ color: 'var(--muted)' }}>{new Date(t.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span style={{ color: 'var(--ink-mid)' }}>{t.activityLabel}</span>
                          <span style={{ color: t.correct === true ? 'var(--ok-deep)' : t.correct === false ? 'var(--bad)' : 'var(--muted)' }}>
                            {t.correct === true ? '✓ 对' : t.correct === false ? '✗ 错' : t.verdict === 'needs-review' ? '待核实' : t.verdict === 'legacy' ? '历史' : '未评定'}
                          </span>
                          <span style={{ color: t.help === '独立完成' ? 'var(--ok-deep)' : 'var(--muted)' }}>{t.help}</span>
                          {t.counts && <Chip tone="ok">计入能力结论</Chip>}
                          {t.staleVersion && <Chip tone="warn">旧版本任务，需要重新验证</Chip>}
                        </div>
                        <div style={{ color: 'var(--ink-soft)', marginTop: 2 }}>{t.task}</div>
                        {t.criteria && <div style={{ marginTop: 4 }}><PointList criteria={t.criteria} /></div>}
                      </li>
                    ))}
                  </ol>
                  <div style={{ marginTop: 8 }}>
                    <Button variant="quiet" style={{ height: 30, fontSize: 12.5 }} onClick={() => onGo(c.conceptId)}>去这一步</Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {projectSummary && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 11, padding: '11px 13px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 6 }}>{course.project.title}</div>
            {projectSummary.map((r) => (
              <div key={r.label} style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.8 }}>
                {r.label}：<b style={{ color: r.tone === 'ok' ? 'var(--ok-deep)' : r.tone === 'bad' ? 'var(--bad)' : 'var(--ink-mid)' }}>{r.value}</b>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <Button variant="quiet" style={{ height: 30, fontSize: 12.5 }} onClick={() => onGo(course.project.id)}>去结课项目</Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
