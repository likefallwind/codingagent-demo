/**
 * Steps 4-6: the labs that run on the 300-sample population.
 *
 * Overfitting cannot be shown on sixteen rows — there is nothing for a tree to
 * memorise. These labs train on 240 rows and score on a held-out 60, which is
 * what makes the gap between training and validation error visible at all.
 *
 * Everything is computed once per parameter change from the same CART code the
 * earlier steps use. No figure on screen is hard-coded.
 */

import React, { useEffect, useMemo, useState } from 'react'
import {
  grow, errRate, leafCount, learningCurve, decisionPath, predict, counts,
  buildFromSpec, ILLUSTRATIVE_SPEC, splitLabel,
} from './cart.js'
import { SAMPLES, TRAIN, VAL, DEPTHS, PEEL_LABEL, APPLE, ORANGE, classEmoji } from './dataset.js'
import TreeView from './TreeView.jsx'
import { Card, Stat, Chip, Button, Feedback, Slider } from '../../components/ui.jsx'

const pct = (v) => `${(v * 100).toFixed(1)}%`

/** Computed once — growing eight trees on every render would be wasteful. */
function useCurve() {
  return useMemo(() => learningCurve(TRAIN, VAL, DEPTHS), [])
}

// ---------------------------------------------------------------- step 4

/**
 * Watch the tree and its decision boundary change with depth.
 *
 * The boundary strip is the part that lands: at depth 2-3 it is a few broad
 * blocks, and by depth 7-8 it has broken into thin stripes that each exist to
 * accommodate one or two training points.
 */
export function DepthExplorer({ onEvidence }) {
  const { trees, curve, best } = useCurve()
  const [depth, setDepth] = useState(3)
  const [seenDeep, setSeenDeep] = useState(false)

  const tree = trees[depth]
  const point = curve.find((p) => p.d === depth)

  // Dragging past the optimum is the observation this step exists for; record it
  // once, the first time they go there.
  useEffect(() => {
    if (depth > best && !seenDeep) {
      setSeenDeep(true)
      const bp = curve.find((p) => p.d === best)
      const cp = curve.find((p) => p.d === depth)
      onEvidence({
        kind: 'labAction',
        correct: true,
        detail: { labStep: 'depth-past-optimum', depth },
        description: `把深度拖到 ${depth}，越过了验证误差最低的 depth ${best}`,
        facts: [
          `depth ${best}：训练误差 ${pct(bp.tr)}，验证误差 ${pct(bp.va)}，${bp.leaves} 个叶子`,
          `depth ${depth}：训练误差 ${pct(cp.tr)}，验证误差 ${pct(cp.va)}，${cp.leaves} 个叶子`,
        ],
      })
    }
  }, [depth, best, seenDeep, curve, onEvidence])

  // Decision boundary: weight across, one band per peel level, aroma held at 1.
  const bands = [3, 2, 1].map((peel) => ({
    peel,
    cells: Array.from({ length: 78 }, (_, i) => {
      const w = 110 + (i + 0.5) * (160 / 78)
      return { i, cls: predict(tree, { w, peel, aroma: 1 }) }
    }),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="树的最大深度">
        <Slider label="max_depth" value={depth} min={1} max={8} onChange={setDepth}
                note={depth > best ? `已越过最优深度 ${best}` : depth === best ? '验证误差最低点' : undefined} />
        <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
          <Stat label="最大深度" value={depth} />
          <Stat label="叶子数" value={point.leaves} />
          <Stat label="训练准确率" value={pct(1 - point.tr)} />
          <Stat label="验证准确率" value={pct(1 - point.va)}
                tone={depth > best ? 'var(--bad)' : 'var(--ok-deep)'}
                sub={depth > best ? '比最优深度更差' : undefined} />
        </div>
      </Card>

      <Card title="树长成这样" right={<Chip tone={point.leaves > 10 ? 'warn' : 'neutral'}>{point.leaves} 个叶子</Chip>}>
        <TreeView tree={tree} width={900} height={300} />
        {point.leaves > 10 && (
          <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 8 }}>
            叶子太多，节点标签已经放不下了——这本身就是一个信号。
          </div>
        )}
      </Card>

      <Card title="同一棵树画出的决策边界">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
          横轴重量，每一条对应一种果皮厚度，固定「有果香」。
        </div>
        <svg viewBox="0 0 900 200" style={{ width: '100%', display: 'block' }}
             role="img" aria-label={`深度 ${depth} 的决策边界`}>
          {bands.map((band, bi) => (
            <g key={band.peel}>
              <text x={52} y={bi * 60 + 55} fontSize={11.5} textAnchor="end" fill="var(--muted)">
                {PEEL_LABEL[band.peel]}
              </text>
              {band.cells.map((c) => (
                <rect key={c.i} x={62 + c.i * 10.2} y={bi * 60 + 26} width={10.4} height={44}
                      fill={c.cls === APPLE ? '#f9dcd5' : '#fce7c4'} />
              ))}
            </g>
          ))}
          <text x={470} y={196} fontSize={11.5} textAnchor="middle" fill="var(--muted-light)">重量 (g) →</text>
        </svg>
        <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span><span style={{ display: 'inline-block', width: 11, height: 11, background: '#f9dcd5', marginRight: 6, verticalAlign: -1 }} />判为苹果</span>
          <span><span style={{ display: 'inline-block', width: 11, height: 11, background: '#fce7c4', marginRight: 6, verticalAlign: -1 }} />判为橙子</span>
        </div>
        {depth >= 6 && (
          <Feedback tone="warn" title="注意那些细条纹" style={{ marginTop: 14 }}>
            深到这个程度，边界上出现了很多窄条。每一条只为了圈住一两个训练样本——
            它们在训练集上换来了准确率，在新数据上换不来。
          </Feedback>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- step 5

/**
 * The two error curves on one axis.
 *
 * The learner is asked to click where they think overfitting starts, which is a
 * real judgement with a checkable answer — the depth at which validation error
 * stops improving.
 */
export function CurveExplorer({ onEvidence }) {
  const { curve, best, trees } = useCurve()
  const [guess, setGuess] = useState(null)

  const bestPoint = curve.find((p) => p.d === best)
  const deepest = curve[curve.length - 1]

  const x = (d) => 70 + ((d - 1) / 7) * 790
  const y = (e) => 320 - (Math.min(e, 0.5) / 0.5) * 280
  const pathOf = (key) => curve.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')

  const pick = (d) => {
    if (guess) return
    const correct = d === best
    setGuess({ d, correct })
    onEvidence({
      kind: 'labAction',
      correct,
      detail: { labStep: 'find-overfit-start', guess: d },
      description: correct
        ? `正确指出验证误差在 depth ${best} 之后开始回升`
        : `认为过拟合从 depth ${d} 开始，实际最低点在 depth ${best}`,
      facts: curve.map((p) => `depth ${p.d}：训练误差 ${pct(p.tr)}，验证误差 ${pct(p.va)}，${p.leaves} 个叶子`),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="训练误差 vs 验证误差（随 max_depth 变化）">
        <svg viewBox="0 0 900 380" style={{ width: '100%', display: 'block' }}
             role="img" aria-label="训练误差与验证误差随深度变化的曲线">
          {[0, 0.125, 0.25, 0.375, 0.5].map((e) => (
            <g key={e}>
              <line x1={70} y1={y(e)} x2={880} y2={y(e)} stroke="var(--border-soft)" strokeWidth={1} />
              <text x={58} y={y(e) + 4} fontSize={11} textAnchor="end" fill="var(--muted-light)">{pct(e)}</text>
            </g>
          ))}

          {guess && (
            <rect x={x(best)} y={30} width={880 - x(best)} height={290} fill="#fdeae7" opacity={0.5} />
          )}

          <path d={pathOf('tr')} stroke="var(--brand)" strokeWidth={2.4} fill="none" />
          <path d={pathOf('va')} stroke="var(--bad)" strokeWidth={2.4} fill="none" />

          {curve.map((p) => (
            <g key={p.d} onClick={() => pick(p.d)} style={{ cursor: guess ? 'default' : 'pointer' }}>
              <rect x={x(p.d) - 22} y={26} width={44} height={300} fill="transparent" />
              <circle cx={x(p.d)} cy={y(p.tr)} r={4} fill="var(--brand)" />
              <circle cx={x(p.d)} cy={y(p.va)} r={4} fill="var(--bad)" />
              <text x={x(p.d)} y={348} fontSize={11.5} textAnchor="middle"
                    fill={p.d === best ? 'var(--ok-deep)' : 'var(--muted)'}
                    fontWeight={p.d === best ? 700 : 400}>{p.d}</text>
            </g>
          ))}

          {guess && (
            <line x1={x(best)} y1={30} x2={x(best)} y2={326} stroke="var(--ok)" strokeWidth={2} strokeDasharray="5 4" />
          )}
          {guess && !guess.correct && (
            <line x1={x(guess.d)} y1={30} x2={x(guess.d)} y2={326} stroke="var(--muted-faint)" strokeWidth={2} strokeDasharray="3 4" />
          )}

          <text x={470} y={372} fontSize={11.5} textAnchor="middle" fill="var(--muted-light)">树的最大深度 max_depth</text>
        </svg>

        <div style={{ display: 'flex', gap: 18, marginTop: 6, fontSize: 12 }}>
          <span style={{ color: 'var(--brand)' }}>—— 训练误差</span>
          <span style={{ color: 'var(--bad)' }}>—— 验证误差</span>
        </div>
      </Card>

      {!guess ? (
        <Card title="轮到你了">
          <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8 }}>
            <b>点一下你认为过拟合开始的那个深度</b>——也就是验证误差不再改善的地方。
          </div>
        </Card>
      ) : (
        <>
          <Feedback tone={guess.correct ? 'ok' : 'warn'} title={guess.correct ? '正是这里' : `实际是 depth ${best}`}>
            验证误差在 depth {best} 降到最低的 {pct(bestPoint.va)}，之后升到 {pct(deepest.va)} 并不再改善；
            而训练误差从 {pct(bestPoint.tr)} 一路降到 {pct(deepest.tr)}。
            {!guess.correct && ` 你选的 depth ${guess.d} 验证误差是 ${pct(curve.find((p) => p.d === guess.d).va)}。`}
            {' '}多出来的那些深度，只在训练集上有收益。
          </Feedback>

          <Card title="刚好停住的树，和分得太细的树">
            <div style={{ display: 'flex', gap: 16 }}>
              {[{ d: best, tone: 'ok', tag: '泛化最好' }, { d: deepest.d, tone: 'bad', tag: '过拟合' }].map((c) => {
                const p = curve.find((q) => q.d === c.d)
                return (
                  <div key={c.d} style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 500 }}>depth = {c.d}</span>
                      <Chip tone={c.tone}>{c.tag}</Chip>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.leaves} 个叶子</span>
                    </div>
                    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, padding: 8 }}>
                      <TreeView tree={trees[c.d]} width={400} height={180} compact pad={40} />
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                      验证误差 {pct(p.va)} · 训练误差 {pct(p.tr)}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <Feedback tone="neutral" title="曲线为什么不是光滑的 U 形">
            验证集只有 {VAL.length} 个样本，判错一个就是 {(100 / VAL.length).toFixed(2)} 个百分点，
            所以曲线天然是抖的。depth 2 的验证误差（{pct(curve[1].va)}）就比 depth 3（{pct(curve[2].va)}）低，
            那是个真实的小回落。趋势可信，单点不可信——这也正是交叉验证存在的理由。
          </Feedback>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- step 6

/**
 * Prune, then test the result on a fruit the tree has never seen.
 *
 * The verdict is computed against the best achievable validation error, so
 * "pruned well" means something specific rather than being a compliment.
 */
export function PruneExplorer({ onEvidence }) {
  const { curve, best } = useCurve()
  const [depth, setDepth] = useState(5)
  const [minLeaf, setMinLeaf] = useState(1)
  const [overPruned, setOverPruned] = useState(false)

  const bestVa = curve.find((p) => p.d === best).va
  const tree = useMemo(() => grow(TRAIN, 0, depth, minLeaf), [depth, minLeaf])
  const trErr = errRate(tree, TRAIN)
  const vaErr = errRate(tree, VAL)
  const leaves = leafCount(tree)
  const good = vaErr <= bestVa + 0.02

  // Pruning far enough to hurt is the mistake this step is watching for.
  useEffect(() => {
    if (vaErr > bestVa + 0.05 && minLeaf > 1 && !overPruned) {
      setOverPruned(true)
      onEvidence({
        kind: 'labAction',
        correct: false,
        misconceptionId: 'pruning_always_helps',
        detail: { labStep: 'over-prune', depth, minLeaf },
        description: `把 min_samples_leaf 调到 ${minLeaf}，叶子剩 ${leaves} 个，验证误差升到 ${pct(vaErr)}`,
        facts: [
          `最优设置的验证误差是 ${pct(bestVa)}（depth ${best}, min_samples_leaf 1）`,
          `当前设置 depth ${depth}、min_samples_leaf ${minLeaf}：${leaves} 个叶子，训练误差 ${pct(trErr)}，验证误差 ${pct(vaErr)}`,
        ],
      })
    }
  }, [vaErr, bestVa, minLeaf, overPruned, depth, leaves, trErr, best, onEvidence])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="两个旋钮">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Slider label="max_depth" value={depth} min={1} max={8} onChange={setDepth}
                  note={depth === best ? '验证误差最低点' : undefined} />
          <Slider label="min_samples_leaf" value={minLeaf} min={1} max={16} onChange={setMinLeaf}
                  note="一个叶子至少要有多少样本" />
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
          <Stat label="叶子数" value={leaves} />
          <Stat label="训练误差" value={pct(trErr)} />
          <Stat label="验证误差" value={pct(vaErr)} tone={good ? 'var(--ok-deep)' : 'var(--bad)'} />
          <Stat label="能达到的最低" value={pct(bestVa)} sub={`depth ${best}`} />
        </div>
      </Card>

      <Feedback tone={good ? 'ok' : 'warn'} title={good ? '剪得不错' : '还可以调'}>
        {good
          ? `验证误差 ${pct(vaErr)}，接近能达到的最低点 ${pct(bestVa)}，而树只有 ${leaves} 个叶子。在不损失泛化的前提下换来更简单的模型，这正是剪枝要找的位置。`
          : `验证误差 ${pct(vaErr)}，比最低点 ${pct(bestVa)} 高。${minLeaf > 6 ? '剪过头了——模型容量不足以表达真实规律，这是欠拟合。' : '再调调两个旋钮。'}`}
      </Feedback>

      <Card title="剪枝后的树" right={<Chip tone={good ? 'ok' : 'warn'}>{leaves} 个叶子</Chip>}>
        <TreeView tree={tree} width={900} height={260} />
      </Card>

      <QuizCard onEvidence={onEvidence} />
    </div>
  )
}

/**
 * Walk one unseen fruit down the tree by hand.
 *
 * Uses the authored step-1 tree rather than the trained one, so the learner is
 * re-reading the tree they were first taught on and can follow every branch.
 */
function QuizCard({ onEvidence }) {
  const tree = useMemo(() => buildFromSpec(SAMPLES, ILLUSTRATIVE_SPEC), [])
  const fruit = { w: 198, peel: 2, aroma: 1 }
  const truth = ORANGE

  const [answers, setAnswers] = useState([])
  const { path: fullPath, leaf: trueLeaf } = decisionPath(tree, fruit)

  // Walk the tree following the learner's own yes/no choices.
  let node = tree
  const asked = []
  for (const a of answers) {
    if (!node.split) break
    asked.push({ q: splitLabel(node.split.key, node.split.thr), a })
    node = a ? node.left : node.right
  }
  const asking = Boolean(node.split)
  const done = !asking
  const correct = done && node.cls === truth

  const answer = (yes) => {
    const next = [...answers, yes]
    setAnswers(next)
    // Only score once the walk reaches a leaf.
    let n = tree
    for (const a of next) { if (!n.split) break; n = a ? n.left : n.right }
    if (!n.split) {
      const ok = n.cls === truth
      onEvidence({
        kind: 'labAction',
        correct: ok,
        detail: { labStep: 'quiz-walk', answers: next },
        description: ok
          ? '正确地把新水果沿树走到了叶子'
          : `走到了判为${n.cls === APPLE ? '苹果' : '橙子'}的叶子，真实答案是橙子`,
        facts: [
          `这个水果：重量 ${fruit.w} g，果皮${PEEL_LABEL[fruit.peel]}，有果香，真实类别是橙子`,
          `正确路径：${fullPath.map((p) => `${p.question} → ${p.answer ? '是' : '否'}`).join('，')}`,
          `正确叶子里 ${counts(trueLeaf.rows).n} 个样本，${counts(trueLeaf.rows).o} 个橙子`,
        ],
      })
    }
  }

  return (
    <Card title="小测验：新来一个水果">
      <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
        {[`重量 ${fruit.w} g`, `果皮${PEEL_LABEL[fruit.peel]}等厚`, fruit.aroma ? '有果香' : '无果香'].map((t) => (
          <Chip key={t} tone="brand">{t}</Chip>
        ))}
      </div>

      {asked.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
          你走的路径：{asked.map((a) => `${a.q} ${a.a ? '是' : '否'}`).join(' → ')}
        </div>
      )}

      {asking ? (
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-strong)', marginBottom: 12 }}>
            {splitLabel(node.split.key, node.split.thr)}？
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={() => answer(true)}>是</Button>
            <Button variant="ghost" onClick={() => answer(false)}>否</Button>
          </div>
        </div>
      ) : (
        <>
          <Feedback tone={correct ? 'ok' : 'bad'} title={correct ? '走对了 · 真实答案是橙子' : '走错了 · 真实答案是橙子'}>
            这棵树判定：{classEmoji(node.cls)} {node.cls === APPLE ? '苹果' : '橙子'}。
            {correct
              ? ` 果皮中等厚不是薄，走「否」；重量 ${fruit.w} g 大于 180，再走「否」，落到最右边那个叶子。这个叶子里 ${counts(trueLeaf.rows).n} 个样本有 ${counts(trueLeaf.rows).o} 个是橙子，所以判橙子。`
              : ` 再看一眼这个水果：果皮是「中」，不是薄；重量 ${fruit.w} g 比 180 大。两个问题都该走「否」。`}
          </Feedback>
          <div style={{ marginTop: 12 }}>
            <Button variant="quiet" onClick={() => setAnswers([])}>再走一遍</Button>
          </div>
        </>
      )}
    </Card>
  )
}
