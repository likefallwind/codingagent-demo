/**
 * SVG tree renderer, shared by every step that draws a tree.
 *
 * Two modes. Below about ten leaves each node is drawn as a labelled box you can
 * read the question off. Past that the labels stop fitting and the tree switches
 * to dots — at which point the shape IS the message: step 4's whole point is
 * that a depth-8 tree has 41 leaves and is no longer something a person reads.
 */

import React from 'react'
import { APPLE } from './dataset.js'
import { leafCount, treeDepth, splitLabel } from './cart.js'

/**
 * Compute node positions.
 *
 * Leaves are laid out left to right in traversal order, each taking one slot;
 * an internal node sits at the midpoint of its two children. That keeps edges
 * from crossing without needing a general graph layout.
 */
export function layoutTree(tree, width, height, opts = {}) {
  const edges = []
  const internals = []
  const leaves = []

  const nLeaf = leafCount(tree)
  const dMax = Math.max(1, treeDepth(tree))
  const compact = opts.compact ?? nLeaf > 10
  const levelH = (height - (opts.pad ?? 50)) / dMax
  const slot = (width - 70) / nLeaf
  const nodeW = compact ? 0 : Math.min(150, slot * 1.7)
  const fs = compact ? 0 : Math.max(9.5, Math.min(12.5, slot / 9))

  let idx = 0

  function walk(n, depth, path) {
    const y = 26 + depth * levelH
    if (!n.split) {
      const x = 35 + (idx + 0.5) * slot
      idx++
      leaves.push({
        key: path, cx: +x.toFixed(1), cy: +y.toFixed(1),
        r: compact ? 4.2 : 9,
        fill: n.cls === APPLE ? 'var(--apple)' : 'var(--orange)',
        label: compact ? '' : String(n.n),
        ty: +(y + (compact ? 0 : 24)).toFixed(1),
        fs: compact ? 0 : 11,
        node: n,
      })
      return { x, y }
    }

    const l = walk(n.left, depth + 1, `${path}L`)
    const r = walk(n.right, depth + 1, `${path}R`)
    const x = (l.x + r.x) / 2
    const dy = compact ? 6 : 15
    const cdy = compact ? 5 : 14
    edges.push({ key: `${path}-l`, d: `M${x.toFixed(1)} ${(y + dy).toFixed(1)}L${l.x.toFixed(1)} ${(l.y - cdy).toFixed(1)}` })
    edges.push({ key: `${path}-r`, d: `M${x.toFixed(1)} ${(y + dy).toFixed(1)}L${r.x.toFixed(1)} ${(r.y - cdy).toFixed(1)}` })

    internals.push(compact
      ? { key: path, compact: true, cx: +x.toFixed(1), cy: +y.toFixed(1), node: n }
      : {
          key: path, compact: false,
          x: +(x - nodeW / 2).toFixed(1), y: +(y - 14).toFixed(1),
          w: +nodeW.toFixed(1), h: 28,
          tx: +x.toFixed(1), ty: +(y + 4).toFixed(1),
          fs: +fs.toFixed(1),
          label: splitLabel(n.split.key, n.split.thr),
          node: n,
        })
    return { x, y }
  }

  walk(tree, 0, 'r')
  return { edges, internals, leaves, compact, nLeaf, depth: dMax }
}

export default function TreeView({
  tree, width = 900, height = 300, compact, pad, onNodeClick, highlightPath, className,
}) {
  const L = layoutTree(tree, width, height, { compact, pad })
  const hi = new Set(highlightPath ?? [])

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      role="img"
      aria-label={`决策树，深度 ${L.depth}，${L.nLeaf} 个叶子`}
    >
      {L.edges.map((e) => (
        <path key={e.key} d={e.d} stroke={hi.has(e.key) ? 'var(--brand)' : '#c6d6f2'}
              strokeWidth={hi.has(e.key) ? 2.4 : 1.6} fill="none" />
      ))}

      {L.internals.map((n) => (n.compact ? (
        <circle key={n.key} cx={n.cx} cy={n.cy} r={3.4} fill="#9fb8e8" />
      ) : (
        <g key={n.key} onClick={onNodeClick ? () => onNodeClick(n.node, n.key) : undefined}
           style={{ cursor: onNodeClick ? 'pointer' : 'default' }}>
          <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={9}
                fill={hi.has(n.key) ? 'var(--brand-tint)' : '#fff'}
                stroke={hi.has(n.key) ? 'var(--brand)' : 'var(--brand-line-soft)'}
                strokeWidth={hi.has(n.key) ? 2 : 1.4} />
          <text x={n.tx} y={n.ty} fontSize={n.fs} textAnchor="middle" fill="var(--ink-mid)">{n.label}</text>
        </g>
      )))}

      {L.leaves.map((n) => (
        <g key={n.key} onClick={onNodeClick ? () => onNodeClick(n.node, n.key) : undefined}
           style={{ cursor: onNodeClick ? 'pointer' : 'default' }}>
          <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.fill}
                  stroke={hi.has(n.key) ? 'var(--brand)' : 'none'} strokeWidth={hi.has(n.key) ? 2.5 : 0} />
          {n.label ? (
            <text x={n.cx} y={n.ty} fontSize={n.fs} textAnchor="middle" fill="var(--muted)">{n.label}</text>
          ) : null}
        </g>
      ))}
    </svg>
  )
}
