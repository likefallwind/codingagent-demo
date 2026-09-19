/**
 * Left rail: the course's concepts, their state, and the learner's mastery.
 *
 * The linear spine stays visible — people want to know where they are in a
 * lesson — while the dot and the bar show what the engine actually believes,
 * which is what makes the adaptivity legible rather than mysterious.
 */

import React from 'react'
import { MASTERY_THRESHOLD } from '../engine/learnerModel.js'

const TONE = {
  mastered: { dot: 'var(--ok)', ring: 'var(--ok-line)', fg: 'var(--ink-soft)', label: '已掌握' },
  learning: { dot: 'var(--brand)', ring: 'var(--brand-line)', fg: 'var(--ink-strong)', label: '学习中' },
  available: { dot: '#fff', ring: 'var(--brand-line-soft)', fg: 'var(--ink-soft)', label: '可开始' },
  locked: { dot: '#fff', ring: 'var(--border)', fg: 'var(--muted-light)', label: '未解锁' },
}

export default function ConceptNav({ course, learner, statusOf, currentId, onSelect }) {
  return (
    <aside style={{
      width: 236, flex: 'none', background: 'var(--panel)', borderRight: '1px solid var(--border)',
      padding: '14px 14px 0', display: 'flex', flexDirection: 'column',
    }} className="scroll-y">
      <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '0 4px', marginBottom: 10 }}>本课概念</div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {course.concepts.map((c, i) => {
          const status = statusOf(c.id)
          const t = TONE[status]
          const active = c.id === currentId
          const mastery = learner.concepts[c.id]?.mastery ?? 0
          const locked = status === 'locked'
          const needs = (c.prerequisites ?? []).map((p) => course.concepts.find((x) => x.id === p)?.shortTitle ?? p)
          // A chapter heading wherever the chapter changes, so the advanced
          // section reads as a branch rather than steps 8-10 of the main line.
          const heading = c.chapter && c.chapter !== course.concepts[i - 1]?.chapter ? c.chapter : null
          return (
            <React.Fragment key={c.id}>
            {heading && (
              <div style={{ fontSize: 11.5, color: 'var(--muted-light)', padding: i ? '12px 6px 4px' : '0 6px 4px' }}>{heading}</div>
            )}
            <button data-concept={c.id} data-status={status} onClick={() => !locked && onSelect(c.id)} disabled={locked}
              title={locked ? `需要先掌握：${needs.join('、')}` : undefined}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 10px',
                borderRadius: 9, border: 'none', textAlign: 'left',
                background: active ? 'var(--brand-tint)' : 'transparent',
                cursor: locked ? 'not-allowed' : 'pointer',
              }}>
              <span style={{
                width: 15, height: 15, flex: 'none', marginTop: 2, borderRadius: '50%',
                background: t.dot, border: `1.5px solid ${t.ring}`,
              }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 13, lineHeight: 1.45,
                  fontWeight: active ? 700 : 400,
                  color: active ? 'var(--brand)' : t.fg,
                }}>
                  {i + 1}. {c.shortTitle ?? c.title}
                </span>
                {!locked && (
                  <span style={{ display: 'block', marginTop: 5 }}>
                    <span style={{ display: 'block', height: 3, borderRadius: 2, background: 'var(--border-soft)' }}>
                      <span style={{
                        display: 'block', height: '100%', borderRadius: 2,
                        width: `${Math.min(100, (mastery / MASTERY_THRESHOLD) * 100)}%`,
                        background: status === 'mastered' ? 'var(--ok)' : 'var(--brand)',
                        transition: 'width .3s ease',
                      }} />
                    </span>
                  </span>
                )}
                {locked && (
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted-light)', marginTop: 3 }}>
                    先掌握「{needs.join('、')}」
                  </span>
                )}
              </span>
            </button>
            </React.Fragment>
          )
        })}
      </nav>

      <div style={{ flex: 1, minHeight: 20 }} />
      <div style={{
        borderTop: '1px solid var(--border-soft)', padding: '14px 4px 18px',
        fontSize: 11.5, color: 'var(--muted-light)', lineHeight: 1.7,
      }}>
        掌握度到 {Math.round(MASTERY_THRESHOLD * 100)}%、这一步的每道题都做对过，才会解锁下一个。
        进度保存在本机浏览器里。
      </div>
    </aside>
  )
}
