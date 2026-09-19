/**
 * Small presentational primitives shared across the labs. Kept deliberately
 * plain: they carry the design's tokens and nothing else, so a lab's own file
 * stays about the teaching rather than about padding.
 */

import React from 'react'

export function Card({ title, right, children, style, pad = 16 }) {
  return (
    <div className="panel" style={{ padding: pad, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {title && <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-strong)' }}>{title}</div>}
          <div style={{ flex: 1 }} />
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

/** A labelled number. `tone` tints the value for good/bad readings. */
export function Stat({ label, value, tone, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 500, color: tone ?? 'var(--ink-strong)', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted-light)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

/** Horizontal impurity bar. Gini maxes at 0.5, so that is full width. */
export function GiniBar({ value, max = 0.5, color = 'var(--brand)' }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100
  return (
    <div style={{ height: 6, borderRadius: 3, background: '#eef2f9', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .25s ease' }} />
    </div>
  )
}

export function Chip({ children, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: 'var(--bg)', fg: 'var(--muted)', bd: 'var(--border)' },
    brand: { bg: 'var(--brand-tint)', fg: 'var(--brand)', bd: 'var(--brand-line)' },
    ok: { bg: 'var(--ok-bg)', fg: 'var(--ok-deep)', bd: 'var(--ok-line)' },
    warn: { bg: 'var(--warn-bg)', fg: 'var(--warn)', bd: 'var(--warn-line)' },
    bad: { bg: 'var(--bad-bg)', fg: 'var(--bad)', bd: 'var(--bad-line)' },
  }[tone]
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 500, color: tones.fg, background: tones.bg,
      border: `1px solid ${tones.bd}`, borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export function Button({ children, variant = 'ghost', onClick, disabled, style }) {
  const base = {
    height: 38, padding: '0 16px', borderRadius: 10, fontSize: 13.5, fontWeight: 500,
    transition: 'background .15s, border-color .15s', opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
  const variants = {
    primary: { background: 'var(--brand)', color: '#fff', border: '1px solid var(--brand)' },
    ghost: { background: '#fff', color: 'var(--brand)', border: '1px solid var(--brand-line)' },
    quiet: { background: '#fff', color: 'var(--ink-soft)', border: '1px solid var(--border)' },
  }
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
            style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

/** Choice tile used wherever the learner picks a feature or an option. */
export function Choice({ label, hint, selected, tone, onClick, disabled }) {
  const border = tone === 'ok' ? 'var(--ok-line)' : tone === 'warn' ? 'var(--warn-line)' : selected ? 'var(--brand)' : 'var(--brand-line-soft)'
  const bg = tone === 'ok' ? 'var(--ok-bg)' : tone === 'warn' ? 'var(--warn-bg)' : selected ? 'var(--brand-tint)' : '#fff'
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{
        textAlign: 'left', padding: '11px 13px', borderRadius: 10,
        border: `1.5px solid ${border}`, background: bg,
        color: selected ? 'var(--brand)' : 'var(--ink-soft)',
        fontSize: 13.5, fontWeight: selected ? 500 : 400, width: '100%',
        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color .15s, background .15s',
      }}>
      <div>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}
    </button>
  )
}

/**
 * Feedback banner. `tone` is decided by the deterministic layer, never by the
 * language model — the colour has to be right even when the tutor call fails.
 */
export function Feedback({ tone = 'neutral', title, children, style }) {
  const t = {
    neutral: { bg: '#f6f8fc', bd: 'var(--border-soft)', fg: 'var(--ink-mid)', dot: 'var(--muted)' },
    ok: { bg: 'var(--ok-bg)', bd: 'var(--ok-line)', fg: 'var(--ok-deep)', dot: 'var(--ok)' },
    warn: { bg: 'var(--warn-bg)', bd: 'var(--warn-line)', fg: '#8a6414', dot: 'var(--warn)' },
    bad: { bg: 'var(--bad-bg)', bd: 'var(--bad-line)', fg: 'var(--bad)', dot: 'var(--bad)' },
  }[tone]
  return (
    <div className="fade-up" style={{
      background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 11, padding: '12px 14px', ...style,
    }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.dot }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: t.fg }}>{title}</span>
        </div>
      )}
      <div style={{ fontSize: 13, lineHeight: 1.85, color: 'var(--ink-mid)', textWrap: 'pretty' }}>{children}</div>
    </div>
  )
}

/**
 * Labelled slider — the lesson's parameters are all one of these. `disabled`
 * holds it still while the lab waits for a prediction.
 */
export function Slider({ label, value, min, max, step = 1, onChange, display, note, disabled }) {
  return (
    <div style={{ opacity: disabled ? 0.45 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 15, fontWeight: 500, color: 'var(--brand)' }}>{display ?? value}</span>
        <div style={{ flex: 1 }} />
        {note && <span style={{ fontSize: 11.5, color: 'var(--muted-light)' }}>{note}</span>}
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
             onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  )
}
