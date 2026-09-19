/**
 * Left rail: the course's steps and the capstone project.
 *
 * Every step is open to browse. What each row shows is the evidence status of
 * the capability it teaches — not an unverified percentage — and prerequisites
 * appear as advice ("建议先学…"), never as a lock that can be clicked through
 * anyway. Visiting a step changes nothing about its status.
 */

import React from 'react'
import { CAP_SHORT } from '../engine/capabilities.js'

const TONE = {
  transfer: { dot: 'var(--ok-deep)', ring: 'var(--ok-deep)', symbol: '★' },
  verified: { dot: 'var(--ok)', ring: 'var(--ok-line)', symbol: '✓' },
  done: { dot: 'var(--ok)', ring: 'var(--ok-line)', symbol: '✓' },
  learning: { dot: 'var(--brand)', ring: 'var(--brand-line)', symbol: '•' },
  unverified: { dot: '#fff', ring: 'var(--brand-line-soft)', symbol: '' },
}

export default function ConceptNav({ course, currentId, statusOf, onSelect, collapsed, onToggle }) {
  const items = [
    ...course.concepts.map((c, i) => ({ id: c.id, n: i + 1, title: c.shortTitle ?? c.title, chapter: c.chapter })),
    ...(course.project ? [{ id: course.project.id, n: null, title: course.project.shortTitle ?? course.project.title, chapter: course.project.chapter }] : []),
  ]

  if (collapsed) {
    return (
      <nav aria-label="课程步骤" style={{
        width: 44, flex: 'none', background: 'var(--panel)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 6,
      }} className="scroll-y">
        <button onClick={onToggle} aria-label="展开步骤导航" title="展开步骤导航" style={railBtn}>☰</button>
        {items.map((it) => {
          const s = statusOf(it.id)
          const active = it.id === currentId
          return (
            <button key={it.id} onClick={() => onSelect(it.id)} aria-label={`${it.n ? `第 ${it.n} 步 ` : ''}${it.title}，${s.label}`}
                    aria-current={active ? 'step' : undefined} title={`${it.title} · ${s.label}`}
                    style={{ ...railBtn, fontWeight: active ? 700 : 400, color: active ? 'var(--brand)' : 'var(--ink-soft)', background: active ? 'var(--brand-tint)' : 'transparent' }}>
              {it.n ?? '项'}
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <nav aria-label="课程步骤" style={{
      width: 236, flex: 'none', background: 'var(--panel)', borderRight: '1px solid var(--border)',
      padding: '12px 12px 0', display: 'flex', flexDirection: 'column',
    }} className="scroll-y">
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>本课步骤</span>
        <span style={{ flex: 1 }} />
        <button onClick={onToggle} aria-label="收起步骤导航" title="收起" style={{ ...railBtn, width: 26, height: 26, fontSize: 13 }}>«</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((it, i) => {
          const s = statusOf(it.id)
          const t = TONE[s.key] ?? TONE.unverified
          const active = it.id === currentId
          const heading = it.chapter && it.chapter !== items[i - 1]?.chapter ? it.chapter : null
          return (
            <React.Fragment key={it.id}>
              {heading && (
                <div style={{ fontSize: 11.5, color: 'var(--muted-light)', padding: i ? '12px 6px 4px' : '0 6px 4px' }}>{heading}</div>
              )}
              <button data-concept={it.id} data-status={s.key} onClick={() => onSelect(it.id)}
                aria-current={active ? 'step' : undefined} title={s.suggest ? `建议先学「${s.suggest}」；也可以直接打开` : undefined}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 10px',
                  borderRadius: 9, border: 'none', textAlign: 'left',
                  background: active ? 'var(--brand-tint)' : 'transparent',
                }}>
                <span aria-hidden="true" style={{
                  width: 16, height: 16, flex: 'none', marginTop: 2, borderRadius: '50%',
                  background: t.dot, border: `1.5px solid ${t.ring}`, color: '#fff',
                  fontSize: 10, lineHeight: '13px', textAlign: 'center',
                }}>{t.symbol}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'block', fontSize: 13, lineHeight: 1.45,
                    fontWeight: active ? 700 : 400,
                    color: active ? 'var(--brand)' : 'var(--ink-soft)',
                  }}>
                    {it.n ? `${it.n}. ` : ''}{it.title}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, marginTop: 2, color: s.key === 'verified' || s.key === 'transfer' || s.key === 'done' ? 'var(--ok-deep)' : 'var(--muted)' }}>
                    {s.label}{s.review ? ' · 待复习' : ''}
                  </span>
                  {s.suggest && active && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--muted-light)', marginTop: 2 }}>
                      建议先学「{s.suggest}」
                    </span>
                  )}
                </span>
              </button>
            </React.Fragment>
          )
        })}
      </div>

      <div style={{ flex: 1, minHeight: 20 }} />
      <div style={{
        borderTop: '1px solid var(--border-soft)', padding: '12px 4px 16px',
        fontSize: 11.5, color: 'var(--muted-light)', lineHeight: 1.7,
      }}>
        每一步都可以直接打开。标记只反映证据：{CAP_SHORT.verified}需要在没见过的新题上独立答对，
        浏览或做引导练习不会改变它。记录保存在本机浏览器，可随时导出。
      </div>
    </nav>
  )
}

const railBtn = {
  width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: '#fff',
  color: 'var(--ink-soft)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
}
