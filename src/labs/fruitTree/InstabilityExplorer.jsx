/**
 * Step 7: pick another batch of fruit from the same orchard and grow the tree
 * again.
 *
 * Every earlier step used one training set, which quietly suggests that "the
 * tree" is a fixed thing. Here the learner draws more batches — same rule, same
 * noise, different fruit — and watches the root stay put while everything below
 * it drifts. The chart underneath measures the drift on 600 fruits no tree has
 * seen, across all eight batches, so the learner's handful of draws can be
 * checked against the whole picture.
 *
 * All figures come from instability.js, which the course tests pin.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { snapshot, profile, BATCH_COUNT } from './instability.js'
import { DEPTHS, TRAIN } from './dataset.js'
import TreeView from './TreeView.jsx'
import { useScreen } from '../screen.js'
import { Card, Stat, Chip, Button, Choice, Feedback, Slider } from '../../components/ui.jsx'

const pct = (v) => `${(v * 100).toFixed(1)}%`

/**
 * "How often will two depth-8 trees from different batches disagree?" Scored
 * against the eight-batch figure the chart below shows.
 */
const GUESSES = [
  { label: '几乎从不——算法是确定的', value: 0, misconception: 'deterministic_means_stable' },
  { label: '大约 1% 的水果', value: 0.01 },
  { label: '大约 13% 的水果', value: 0.13 },
  { label: '大约一半的水果', value: 0.5 },
]

export default function InstabilityExplorer({ onEvidence, onScreen }) {
  const [depth, setDepth] = useState(8)
  const [k, setK] = useState(1)
  const [guess, setGuess] = useState(null)
  const [explored, setExplored] = useState(false)

  const s = useMemo(() => snapshot(depth, k), [depth, k])
  const prof = useMemo(() => profile(DEPTHS), [])
  const deep = prof.find((p) => p.d === 8).disagree
  const right = GUESSES.reduce((a, b) => (Math.abs(b.value - deep) < Math.abs(a.value - deep) ? b : a))

  const answer = (g) => {
    if (guess) return
    setGuess(g)
    const correct = g === right
    onEvidence({
      kind: 'labAction',
      correct,
      misconceptionId: correct ? null : (g.misconception ?? null),
      detail: { labStep: 'guess-disagreement', guess: g.value },
      description: correct
        ? `预测两棵 depth 8 的树会在大约 13% 的新水果上意见不同，实际 ${pct(deep)}`
        : `预测「${g.label}」，实际两两之间平均在 ${pct(deep)} 的新水果上意见不同`,
      facts: prof.map((p) => `depth ${p.d}：8 批数据的树两两之间，平均在 ${pct(p.disagree)} 的新水果上判得不一样`),
    })
  }

  // Drawing a few batches is the exploration this step asks for.
  useEffect(() => {
    if (explored || k < 3) return
    setExplored(true)
    onEvidence({
      kind: 'labExplore',
      correct: true,
      detail: { labStep: 'draw-batches', k, depth },
      description: `摘了 ${k} 批数据，比较了 depth ${depth} 的树`,
      facts: [`${k} 批数据的 depth ${depth} 树：叶子数 ${s.leafRange[0]} 到 ${s.leafRange[1]}`],
    })
  }, [explored, k, depth, s.leafRange, onEvidence])

  useScreen(onScreen, {
    doing: !guess
      ? '在预测换一批数据后，两棵树会在多少新水果上意见不同'
      : `在比较同一果园 ${k} 批数据长出的 depth ${depth} 树`,
    facts: [
      ...s.items.map((x) => `第 ${x.i + 1} 批：根节点「${x.root}」${x.second ? `，第二刀「${x.second}」` : ''}，${x.leaves} 个叶子，验证误差 ${pct(x.va)}`),
      ...(k > 1 ? [
        `这 ${k} 棵树两两之间，平均在 ${pct(s.disagree)} 的新水果上判得不一样`,
        `这 ${k} 棵树投票的验证误差 ${pct(s.voteVa)}，单棵平均 ${pct(s.meanVa)}`,
      ] : []),
      ...(guess ? prof.map((p) => `depth ${p.d}：8 批数据两两意见不同的比例 ${pct(p.disagree)}`) : []),
    ],
    moment: k >= 3 && depth >= 5 ? {
      id: 'batches-drift',
      text: `已经摘了 ${k} 批：根节点每次都是「${s.items[0].root}」${s.sameRoot ? '' : '（有一批例外）'}，可叶子数从 ${s.leafRange[0]} 到 ${s.leafRange[1]} 都有。`,
      ask: '为什么根节点这么稳，下面却各长各的？',
    } : null,
  })

  const maxBar = Math.max(...prof.map((p) => p.disagree))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!guess ? (
        <Card title="先预测">
          <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 12 }}>
            同一个果园再摘一批 {TRAIN.length} 个水果，用完全一样的设置（depth 8）再建一棵树。
            拿 600 个新水果去问这两棵树，大约多少水果会被它们判成<b>不一样</b>的类别？
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {GUESSES.map((g) => <Choice key={g.label} label={g.label} onClick={() => answer(g)} />)}
          </div>
        </Card>
      ) : (
        <Feedback tone={guess === right ? 'ok' : 'warn'} title={`实际是 ${pct(deep)}`}>
          {guess === right ? '猜对了。' : `你猜的是「${guess.label}」。`}
          8 批数据各建一棵 depth 8 的树，任意两棵平均在 {pct(deep)} 的新水果上意见不同。
          算法对同一份数据是确定的，可它对数据本身很敏感。下面自己摘几批看看，哪里变、哪里不变。
        </Feedback>
      )}

      <Card title="同一个果园，不同的批次">
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Slider label="max_depth" value={depth} min={1} max={8} onChange={setDepth} disabled={!guess}
                    note={!guess ? '先回答上面的预测' : undefined} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" disabled={!guess || k >= BATCH_COUNT} onClick={() => setK((n) => Math.min(BATCH_COUNT, n + 1))}>
              {k >= BATCH_COUNT ? `${BATCH_COUNT} 批都摘完了` : '再摘一批'}
            </Button>
            <Button variant="quiet" disabled={!guess || k === 1} onClick={() => setK(1)}>只留第 1 批</Button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
          <Stat label="已摘批次" value={`${k} / ${BATCH_COUNT}`} />
          <Stat label="根节点" value={k === 1 ? '—' : s.sameRoot ? '都一样' : '不一样'} sub={s.items[0].root}
                tone={k === 1 ? undefined : s.sameRoot ? 'var(--ok-deep)' : 'var(--bad)'} />
          <Stat label="叶子数" value={s.leafRange[0] === s.leafRange[1] ? s.leafRange[0] : `${s.leafRange[0]}–${s.leafRange[1]}`} />
          <Stat label="两两意见不同" value={k > 1 ? pct(s.disagree) : '—'} sub={k > 1 ? '600 个新水果上' : '至少要两批'} />
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {s.items.map((x) => (
          <div key={x.i} className="panel fade-up" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-strong)' }}>第 {x.i + 1} 批</span>
              {x.i === 0 && <Chip tone="neutral">前面几步用的就是这批</Chip>}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{x.leaves} 个叶子 · 验证误差 {pct(x.va)}</span>
            </div>
            <TreeView tree={x.tree} width={420} height={170} compact pad={36} />
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
              根：{x.root}{x.second ? ` · 第二刀：${x.second}` : ''}
            </div>
          </div>
        ))}
      </div>

      {k >= 3 && (
        <Feedback tone="neutral" title={`让这 ${k} 棵树投票`}>
          每个新水果让 {k} 棵树各判一次，少数服从多数。投票的验证误差是 <b>{pct(s.voteVa)}</b>，
          单棵树平均是 {pct(s.meanVa)}。
          {s.voteVa < s.meanVa - 1e-9
            ? '每棵树都在自己那批数据的偶然波动上犯错，而这些错误不太重合，多数票把它们冲掉了——这正是随机森林的出发点。'
            : '这么浅的树之间本来就几乎一样，犯的错也一样，投票帮不上忙。把深度调大再看：投票救的正是深树的不稳定。'}
        </Feedback>
      )}

      {guess && (
        <Card title="8 批数据的全貌：越深越不稳">
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
            每个深度都用 8 批数据各建一棵树，统计任意两棵在 600 个新水果上意见不同的平均比例。
          </div>
          <svg viewBox="0 0 900 210" style={{ width: '100%', display: 'block' }} role="img" aria-label="不同深度下，树之间意见不同的比例">
            {prof.map((p, i) => {
              const h = (p.disagree / maxBar) * 140
              const x = 60 + i * 102
              const on = p.d === depth
              return (
                <g key={p.d}>
                  <rect x={x} y={170 - h} width={62} height={h} rx={5}
                        fill={on ? 'var(--brand)' : 'var(--brand-line)'} />
                  <text x={x + 31} y={162 - h} fontSize={12} textAnchor="middle" className="mono"
                        fill={on ? 'var(--brand)' : 'var(--muted)'}>{pct(p.disagree)}</text>
                  <text x={x + 31} y={192} fontSize={12} textAnchor="middle" fill="var(--muted)">depth {p.d}</text>
                </g>
              )
            })}
          </svg>
        </Card>
      )}
    </div>
  )
}
