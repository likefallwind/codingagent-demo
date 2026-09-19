/**
 * Steps 1-3: the labs that run on the 16 hand-picked samples.
 *
 * Small enough that every number on screen can be checked by hand, which is the
 * point — the learner should be able to verify the algorithm rather than trust it.
 *
 * Each lab reports evidence upward through `onEvidence`. Correctness is always
 * decided here, from the real computation, never by the language model. The
 * `facts` a lab attaches are the exact figures the tutor is later allowed to
 * quote when explaining a mistake.
 *
 * Each lab also reports what it is showing through `onScreen` (see
 * ../screen.js), so the tutor can talk about what the learner is looking at.
 * A snapshot lists only what is visible: a count the learner has not revealed
 * yet is not handed to the tutor either.
 */

import React, { useEffect, useMemo, useState } from 'react'
import {
  gini, counts, splitRows, splitLabel, gainOf, bestSplitFor, rankFeatures,
  buildFromSpec, ILLUSTRATIVE_SPEC, grow, errRate, nodeMistakes, isPure,
} from './cart.js'
import { SAMPLES, FEATURES, PEEL_LABEL, APPLE, classEmoji } from './dataset.js'
import TreeView from './TreeView.jsx'
import { useScreen } from '../screen.js'
import { Card, Stat, GiniBar, Chip, Button, Choice, Feedback, Slider } from '../../components/ui.jsx'

const f3 = (v) => v.toFixed(3)
const pct = (v) => `${(v * 100).toFixed(1)}%`

// ---------------------------------------------------------------- step 1

/**
 * Read a tree.
 *
 * The tree shown is authored rather than grown — see buildFromSpec — because the
 * algorithm's own tree is perfect on this data and would leave nothing to say
 * about impure leaves. The learner is asked to find the leaf that contains a
 * mistake, which forces them to actually read the counts instead of nodding along.
 */
export function TreeReader({ onEvidence, onScreen }) {
  const tree = useMemo(() => buildFromSpec(SAMPLES, ILLUSTRATIVE_SPEC), [])
  const [picked, setPicked] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const leaves = useMemo(() => {
    const out = []
    const walk = (n, key) => {
      if (!n.split) { out.push({ key, node: n }); return }
      walk(n.left, `${key}L`)
      walk(n.right, `${key}R`)
    }
    walk(tree, 'r')
    return out
  }, [tree])

  const impureKey = leaves.find((l) => nodeMistakes(l.node.rows) > 0)?.key

  const where = ['最左边', '中间', '最右边']

  const pick = (node, key) => {
    if (picked) return
    if (node.split) return // only leaves answer the question
    const correct = key === impureKey
    const c = counts(node.rows)
    setPicked({ key, correct, node })
    onEvidence({
      kind: 'labAction',
      correct,
      misconceptionId: correct ? null : 'leaf_must_be_pure',
      detail: { labStep: 'find-impure-leaf', picked: key },
      description: correct
        ? '正确找出了那个含有错误样本的叶子'
        : `点选了一个纯叶子（${c.a} 苹果 / ${c.o} 橙子），没有找出混着的那个`,
      // After a miss the learner tries again, so the tutor gets only what the
      // screen shows — the picked leaf's contents and every leaf's size — and
      // not which leaf is the mixed one. It cannot give away what it was never told.
      retry: !correct,
      facts: correct
        ? leaves.map((l, i) => {
          const cc = counts(l.node.rows)
          return `${where[i]}的叶子：${cc.n} 个样本，${cc.a} 苹果 / ${cc.o} 橙子，错 ${nodeMistakes(l.node.rows)} 个`
        })
        : [
          `学生点的叶子：${c.n} 个样本，${c.a} 苹果 / ${c.o} 橙子，是纯的`,
          ...leaves.map((l, i) => `${where[i]}的叶子：${counts(l.node.rows).n} 个样本，判为${l.node.cls === APPLE ? '苹果' : '橙子'}`),
        ],
    })
  }

  const rows = showAll ? SAMPLES : SAMPLES.filter((_, i) => i < 4 || (i >= 8 && i < 12))

  useScreen(onScreen, {
    doing: !picked
      ? '在看第 1 步的示例树，找哪个叶子判错了样本'
      : picked.correct ? '找对了那个判错了样本的叶子' : '点了一个纯叶子，正在重新找判错了样本的叶子',
    facts: [
      '示例树先问「果皮是薄的吗」，是就判苹果；否则再问「重量 ≤ 180 g 吗」',
      ...leaves.map((l, i) => {
        const c = counts(l.node.rows)
        // Class counts only once a leaf has been picked: before that, which
        // leaf is mixed is the question itself.
        return picked
          ? `${where[i]}的叶子：${c.n} 个样本，${c.a} 苹果 / ${c.o} 橙子，判为${l.node.cls === APPLE ? '苹果' : '橙子'}`
          : `${where[i]}的叶子：${c.n} 个样本，判为${l.node.cls === APPLE ? '苹果' : '橙子'}`
      }),
      showAll ? '样本表展开了全部 16 行' : '样本表只显示了 8 行',
    ],
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        title="一棵已经建好的树"
        right={<Chip tone="neutral">示例树 · 非算法生成</Chip>}
      >
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.8, marginBottom: 12 }}>
          这棵树的两个问题是人挑的，为的是留出一个「混着的」叶子给你看。
          节点里的数字是落进该节点的样本数，颜色表示它判成苹果还是橙子。
        </div>
        <TreeView tree={tree} width={900} height={280} compact={false}
                  onNodeClick={pick}
                  highlightPath={picked ? [picked.key] : []} />
        <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: 'var(--apple)', marginRight: 6 }} />判为苹果</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: 'var(--orange)', marginRight: 6 }} />判为橙子</span>
        </div>
      </Card>

      <Card title="轮到你了">
        <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 12 }}>
          这棵树里有一个叶子，判错了它内部的样本。<b>点一下那个叶子。</b>
        </div>
        {picked ? (
          <Feedback tone={picked.correct ? 'ok' : 'warn'} title={picked.correct ? '找对了' : '再看一眼'}>
            {picked.correct ? (
              <>
                这个叶子里 {counts(picked.node.rows).n} 个样本，
                {counts(picked.node.rows).o} 个橙子、{counts(picked.node.rows).a} 个苹果。
                树判所有落进来的都是橙子，那 {nodeMistakes(picked.node.rows)} 个苹果就被判错了。
                树并不要求自己全对。
              </>
            ) : (
              <>
                你点的这个叶子里 {counts(picked.node.rows).n} 个样本全是同一类，是纯的，没有判错任何样本。
                再找找哪个叶子里两种水果都有。
              </>
            )}
          </Feedback>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--muted-light)' }}>点击上方树里的圆形叶节点。</div>
        )}
        {picked && !picked.correct && (
          <div style={{ marginTop: 10 }}>
            <Button variant="quiet" onClick={() => setPicked(null)}>再试一次</Button>
          </div>
        )}
      </Card>

      <Card
        title="这 16 个样本"
        right={
          <Button variant="quiet" style={{ height: 30, fontSize: 12.5 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? '只看前 8 条' : `显示全部 16 条`}
          </Button>
        }
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>类别</th>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>重量</th>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>果皮</th>
                <th style={{ padding: '6px 8px', fontWeight: 500 }}>果香</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border-faint)' }}>
                  <td style={{ padding: '6px 8px', color: r.c === APPLE ? 'var(--apple-deep)' : 'var(--orange-deep)' }}>
                    {classEmoji(r.c)} {r.c === APPLE ? '苹果' : '橙子'}
                  </td>
                  <td className="mono" style={{ padding: '6px 8px' }}>{r.w} g</td>
                  <td style={{ padding: '6px 8px' }}>{PEEL_LABEL[r.peel]}</td>
                  <td style={{ padding: '6px 8px' }}>{r.aroma ? '有' : '无'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!showAll && (
          <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 8 }}>
            仅显示前 8 条，共 16 条
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- step 2

/**
 * Explore one split at a time.
 *
 * The scatter plot, the gini bars and the ranking table all recompute live from
 * the same functions the tree builder uses, so what the learner sees here is
 * literally what the algorithm sees when it chooses.
 */
export function SplitExplorer({ onEvidence, onScreen }) {
  // Opens on a middling cut. Opening on the best one (peel = thin) recorded
  // "found the best split" before the learner had touched anything.
  const [feat, setFeat] = useState('w')
  const [thr, setThr] = useState({ peel: 2, w: 180, aroma: 0 })
  const [found, setFound] = useState(false)
  // The ranking stays hidden until the learner commits to a guess: shown up
  // front, it is the answer to the one judgement this step asks for.
  const [guess, setGuess] = useState(null)

  const current = thr[feat]
  const [left, right] = splitRows(SAMPLES, feat, current)
  const before = gini(SAMPLES)
  const gl = gini(left)
  const gr = gini(right)
  const gain = gainOf(SAMPLES, feat, current)
  const ranking = useMemo(() => rankFeatures(SAMPLES, FEATURES), [])
  const best = ranking[0]

  // The learner has found the optimal cut when their current setting matches the
  // best split of the best feature. Reported from an effect, not during render —
  // setting state and calling a parent callback mid-render is a React error and
  // would fire on every re-render besides.
  const isBest = feat === best.key && current === best.thr
  useEffect(() => {
    if (!isBest || found) return
    setFound(true)
    // Exploration, not judgement: sweeping the slider until the number peaks
    // shows engagement, so it is recorded at the weight exploring deserves.
    onEvidence({
      kind: 'labExplore',
      correct: true,
      detail: { labStep: 'find-best-split', feature: feat, thr: current },
      description: `找到了增益最大的一刀：${splitLabel(feat, current)}`,
      facts: ranking.map((r) => `${r.name}最好的一刀是「${r.condition}」，增益 ${f3(r.gain)}`),
    })
  }, [isBest, found, feat, current, ranking, onEvidence])

  const range = { w: { min: 110, max: 250, step: 5 }, peel: { min: 1, max: 2, step: 1 }, aroma: { min: 0, max: 0, step: 1 } }[feat]
  const display = feat === 'w' ? `${current} g` : feat === 'peel' ? `≤ ${PEEL_LABEL[current]}` : '无果香'
  const featName = FEATURES.find((f) => f.key === feat).name

  const commit = (key) => {
    if (guess) return
    setGuess(key)
    const correct = key === best.key
    const picked = ranking.find((r) => r.key === key)
    onEvidence({
      kind: 'labAction',
      correct,
      misconceptionId: correct ? null : (key === 'w' ? 'more_thresholds_better' : null),
      detail: { labStep: 'guess-best-feature', guess: key },
      description: correct
        ? `猜对了：${best.name}最好的一刀增益最高`
        : `猜${picked.name}最好，实际是${best.name}（${f3(best.gain)}，而${picked.name}最好的一刀是 ${f3(picked.gain)}）`,
      facts: ranking.map((r) => `${r.name}最好的一刀是「${r.condition}」，增益 ${f3(r.gain)}`),
    })
  }

  useScreen(onScreen, {
    doing: `按「${featName}」切，${feat === 'aroma' ? '只有「有 / 无」一种切法' : `阈值 ${display}`}${guess ? '' : '（还没猜哪个特征最好）'}`,
    facts: [
      `分裂前基尼 ${f3(before)}`,
      `左边（满足条件）${left.length} 个：${counts(left).a} 苹果 / ${counts(left).o} 橙子，基尼 ${f3(gl)}`,
      `右边 ${right.length} 个：${counts(right).a} 苹果 / ${counts(right).o} 橙子，基尼 ${f3(gr)}`,
      gain < 0 ? '这一刀没有把样本分开' : `这一刀的增益 ${f3(gain)}`,
      ...(guess ? ranking.map((r) => `${r.name}最好的一刀「${r.condition}」增益 ${f3(r.gain)}`) : []),
    ],
  })

  // Scatter geometry, matching the mockup's projection.
  const xw = (w) => 70 + ((w - 100) / 180) * 790
  const yp = (p) => (p === 3 ? 67 : p === 2 ? 142 : 217)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="按哪个特征切一刀？">
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          {FEATURES.map((f) => (
            <Choice key={f.key} label={f.name} selected={feat === f.key} onClick={() => setFeat(f.key)} />
          ))}
        </div>

        {feat !== 'aroma' && (
          <Slider label="阈值" value={current} min={range.min} max={range.max} step={range.step}
                  display={display}
                  onChange={(v) => setThr((t) => ({ ...t, [feat]: v }))} />
        )}
        {feat === 'aroma' && (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>果香是二元特征，只有「有 / 无」一种切法。</div>
        )}

        <svg viewBox="0 0 900 260" style={{ width: '100%', marginTop: 16, display: 'block' }}
             role="img" aria-label="16 个样本按重量和果皮厚度分布">
          {[3, 2, 1].map((p) => (
            <g key={p}>
              <line x1={60} y1={yp(p)} x2={880} y2={yp(p)} stroke="var(--border-soft)" strokeWidth={1} />
              <text x={40} y={yp(p) + 4} fontSize={11.5} textAnchor="end" fill="var(--muted)">{PEEL_LABEL[p]}</text>
            </g>
          ))}
          {feat === 'w' && (
            <line x1={xw(current + 0.5)} y1={30} x2={xw(current + 0.5)} y2={245}
                  stroke="var(--brand)" strokeWidth={2} strokeDasharray="5 4" />
          )}
          {feat === 'peel' && (
            <line x1={60} y1={current === 1 ? 180 : 105} x2={880} y2={current === 1 ? 180 : 105}
                  stroke="var(--brand)" strokeWidth={2} strokeDasharray="5 4" />
          )}
          {SAMPLES.map((r, i) => (
            <circle key={i} cx={xw(r.w)} cy={yp(r.peel)} r={7}
                    fill={r.aroma ? (r.c === APPLE ? 'var(--apple)' : 'var(--orange)') : '#fff'}
                    stroke={r.c === APPLE ? 'var(--apple)' : 'var(--orange)'} strokeWidth={2} />
          ))}
          <text x={470} y={256} fontSize={11.5} textAnchor="middle" fill="var(--muted-light)">重量 (g) →</text>
        </svg>
        <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 2 }}>
          空心圆 = 无果香。纵轴是果皮厚度。
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        <Card title="这一刀的账" style={{ flex: 1 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
              <span style={{ color: 'var(--muted)' }}>分裂前 · 基尼不纯度</span>
              <span className="mono">{f3(before)}</span>
            </div>
            <GiniBar value={before} color="var(--muted-faint)" />
          </div>

          <div style={{ display: 'flex', gap: 14 }}>
            {[{ rows: left, g: gl, label: `左边（满足）· ${left.length} 个` },
              { rows: right, g: gr, label: `右边 · ${right.length} 个` }].map((side, i) => (
              <div key={i} style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>{side.label}</span>
                  <span className="mono">{f3(side.g)}</span>
                </div>
                <GiniBar value={side.g} color={isPure(side.rows) ? 'var(--ok)' : 'var(--brand)'} />
                <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 5 }}>
                  {counts(side.rows).a} 苹果 / {counts(side.rows).o} 橙子
                  {isPure(side.rows) && side.rows.length > 0 && <span style={{ color: 'var(--ok-deep)' }}> · 纯</span>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-faint)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Stat label="信息增益" value={gain < 0 ? '—' : f3(gain)}
                  tone={isBest ? 'var(--ok-deep)' : undefined}
                  sub={gain < 0 ? '这一刀没有把样本分开' : isBest ? '三个特征里最高' : undefined} />
            <div style={{ fontSize: 11.5, color: 'var(--muted-light)', lineHeight: 1.7, flex: 1.4 }}>
              Gini = 1 − p(苹果)² − p(橙子)²<br />
              增益 = 切前基尼 − 切后加权基尼
            </div>
          </div>
        </Card>

        {!guess ? (
          <Card title="先猜一下" style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 12 }}>
              每个特征都按它<b>自己最好的阈值</b>切一刀。三个特征里，谁的那一刀增益最高？
              可以先在左边试着切切看，想好了再选。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {FEATURES.map((f) => (
                <Choice key={f.key} label={f.name} onClick={() => commit(f.key)} />
              ))}
            </div>
          </Card>
        ) : (
        <Card title="三个特征的最好成绩" style={{ flex: 1 }}
              right={<Chip tone={guess === best.key ? 'ok' : 'warn'}>{guess === best.key ? '你猜对了' : `你猜的是${FEATURES.find((f) => f.key === guess).name}`}</Chip>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {ranking.map((r, i) => (
              <div key={r.key} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                border: `1px solid ${i === 0 ? 'var(--ok-line)' : 'var(--border-soft)'}`,
                background: i === 0 ? 'var(--ok-bg)' : '#fff',
              }}>
                <span style={{ fontSize: 13, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? 'var(--ok-deep)' : 'var(--ink-soft)' }}>
                  {r.name}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.condition}</span>
                <div style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 13, color: i === 0 ? 'var(--ok-deep)' : 'var(--ink-mid)' }}>{f3(r.gain)}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 12, lineHeight: 1.8 }}>
            比的是每个特征<b>各自最好的那一刀</b>。重量有 15 个候选阈值，果皮只有 2 个，
            但候选多少和最终增益没有关系。
          </div>
        </Card>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- step 3

/**
 * Build the first two cuts by hand, then compare against the algorithm.
 *
 * The comparison is computed, not asserted: the learner's tree and the greedy
 * tree are both evaluated on the same 16 samples and the mistake counts are put
 * side by side.
 */
export function TreeBuilder({ onEvidence, onScreen }) {
  const [root, setRoot] = useState(null)
  const [second, setSecond] = useState(null)

  const ranking = useMemo(() => rankFeatures(SAMPLES, FEATURES), [])
  const bestKey = ranking[0].key
  const algoTree = useMemo(() => grow(SAMPLES, 0, 2, 1), [])
  const algoMistakes = Math.round(errRate(algoTree, SAMPLES) * SAMPLES.length)

  const pickRoot = (key) => {
    if (root) return
    setRoot(key)
    const correct = key === bestKey
    const chosen = ranking.find((r) => r.key === key)
    onEvidence({
      kind: 'labAction',
      correct,
      misconceptionId: correct ? null : (key === 'w' ? 'more_thresholds_better' : null),
      detail: { labStep: 'pick-root', feature: key },
      description: `第一刀选了${chosen.name}（增益 ${f3(chosen.gain)}），算法会选${ranking[0].name}（增益 ${f3(ranking[0].gain)}）`,
      facts: ranking.map((r) => `${r.name}最好的一刀「${r.condition}」增益 ${f3(r.gain)}`),
    })
  }

  const rootInfo = root ? ranking.find((r) => r.key === root) : null
  const [l, r] = root ? splitRows(SAMPLES, root, rootInfo.thr) : [[], []]
  const impureSide = root ? (isPure(l) ? (isPure(r) ? null : 'right') : 'left') : null
  const impureRows = impureSide === 'left' ? l : impureSide === 'right' ? r : []

  const secondBest = second && impureRows.length ? bestSplitFor(impureRows, second) : null
  const myMistakes = root && secondBest
    ? nodeMistakes(impureSide === 'left' ? r : l) + nodeMistakes(secondBest.l) + nodeMistakes(secondBest.r)
    : null

  const reset = () => { setRoot(null); setSecond(null) }

  const side = impureSide === 'left' ? '左' : '右'
  useScreen(onScreen, {
    doing: !root
      ? '在选第一刀要问哪个问题'
      : !second && impureSide
        ? `第一刀选了「${splitLabel(root, rootInfo.thr)}」，在选第二刀`
        : `建好了两刀：「${splitLabel(root, rootInfo.thr)}」${secondBest ? `和「${splitLabel(second, secondBest.thr)}」` : ''}`,
    facts: root ? [
      `第一刀「${splitLabel(root, rootInfo.thr)}」增益 ${f3(rootInfo.gain)}；算法会选「${ranking[0].condition}」，增益 ${f3(ranking[0].gain)}`,
      `满足条件的一边 ${counts(l).a} 苹果 / ${counts(l).o} 橙子，其余一边 ${counts(r).a} 苹果 / ${counts(r).o} 橙子`,
      ...(impureSide ? [`${side}边还混着 ${impureRows.length} 个样本`] : []),
      ...(secondBest ? [
        `第二刀「${splitLabel(second, secondBest.thr)}」切出 ${counts(secondBest.l).a} 苹果 / ${counts(secondBest.l).o} 橙子 和 ${counts(secondBest.r).a} 苹果 / ${counts(secondBest.r).o} 橙子`,
        `你的两层树在 16 个样本上错 ${myMistakes} 个，算法的两层树错 ${algoMistakes} 个`,
      ] : []),
    ] : ['16 个样本：8 苹果 / 8 橙子，基尼 0.500'],
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card
        title={root ? '第二刀：在还混着的那一边继续切' : '第一刀：你要问哪个问题？'}
        right={root ? <Button variant="quiet" style={{ height: 30, fontSize: 12.5 }} onClick={reset}>重新开始</Button> : null}
      >
        <div style={{ display: 'flex', gap: 10 }}>
          {FEATURES.map((f) => {
            const disabled = root ? f.key === root : false
            const selected = root === f.key || second === f.key
            return (
              <Choice key={f.key} label={f.name}
                      hint={root ? (disabled ? '已用过' : undefined) : undefined}
                      selected={selected} disabled={disabled}
                      onClick={() => (root ? setSecond(f.key) : pickRoot(f.key))} />
            )
          })}
        </div>
      </Card>

      {root && (
        <>
          <Card title={`第一刀：${splitLabel(root, rootInfo.thr)}`}>
            <div style={{ display: 'flex', gap: 14 }}>
              {[{ rows: l, label: '满足条件的样本' }, { rows: r, label: '其余样本' }].map((side, i) => {
                const c = counts(side.rows)
                const pure = isPure(side.rows)
                return (
                  <div key={i} style={{
                    flex: 1, padding: 14, borderRadius: 11,
                    background: pure ? 'var(--ok-bg)' : 'var(--bg)',
                    border: `1px solid ${pure ? 'var(--ok-line)' : 'var(--brand-line-soft)'}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: pure ? 'var(--ok-deep)' : 'var(--ink-mid)' }}>
                      {pure ? `${classEmoji(side.rows[0]?.c)} 纯：全是${side.rows[0]?.c === APPLE ? '苹果' : '橙子'}` : '还混着'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>
                      {side.label} · {c.a} 苹果 / {c.o} 橙子 · gini {f3(gini(side.rows))}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Feedback tone={root === bestKey ? 'ok' : 'warn'}
                    title={root === bestKey ? '好选择' : '可以，但不是算法的选择'}>
            {root === bestKey ? (
              <>
                这一刀增益 {f3(rootInfo.gain)}，是三个特征里最大的。
                左边 {l.length} 个样本全是苹果，直接变成叶子，只剩右边 {r.length} 个要继续处理。
              </>
            ) : (
              <>
                这一刀增益 {f3(rootInfo.gain)}，算法会选{ranking[0].name}（增益 {f3(ranking[0].gain)}）。
                {impureSide === null ? '两边都纯了。' : `你这一刀之后${impureSide === 'left' ? '左' : '右'}边还混着 ${impureRows.length} 个样本。`}
                决策树是贪心的，第一刀选完就不回头了。
              </>
            )}
          </Feedback>

          {impureSide && second && secondBest && (
            <Card title={`第二刀：${splitLabel(second, secondBest.thr)}`}>
              <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
                {[secondBest.l, secondBest.r].map((rows, i) => {
                  const c = counts(rows)
                  return (
                    <div key={i} style={{
                      flex: 1, padding: 12, borderRadius: 10,
                      background: isPure(rows) ? 'var(--ok-bg)' : 'var(--bg)',
                      border: `1px solid ${isPure(rows) ? 'var(--ok-line)' : 'var(--border-soft)'}`,
                    }}>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-mid)' }}>{i === 0 ? '满足' : '不满足'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        {c.a} 苹果 / {c.o} 橙子 · gini {f3(gini(rows))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <Feedback tone={myMistakes <= algoMistakes ? 'ok' : 'warn'} title="你的树 vs 算法的树">
                你这棵两层的树在 16 个样本上错 <b>{myMistakes}</b> 个。
                算法自己建的两层树错 <b>{algoMistakes}</b> 个
                {algoMistakes === 0 ? '——它第二刀问的是「无果香」，一刀就把剩下的分干净了' : ''}。
                {myMistakes > algoMistakes && ' 差距来自第一刀：它决定了第二刀要面对什么样的样本。'}
              </Feedback>
            </Card>
          )}

          {impureSide && !second && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              选一个特征切{impureSide === 'left' ? '左' : '右'}边那 {impureRows.length} 个还混着的样本。
            </div>
          )}
        </>
      )}
    </div>
  )
}
