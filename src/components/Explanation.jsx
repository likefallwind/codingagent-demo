/**
 * The layered explanation, on demand. The intuition is a short paragraph that
 * is always there; the example and the formal definition unfold when asked, so
 * the lab sits near the top of the page instead of below a wall of text.
 */

import React from 'react'
import { Card, Chip } from './ui.jsx'
import { LAYERS } from '../engine/policy.js'

const LABEL = { intuition: '直觉', example: '例子', formal: '形式化' }

export default function Explanation({ concept, open, onToggle, suggested }) {
  return (
    <Card title="讲解" data-object="explain" pad={14}>
      {LAYERS.map((layer) => {
        const body = concept.explain[layer]
        if (!body) return null
        const always = layer === 'intuition'
        const isOpen = always || open.includes(layer)
        return (
          <div key={layer} data-layer={layer} style={{
            borderTop: always ? 'none' : '1px solid var(--border-faint)',
            paddingTop: always ? 0 : 10, marginTop: always ? 0 : 10,
          }}>
            {always ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <Chip tone="brand">{LABEL[layer]}</Chip>
                <div style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-mid)', textWrap: 'pretty' }}>{body}</div>
              </div>
            ) : (
              <>
                <button onClick={() => onToggle(layer)} aria-expanded={isOpen}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, marginBottom: isOpen ? 8 : 0 }}>
                  <Chip tone={isOpen ? 'brand' : 'neutral'}>{LABEL[layer]}</Chip>
                  {suggested === layer && <Chip tone="warn">换个角度再看一遍</Chip>}
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{isOpen ? '收起' : '展开'}</span>
                </button>
                {isOpen && (
                  <div className="fade-up" style={{ fontSize: 13.5, lineHeight: 1.95, color: 'var(--ink-mid)', textWrap: 'pretty' }}>{body}</div>
                )}
              </>
            )}
          </div>
        )
      })}
    </Card>
  )
}
