/**
 * Top bar: the course, verified capabilities, the save state, and the record.
 *
 * The save state is always visible and never optimistic: "未保存" with a retry
 * and a download when a write failed, so a learner is not told their work is
 * safe when it is not.
 */

import React from 'react'

export default function Header({ course, progress, saveState, onRetrySave, onExport, onProfile, onReset }) {
  const save = {
    saved: { text: '已保存到本机', color: 'var(--muted)' },
    saving: { text: '保存中…', color: 'var(--muted)' },
    failed: { text: `未保存：${saveState.error ?? '写入失败'}`, color: 'var(--bad)' },
  }[saveState.status] ?? { text: '', color: 'var(--muted)' }
  return (
    <header style={{
      minHeight: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      padding: '6px 18px', background: 'var(--panel)', borderBottom: '1px solid var(--border)',
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
        }}>试点版</span>
      </div>
      <div style={{ width: 1, height: 22, background: 'var(--border)' }} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-strong)' }}>{course.title}</span>
      <div style={{ flex: 1 }} />
      <button onClick={onProfile} data-testid="open-profile" style={linkBtn}>
        能力档案 · 已独立验证 <span className="mono" style={{ color: 'var(--ink-strong)' }}>{progress.verified}</span> / {progress.capabilities}
      </button>
      <span role="status" data-testid="save-state" data-status={saveState.status} style={{ fontSize: 12, color: save.color, display: 'flex', alignItems: 'center', gap: 8 }}>
        {saveState.status === 'failed' && <span aria-hidden="true">⚠</span>}
        {save.text}
        {saveState.status === 'failed' && (
          <>
            <button onClick={onRetrySave} style={smallBtn}>重试保存</button>
            <button onClick={onExport} style={smallBtn}>下载当前记录</button>
          </>
        )}
      </span>
      <button onClick={onExport} data-testid="export" style={smallBtn} title="导出任务版本、作答与评分证据、帮助记录和作品，供老师检查">导出记录</button>
      <button onClick={onReset} style={smallBtn}>重置进度</button>
    </header>
  )
}

const smallBtn = {
  background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
  padding: '5px 10px', fontSize: 12.5, color: 'var(--ink-soft)',
}
const linkBtn = { ...smallBtn, color: 'var(--muted)', borderColor: 'var(--brand-line-soft)' }
