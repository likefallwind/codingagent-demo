import React from 'react'

export default function Header({ course, courses, onCourseChange, progress, onReset }) {
  return (
    <header style={{
      height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 18,
      padding: '0 22px', background: 'var(--panel)', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#EAF1FF" />
          <path d="M8 15.5 15.5 7.5 13.6 13.2h3L9.2 20l2-6.3H8Z" fill="var(--brand)" />
        </svg>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.2px' }}>LearnAI</span>
        <span style={{
          fontSize: 11, fontWeight: 500, color: 'var(--brand)', background: 'var(--brand-tint-2)',
          borderRadius: 5, padding: '2px 6px',
        }}>Beta</span>
      </div>
      <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
      <select
        value={course.id}
        onChange={(e) => onCourseChange(e.target.value)}
        aria-label="选择课程"
        style={{
          border: '1px solid var(--border)', borderRadius: 8, padding: '5px 9px',
          fontSize: 13, color: 'var(--ink-mid)', background: '#fff', fontFamily: 'inherit',
          maxWidth: 260,
        }}>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      <div style={{ fontSize: 12.5, color: 'var(--muted-light)' }}>{course.subtitle}</div>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        已掌握 <span className="mono" style={{ color: 'var(--ink-strong)' }}>{progress.mastered}</span> / {progress.total} 个概念
      </div>
      <button onClick={onReset} style={{
        background: 'none', border: '1px solid var(--border)', borderRadius: 8,
        padding: '5px 11px', fontSize: 12.5, color: 'var(--muted)',
      }}>重置进度</button>
    </header>
  )
}
