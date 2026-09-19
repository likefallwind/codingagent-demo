/**
 * The ID3 chapter's three labs, one per concept, all on Quinlan's play-tennis
 * table:
 *
 *   EntropyExplorer    — entropy as a ruler, next to gini and the error rate,
 *                        then per-branch entropy for each feature
 *   IdTrapExplorer     — the Day column wins, and one plain question shows
 *                        why that is worthless: what does it say about day 15?
 *   GainRatioExplorer  — gain ratio narrows the gap but does not close it;
 *                        a structural guard does, if its threshold is sane
 *
 * Everything on screen is computed by ../decisionTree/algo.js, which the tests
 * pin to the published figures. Each lab hides the number it asks the learner
 * to predict until they have committed, and reports only what is visible.
 */

import React, { useEffect, useMemo, useState } from 'react'
import {
  entropy, partition, infoGain, splitInfo, gainRatio, rankFeatures, weightedImpurity,
  buildTree, accuracy, meanBranchSize, majority, counts,
} from '../decisionTree/algo.js'
import { playTennis as ds } from '../decisionTree/datasets.js'
import { useScreen } from '../screen.js'
import { Card, Stat, Chip, Choice, Feedback, Slider } from '../../components/ui.jsx'

const f3 = (v) => v.toFixed(3)
const f4 = (v) => v.toFixed(4)
const T = ds.target
// The lessons call the identifier column "Day" throughout; the dataset's
// Chinese label for it (日期) would make the lab and the text disagree.
const L = (f) => (f === 'Day' ? 'Day' : ds.labels[f] ?? f)
const V = (v) => ds.valueLabels[v] ?? v
const yesNo = (rows) => {
  const c = counts(rows, T)
  return { yes: c.get('Yes') ?? 0, no: c.get('No') ?? 0 }
}
const log2 = (x) => Math.log(x) / Math.LN2
const h2 = (p) => [p, 1 - p].reduce((h, q) => (q > 0 ? h - q * log2(q) : h), 0)

// ================================================================ concept 8

export function EntropyExplorer({ onEvidence, onScreen }) {
  const [k, setK] = useState(9)
  const [feat, setFeat] = useState('Outlook')
  const [guess, setGuess] = useState(null)

  const n = ds.rows.length
  const p = k / n
  const H = h2(p)
  const G = 1 - p * p - (1 - p) * (1 - p)
  const E = Math.min(p, 1 - p)

  const parts = useMemo(() => [...partition(ds.rows, feat)].map(([v, rows]) => ({ v, rows, ...yesNo(rows), h: entropy(rows, T) })), [feat])
  const ranking = useMemo(() => rankFeatures(ds.rows, ds.features, T, 'infoGain'), [])
  const best = ranking[0].feature

  const commit = (f) => {
    if (guess) return
    setGuess(f)
    const correct = f === best
    onEvidence({
      kind: 'labAction',
      correct,
      detail: { labStep: 'guess-best-gain', guess: f },
      description: correct
        ? `猜对了：${L(best)}的信息增益最高（${f3(ranking[0].infoGain)}）`
        : `猜${L(f)}的信息增益最高，实际是${L(best)}（${f3(ranking[0].infoGain)}），${L(f)}只有 ${f3(infoGain(ds.rows, f, T))}`,
      facts: ranking.map((r) => `${L(r.feature)}：分裂后加权熵 ${f3(weightedImpurity(ds.rows, r.feature, T))}，信息增益 ${f3(r.infoGain)}`),
    })
  }

  useScreen(onScreen, {
    doing: guess ? `在看按「${L(feat)}」切开后各分支的熵` : `在看按「${L(feat)}」切开后各分支的熵，还没猜哪个特征增益最高`,
    facts: [
      `滑块：${n} 天里 ${k} 天打球，熵 ${f3(H)} bit，基尼 ${f3(G)}，全猜多数类的错误率 ${f3(E)}`,
      `整个数据集 9 打 / 5 不打，熵 ${f3(entropy(ds.rows, T))} bit`,
      `按「${L(feat)}」切：${parts.map((x) => `${V(x.v)} ${x.yes} 打 / ${x.no} 不打（熵 ${f3(x.h)}）`).join('；')}`,
      ...(guess ? ranking.map((r) => `${L(r.feature)} 信息增益 ${f3(r.infoGain)}`) : []),
    ],
    moment: k * 2 === n ? {
      id: 'half-half',
      text: `打球和不打各 ${k} 天：熵到了最大值 1 bit，基尼是 0.500，全猜多数类的错误率也是 0.500。三个数都在这里到顶，但它们量的不是同一件事。`,
      ask: '熵、基尼和错误率到底有什么区别？',
    } : null,
  })

  // Curves on p ∈ [0, 1]: entropy peaks at 1, gini and the error rate at 0.5.
  const W = 420
  const Hh = 170
  const x = (q) => 40 + q * (W - 60)
  const y = (v) => 20 + (1 - v) * (Hh - 40)
  const curve = (fn) => Array.from({ length: 101 }, (_, i) => i / 100)
    .map((q, i) => `${i ? 'L' : 'M'}${x(q).toFixed(1)} ${y(fn(q)).toFixed(1)}`).join(' ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="三把尺子量同一堆数据">
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Slider label="14 天里打球的天数" value={k} min={0} max={n} onChange={setK} display={`${k} / ${n}`} />
            <div style={{ display: 'flex', gap: 16, marginTop: 18 }}>
              <Stat label="熵" value={f3(H)} sub="bit" tone="var(--brand)" />
              <Stat label="基尼" value={f3(G)} tone="var(--orange-deep)" />
              <Stat label="全猜多数类的错误率" value={f3(E)} tone="var(--muted)" />
            </div>
          </div>
          <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: 420, maxWidth: '100%' }} role="img" aria-label="熵、基尼和错误率随打球比例变化">
            {[0, 0.5, 1].map((v) => (
              <g key={v}>
                <line x1={40} y1={y(v)} x2={W - 20} y2={y(v)} stroke="var(--border-soft)" />
                <text x={32} y={y(v) + 4} fontSize={10.5} textAnchor="end" fill="var(--muted-light)">{v}</text>
              </g>
            ))}
            <path d={curve(h2)} stroke="var(--brand)" strokeWidth={2.2} fill="none" />
            <path d={curve((q) => 1 - q * q - (1 - q) ** 2)} stroke="var(--orange)" strokeWidth={2} fill="none" />
            <path d={curve((q) => Math.min(q, 1 - q))} stroke="var(--muted-faint)" strokeWidth={2} strokeDasharray="4 4" fill="none" />
            <line x1={x(p)} y1={16} x2={x(p)} y2={Hh - 20} stroke="var(--ink-soft)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(p)} cy={y(H)} r={4} fill="var(--brand)" />
            <circle cx={x(p)} cy={y(G)} r={4} fill="var(--orange)" />
            <text x={x(0.5)} y={Hh - 4} fontSize={10.5} textAnchor="middle" fill="var(--muted-light)">打球的比例 →</text>
          </svg>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--brand)' }}>—— 熵</span>
          <span style={{ color: 'var(--orange-deep)' }}>—— 基尼</span>
          <span style={{ color: 'var(--muted)' }}>- - 错误率</span>
        </div>
      </Card>

      <Card title="按一个特征切开，看每个分支还有多乱">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {ds.features.map((f) => <Choice key={f} label={L(f)} selected={feat === f} onClick={() => setFeat(f)} />)}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {parts.map((x) => (
            <div key={x.v} style={{
              flex: 1, padding: 12, borderRadius: 10,
              background: x.h === 0 ? 'var(--ok-bg)' : 'var(--bg)',
              border: `1px solid ${x.h === 0 ? 'var(--ok-line)' : 'var(--border-soft)'}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>{L(feat)} = {V(x.v)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>{x.rows.length} 天 · {x.yes} 打 / {x.no} 不打</div>
              <div style={{ height: 6, borderRadius: 3, background: '#eef2f9', overflow: 'hidden' }}>
                <div style={{ width: `${x.h * 100}%`, height: '100%', background: x.h === 0 ? 'var(--ok)' : 'var(--brand)' }} />
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-mid)', marginTop: 5 }}>熵 {f3(x.h)}</div>
            </div>
          ))}
        </div>
        {guess && (
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 12 }} className="mono">
            加权熵 = {parts.map((x) => `${x.rows.length}/14×${f3(x.h)}`).join(' + ')} = {f3(weightedImpurity(ds.rows, feat, T))}；
            信息增益 = {f3(entropy(ds.rows, T))} − {f3(weightedImpurity(ds.rows, feat, T))} = {f3(infoGain(ds.rows, feat, T))}
          </div>
        )}
      </Card>

      {!guess ? (
        <Card title="先猜">
          <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 12 }}>
            上面四个特征都切过一遍了吗？看各分支的熵和大小，猜一猜：<b>哪个特征的信息增益最高？</b>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {ds.features.map((f) => <Choice key={f} label={L(f)} onClick={() => commit(f)} />)}
          </div>
        </Card>
      ) : (
        <Card title="四个特征的信息增益" right={<Chip tone={guess === best ? 'ok' : 'warn'}>{guess === best ? '你猜对了' : `你猜的是${L(guess)}`}</Chip>}>
          {ranking.map((r, i) => (
            <div key={r.feature} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
              <span style={{ width: 48, fontSize: 13, fontWeight: i === 0 ? 700 : 400 }}>{L(r.feature)}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#eef2f9' }}>
                <div style={{ width: `${(r.infoGain / ranking[0].infoGain) * 100}%`, height: '100%', borderRadius: 4, background: i === 0 ? 'var(--ok)' : 'var(--brand-line)' }} />
              </div>
              <span className="mono" style={{ width: 150, fontSize: 12.5, color: 'var(--ink-mid)' }}>
                增益 {f3(r.infoGain)} · 加权熵 {f3(weightedImpurity(ds.rows, r.feature, T))}
              </span>
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            天气的「阴」分支 4 天全打球，熵为 0——它一个人就把加权熵拉下来一大截。
          </div>
        </Card>
      )}
    </div>
  )
}

// ================================================================ concept 9

/** What the learner may believe the Day tree's answer for day 15 depends on. */
const DAY15_GUESSES = [
  { label: '第 15 天的天气、湿度和风', misconception: 'more_values_better' },
  { label: '什么都不看——它不认识 D15，每个新的一天都得到同一个答案', correct: true },
  { label: '和它天气最像的那一天' },
  { label: '日期最接近的那一天（D14）' },
]

/** One node of an ID3 tree as nested lines, for the side-by-side view. */
function TreeLines({ node, depth = 0 }) {
  if (node.kind === 'leaf') {
    return <span style={{ color: node.label === 'Yes' ? 'var(--ok-deep)' : 'var(--bad)', fontWeight: 700 }}>→ {V(node.label)}</span>
  }
  return (
    <div>
      {node.children.map((c) => (
        <div key={c.value} style={{ paddingLeft: depth ? 18 : 0, lineHeight: 1.9 }}>
          <span style={{ color: 'var(--ink-mid)' }}>{L(node.feature)} = {V(c.value)} </span>
          {c.node.kind === 'leaf' ? <TreeLines node={c.node} /> : <TreeLines node={c.node} depth={depth + 1} />}
        </div>
      ))}
    </div>
  )
}

/** The path a row takes through an ID3 tree, in words. */
function pathOf(tree, row) {
  const steps = []
  let node = tree
  while (node.kind === 'split') {
    const next = node.children.find((c) => c.value === row[node.feature])
    if (!next) {
      const y = yesNo(node.rows)
      steps.push(`找不到「${L(node.feature)} = ${row[node.feature]}」这个分支，只能退回多数（${y.yes} 打 / ${y.no} 不打）`)
      return { steps, label: majority(node.rows, T) }
    }
    steps.push(`${L(node.feature)} = ${V(row[node.feature])}`)
    node = next.node
  }
  return { steps, label: node.label }
}

export function IdTrapExplorer({ onEvidence, onScreen }) {
  const [day15, setDay15] = useState({ Outlook: 'Rain', Temperature: 'Mild', Humidity: 'High', Wind: 'Strong' })
  const [guess, setGuess] = useState(null)
  const [edits, setEdits] = useState(0)

  const withDay = [...ds.features, 'Day']
  const ranking = useMemo(() => rankFeatures(ds.rows, withDay, T, 'infoGain'), [])
  const dayTree = useMemo(() => buildTree(ds.rows, ['Day'], T), [])
  const realTree = useMemo(() => buildTree(ds.rows, ds.features, T), [])
  const row = { Day: 'D15', ...day15 }
  const dayPath = pathOf(dayTree, row)
  const realPath = pathOf(realTree, row)
  const values = (f) => [...new Set(ds.rows.map((r) => r[f]))]

  const commit = (g) => {
    if (guess) return
    setGuess(g)
    onEvidence({
      kind: 'labAction',
      correct: Boolean(g.correct),
      misconceptionId: g.correct ? null : (g.misconception ?? null),
      detail: { labStep: 'predict-day15', guess: g.label },
      description: g.correct
        ? '正确预测：Day 树对任何新的一天都给同一个答案'
        : `以为 Day 树对第 15 天的判断取决于「${g.label}」`,
      facts: [
        'Day 树只有一层，14 个叶子，每个叶子就是一天，训练集上 100% 正确',
        'Day 树遇到 D15 找不到分支，退回全体多数：9 打 / 5 不打，判「打」',
        `不用 Day 的树对第 15 天（${ds.features.map((f) => `${L(f)}${V(day15[f])}`).join('、')}）判「${V(realPath.label)}」`,
      ],
    })
  }

  const edit = (f, v) => {
    setDay15((d) => ({ ...d, [f]: v }))
    if (guess) setEdits((e) => e + 1)
  }

  const describe = ds.features.map((f) => `${L(f)}${V(day15[f])}`).join('、')
  useScreen(onScreen, {
    doing: guess ? `在改第 15 天的天气（${describe}），对比两棵树的判断` : '在预测 Day 树会怎么判第 15 天',
    facts: [
      ...ranking.map((r) => `${L(r.feature)}：信息增益 ${f3(r.infoGain)}，${r.branches} 个分支`),
      '两棵树在 14 个训练样本上都是 100% 正确',
      `第 15 天：${describe}`,
      ...(guess ? [
        `Day 树：${dayPath.steps.join(' → ')}，判「${V(dayPath.label)}」`,
        `不用 Day 的树：${realPath.steps.join(' → ')}，判「${V(realPath.label)}」`,
      ] : []),
    ],
    moment: guess && edits >= 2 ? {
      id: 'day-tree-blind',
      text: `你已经改了 ${edits} 次第 15 天的天气，Day 树的答案一次都没变：始终是「${V(dayPath.label)}」。它在训练集上 100% 正确，却一眼都不看天气。`,
      ask: '为什么 Day 树在训练集上全对，却完全不看天气？',
    } : null,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="把 Day 也当成特征，ID3 看到的排名">
        {ranking.map((r, i) => (
          <div key={r.feature} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
            <span style={{ width: 48, fontSize: 13, fontWeight: i === 0 ? 700 : 400, color: r.feature === 'Day' ? 'var(--bad)' : 'var(--ink-mid)' }}>{L(r.feature)}</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#eef2f9' }}>
              <div style={{ width: `${(r.infoGain / ranking[0].infoGain) * 100}%`, height: '100%', borderRadius: 4, background: r.feature === 'Day' ? 'var(--bad)' : 'var(--brand-line)' }} />
            </div>
            <span className="mono" style={{ width: 190, fontSize: 12.5, color: 'var(--ink-mid)', whiteSpace: 'nowrap' }}>增益 {f3(r.infoGain)} · {r.branches} 个分支</span>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          Day 把 14 天切成 14 支，每支 1 天、都是纯的，增益等于整个数据集的熵——能拿到的最高分。
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16 }}>
        <Card title="用 Day 建的树" style={{ flex: 1 }} right={<Chip tone="bad">训练集 {Math.round(accuracy(dayTree, ds.rows, T) * 100)}% 正确</Chip>}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>只有一层：Day 是几号，就查那一天的答案。</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {dayTree.children.map((c) => (
              <span key={c.value} className="mono" style={{
                fontSize: 11.5, padding: '3px 7px', borderRadius: 6,
                background: c.node.label === 'Yes' ? 'var(--ok-bg)' : 'var(--bad-bg)',
                color: c.node.label === 'Yes' ? 'var(--ok-deep)' : 'var(--bad)',
              }}>{c.value} → {V(c.node.label)}</span>
            ))}
          </div>
        </Card>
        <Card title="不用 Day 建的树" style={{ flex: 1 }} right={<Chip tone="ok">训练集 {Math.round(accuracy(realTree, ds.rows, T) * 100)}% 正确</Chip>}>
          <div style={{ fontSize: 12.5 }}><TreeLines node={realTree} /></div>
        </Card>
      </div>

      <Card title="第 15 天来了">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {ds.features.map((f) => (
            <label key={f} style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {L(f)}
              <select value={day15[f]} onChange={(e) => edit(f, e.target.value)} aria-label={`第 15 天的${L(f)}`}
                style={{ display: 'block', width: '100%', marginTop: 5, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)', fontFamily: 'inherit', fontSize: 13 }}>
                {values(f).map((v) => <option key={v} value={v}>{V(v)}</option>)}
              </select>
            </label>
          ))}
        </div>

        {!guess ? (
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 10 }}>
              <b>先预测：</b>用 Day 建的那棵树，对第 15 天的判断取决于什么？
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {DAY15_GUESSES.map((g) => <Choice key={g.label} label={g.label} onClick={() => commit(g)} />)}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14 }}>
              {[{ title: '用 Day 建的树', p: dayPath, tone: 'bad' }, { title: '不用 Day 建的树', p: realPath, tone: 'ok' }].map((t) => (
                <div key={t.title} style={{ flex: 1, padding: 12, borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-mid)', margin: '6px 0' }}>{t.p.steps.join(' → ')}</div>
                  <Chip tone={t.tone}>判「{V(t.p.label)}」</Chip>
                </div>
              ))}
            </div>
            <Feedback tone={guess.correct ? 'ok' : 'warn'} title={guess.correct ? '预测对了' : '再看一眼 Day 树'} style={{ marginTop: 12 }}>
              Day 树只认识 D1 到 D14。D15 在它眼里是个没见过的编号，它只能退回全体的多数——判「打」。
              改改上面第 15 天的天气试试：不用 Day 的树会跟着变，Day 树永远不变。
            </Feedback>
          </>
        )}
      </Card>
    </div>
  )
}

// ================================================================ concept 10

const RATIO_GUESSES = [
  { label: '能——除完之后 Day 仍然排第一', correct: true },
  { label: '不能——它的 Split Info 太大，会掉到后面', misconception: 'gain_ratio_fixes_bias' },
  { label: '会和天气并列第一' },
]

export function GainRatioExplorer({ onEvidence, onScreen }) {
  const [guess, setGuess] = useState(null)
  const [minBranch, setMinBranch] = useState(1)
  const [guarded, setGuarded] = useState(false)

  const all = [...ds.features, 'Day']
  const rows = useMemo(() => all.map((f) => ({
    f,
    ig: infoGain(ds.rows, f, T),
    si: splitInfo(ds.rows, f),
    gr: gainRatio(ds.rows, f, T),
    branches: partition(ds.rows, f).size,
    mean: meanBranchSize(ds.rows, f),
  })).sort((a, b) => b.gr - a.gr), [])
  const meanIg = rows.reduce((s, r) => s + r.ig, 0) / rows.length
  const eligible = rows.filter((r) => r.ig >= meanIg)
  const c45 = eligible.reduce((a, b) => (b.gr > a.gr ? b : a))
  const survivors = rows.filter((r) => r.mean >= minBranch)
  const guardWinner = survivors.length ? survivors.reduce((a, b) => (b.gr > a.gr ? b : a)) : null
  const byIg = [...rows].sort((a, b) => b.ig - a.ig)

  const commit = (g) => {
    if (guess) return
    setGuess(g)
    onEvidence({
      kind: 'labAction',
      correct: Boolean(g.correct),
      misconceptionId: g.correct ? null : (g.misconception ?? null),
      detail: { labStep: 'predict-gain-ratio', guess: g.label },
      description: g.correct ? '正确预测增益率下 Day 仍然第一' : `预测「${g.label}」，实际 Day 的增益率 ${f4(rows[0].gr)} 仍然第一`,
      facts: rows.map((r) => `${L(r.f)}：信息增益 ${f4(r.ig)}，Split Info ${f4(r.si)}，增益率 ${f4(r.gr)}`),
    })
  }

  // Turning the guard on far enough to drop Day is the exploration here.
  useEffect(() => {
    if (guarded || minBranch < 2) return
    setGuarded(true)
    onEvidence({
      kind: 'labExplore',
      correct: true,
      detail: { labStep: 'guard-day', minBranch },
      description: `把「每个分支平均至少 ${minBranch} 个样本」的门槛加上，Day 出局`,
      facts: [`门槛 ${minBranch} 下按增益率胜出的是${guardWinner ? L(guardWinner.f) : '没有特征'}`],
    })
  }, [guarded, minBranch, guardWinner, onEvidence])

  useScreen(onScreen, {
    doing: !guess
      ? '在预测按增益率 Day 还能不能排第一'
      : `把门槛调到「每个分支平均至少 ${minBranch} 个样本」`,
    facts: [
      ...rows.map((r) => `${L(r.f)}：信息增益 ${f4(r.ig)}，Split Info ${f4(r.si)}，${r.branches} 个分支，平均每支 ${r.mean.toFixed(2)} 个样本${guess ? `，增益率 ${f4(r.gr)}` : ''}`),
      ...(guess ? [
        `五个特征的平均信息增益 ${f4(meanIg)}，只有${eligible.map((r) => L(r.f)).join('、')}达标，C4.5 选${L(c45.f)}`,
        `门槛 ${minBranch} 下留下：${survivors.map((r) => L(r.f)).join('、') || '没有特征'}；按增益率胜出：${guardWinner ? L(guardWinner.f) : '无'}`,
      ] : []),
    ],
    moment: guess && minBranch >= 5 ? {
      id: 'guard-too-strict',
      text: `门槛定到 ${minBranch}，连天气（平均每支 ${rows.find((r) => r.f === 'Outlook').mean.toFixed(2)} 个样本）也被挡在门外了，${guardWinner ? `${L(guardWinner.f)}上位` : '一个特征都不剩'}。门槛和剪枝的旋钮一样，调过头会伤到真正有用的东西。`,
      ask: '这个门槛应该怎么定才合适？',
    } : guess && minBranch >= 2 ? {
      id: 'guard-day-out',
      text: `门槛一加，Day（平均每支 1 个样本）就出局了，天气以增益率 ${f4(rows.find((r) => r.f === 'Outlook').gr)} 胜出。换指标没做到的事，一条结构性的规则做到了。`,
      ask: '为什么按分支大小来挡，比换一个指标更管用？',
    } : null,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="增益率 = 信息增益 ÷ Split Info">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                {['特征', '信息增益', 'Split Info', '增益率', '分支数', '平均每支'].map((h) => <th key={h} style={{ padding: 8, fontWeight: 500 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {(guess ? rows : byIg).map((r, i) => (
                <tr key={r.f} style={{ borderTop: '1px solid var(--border-faint)', background: guess && i === 0 ? 'var(--bad-bg)' : 'transparent' }}>
                  <td style={{ padding: 8, fontWeight: r.f === 'Day' ? 700 : 400 }}>{L(r.f)}</td>
                  <td className="mono" style={{ padding: 8 }}>{f4(r.ig)}</td>
                  <td className="mono" style={{ padding: 8 }}>{f4(r.si)}</td>
                  <td className="mono" style={{ padding: 8, color: guess ? 'var(--ink-strong)' : 'var(--muted-light)' }}>{guess ? f4(r.gr) : '？'}</td>
                  <td className="mono" style={{ padding: 8 }}>{r.branches}</td>
                  <td className="mono" style={{ padding: 8 }}>{r.mean.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {!guess ? (
        <Card title="先预测">
          <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 12 }}>
            Day 的 Split Info 是 {f4(rows.find((r) => r.f === 'Day').si)}，比谁都大。除完之后，<b>Day 还能排第一吗？</b>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {RATIO_GUESSES.map((g) => <Choice key={g.label} label={g.label} onClick={() => commit(g)} />)}
          </div>
        </Card>
      ) : (
        <>
          <Feedback tone={guess.correct ? 'ok' : 'warn'} title={`Day 的增益率 ${f4(rows[0].gr)}，仍然第一`}>
            天气只有 {f4(rows.find((r) => r.f === 'Outlook').gr)}。增益率把差距从 {f4(rows[0].ig)} 对 {f4(rows.find((r) => r.f === 'Outlook').ig)} 缩小了，但没有翻盘。
          </Feedback>

          <Card title="C4.5 的启发式：先筛掉增益低于平均的，再比增益率">
            {byIg.map((r) => {
              const ok = r.ig >= meanIg
              return (
                <div key={r.f} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', opacity: ok ? 1 : 0.45 }}>
                  <span style={{ width: 48, fontSize: 13 }}>{L(r.f)}</span>
                  <div style={{ flex: 1, position: 'relative', height: 8, borderRadius: 4, background: '#eef2f9' }}>
                    <div style={{ width: `${(r.ig / byIg[0].ig) * 100}%`, height: '100%', borderRadius: 4, background: ok ? 'var(--bad)' : 'var(--brand-line)' }} />
                    <div style={{ position: 'absolute', left: `${(meanIg / byIg[0].ig) * 100}%`, top: -4, bottom: -4, width: 2, background: 'var(--ink-soft)' }} />
                  </div>
                  <span className="mono" style={{ width: 120, fontSize: 12.5 }}>{f4(r.ig)} {ok ? '· 入围' : '· 筛掉'}</span>
                </div>
              )
            })}
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
              竖线是平均信息增益 {f4(meanIg)}。Day 的增益太大，把平均值抬到了所有真实特征之上——它成了唯一的候选，C4.5 选的还是{L(c45.f)}。
            </div>
          </Card>

          <Card title="结构性的防线：每个分支平均至少要有几个样本">
            <Slider label="每个分支平均至少要有的样本数" value={minBranch} min={1} max={8} onChange={setMinBranch} display={`${minBranch} 个`} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
              {rows.map((r) => (
                <Chip key={r.f} tone={r.mean >= minBranch ? (guardWinner?.f === r.f ? 'ok' : 'neutral') : 'bad'}>
                  {L(r.f)} · 平均 {r.mean.toFixed(2)} 个 · {r.mean >= minBranch ? '留下' : '出局'}
                </Chip>
              ))}
            </div>
            <Feedback tone={guardWinner && guardWinner.f !== 'Day' ? 'ok' : 'warn'} title={guardWinner ? `按增益率胜出：${L(guardWinner.f)}` : '一个特征都不剩了'}>
              {minBranch < 2 && '门槛为 1 等于没有门槛，Day 照样赢。把它往右拖。'}
              {minBranch >= 2 && minBranch < 5 && 'Day 一出局，真正有用的天气就胜出了。挡住它的不是更好的分数，而是一个关于分裂结构的判断。'}
              {minBranch >= 5 && '门槛太高，连有用的特征也被挡掉了——和剪枝剪过头是同一个道理。'}
            </Feedback>
          </Card>
        </>
      )}
    </div>
  )
}
