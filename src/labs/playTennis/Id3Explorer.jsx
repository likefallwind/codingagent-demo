/**
 * The ID3 lab: rank features, then watch an identifier column break the ranking.
 *
 * Everything in the table is computed by ../decisionTree/algo.js, the same code
 * the tests pin to Quinlan's published figures. The `Day` column can be switched
 * in and out, which is the whole experiment: with it present, information gain
 * picks a useless identifier, and gain ratio — the fix textbooks name — does not
 * rescue the situation on this dataset.
 */

import React, { useMemo, useState } from 'react'
import {
  entropy, infoGain, gainRatio, splitInfo, rankFeatures, partition,
  c45Select, isIdentifierLike, CRITERIA,
} from '../decisionTree/algo.js'
import { playTennis as ds } from '../decisionTree/datasets.js'
import { Card, Stat, Chip, Choice, Feedback, Button } from '../../components/ui.jsx'

const f4 = (v) => v.toFixed(4)

export default function Id3Explorer({ onEvidence }) {
  const [withTrap, setWithTrap] = useState(false)
  const [criterion, setCriterion] = useState('infoGain')
  const [guess, setGuess] = useState(null)

  const features = withTrap ? [...ds.features, 'Day'] : ds.features
  const ranked = useMemo(
    () => rankFeatures(ds.rows, features, ds.target, criterion),
    [features, criterion],
  )
  const c45 = useMemo(() => c45Select(ds.rows, features, ds.target), [features])
  const baseEntropy = entropy(ds.rows, ds.target)

  const answer = (key) => {
    if (guess) return
    const winner = ranked[0].feature
    const correct = key === winner
    setGuess({ key, correct, winner })
    onEvidence({
      kind: 'labAction',
      correct,
      misconceptionId: correct ? null : 'gain_ratio_fixes_bias',
      detail: { labStep: 'predict-winner', criterion, withTrap, guess: key },
      description: correct
        ? `正确预测了${CRITERIA[criterion].label}会选 ${winner}`
        : `以为${CRITERIA[criterion].label}会选 ${key}，实际会选 ${winner}`,
      facts: ranked.map((r) =>
        `${ds.labels[r.feature] ?? r.feature}：信息增益 ${f4(r.infoGain)}，split info ${f4(r.splitInfo)}，增益率 ${f4(r.gainRatio)}，${r.branches} 个分支`),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="数据集：打网球（14 天）">
        <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
          <Stat label="样本数" value={ds.rows.length} />
          <Stat label="类别分布" value="9 打 / 5 不打" />
          <Stat label="初始熵" value={f4(baseEntropy)} sub="bits" />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                {['Day', ...ds.features, ds.target].map((h) => (
                  <th key={h} style={{ padding: '6px 8px', fontWeight: 500 }}>{ds.labels[h] ?? h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ds.rows.slice(0, 5).map((r) => (
                <tr key={r.Day} style={{ borderTop: '1px solid var(--border-faint)' }}>
                  {['Day', ...ds.features, ds.target].map((k) => (
                    <td key={k} className={k === 'Day' ? 'mono' : undefined} style={{ padding: '6px 8px' }}>
                      {k === 'Day' ? r[k] : (ds.valueLabels[r[k]] ?? r[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 8 }}>
          仅显示前 5 行，共 14 行。<b>Day</b> 是行编号——每行都不同，对预测毫无价值。
        </div>
      </Card>

      <Card title="实验设置">
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>把 Day 当作候选特征？</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Choice label="不包含 Day" selected={!withTrap}
                      onClick={() => { setWithTrap(false); setGuess(null) }} />
              <Choice label="包含 Day" hint="行编号，纯粹的标识符" selected={withTrap}
                      onClick={() => { setWithTrap(true); setGuess(null) }} />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>选择准则</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {Object.entries(CRITERIA).filter(([k]) => k !== 'giniGain').map(([k, c]) => (
                <Choice key={k} label={c.label} hint={c.algo} selected={criterion === k}
                        onClick={() => { setCriterion(k); setGuess(null) }} />
              ))}
            </div>
          </div>
        </div>
      </Card>

      {!guess && (
        <Card title="先预测">
          <div style={{ fontSize: 13.5, color: 'var(--ink-mid)', lineHeight: 1.8, marginBottom: 12 }}>
            按<b>{CRITERIA[criterion].label}</b>，你觉得算法会把哪个特征放在根节点？
          </div>
          {/* Grid rather than a wrapping flex row: Choice is width:100%, so under
              flex-wrap each tile claims its own line and five features become a
              very tall column. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {features.map((f) => (
              <Choice key={f} label={ds.labels[f] ?? f} onClick={() => answer(f)} />
            ))}
          </div>
        </Card>
      )}

      {guess && (
        <Feedback tone={guess.correct ? 'ok' : 'warn'}
                  title={guess.correct ? '预测正确' : `实际会选「${ds.labels[guess.winner] ?? guess.winner}」`}>
          按{CRITERIA[criterion].label}，排第一的是
          <b>{ds.labels[guess.winner] ?? guess.winner}</b>（{f4(ranked[0].score)}）。
          {withTrap && guess.winner === 'Day' && (
            <> Day 把每一天分成单独一支，每支都纯，所以增益等于整个数据集的熵 {f4(baseEntropy)}——这是可能达到的最大值。
              但它对预测新的一天毫无用处。</>
          )}
          {withTrap && criterion === 'gainRatio' && guess.winner === 'Day' && (
            <> 注意：增益率<b>并没有</b>挡住它。教科书常说增益率解决了多值偏好，在这个数据集上不成立。</>
          )}
          <div style={{ marginTop: 10 }}>
            <Button variant="quiet" onClick={() => setGuess(null)}>换个设置再试</Button>
          </div>
        </Feedback>
      )}

      <Card title="完整排名">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                {['特征', '信息增益', 'Split Info', '增益率', '分支数', '标识符?'].map((h) => (
                  <th key={h} style={{ padding: '8px', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const idLike = isIdentifierLike(ds.rows, r.feature)
                return (
                  <tr key={r.feature} style={{
                    borderTop: '1px solid var(--border-faint)',
                    background: i === 0 ? (idLike ? 'var(--bad-bg)' : 'var(--ok-bg)') : 'transparent',
                  }}>
                    <td style={{ padding: '8px', fontWeight: i === 0 ? 700 : 400 }}>
                      {ds.labels[r.feature] ?? r.feature}
                      {i === 0 && <span style={{ marginLeft: 8 }}><Chip tone={idLike ? 'bad' : 'ok'}>排第一</Chip></span>}
                    </td>
                    <td className="mono" style={{ padding: '8px' }}>{f4(r.infoGain)}</td>
                    <td className="mono" style={{ padding: '8px' }}>{f4(r.splitInfo)}</td>
                    <td className="mono" style={{ padding: '8px' }}>{f4(r.gainRatio)}</td>
                    <td className="mono" style={{ padding: '8px' }}>{r.branches}</td>
                    <td style={{ padding: '8px' }}>
                      {idLike ? <Chip tone="bad">是</Chip> : <span style={{ color: 'var(--muted-light)' }}>否</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {withTrap && (
        <Card title="C4.5 的官方启发式也失手了">
          <div style={{ fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-mid)' }}>
            C4.5 的实际做法是：<b>先筛掉信息增益低于平均值的特征，再在剩下的里取增益率最高者</b>。
            在这里它选出的是 <b>{ds.labels[c45.feature] ?? c45.feature}</b>。
            <div style={{ marginTop: 10 }}>
              原因是 Day 的增益（{f4(infoGain(ds.rows, 'Day', ds.target))}）太大，
              把平均值抬到了所有真实特征之上——它把自己变成了唯一的候选。
            </div>
            <div style={{ marginTop: 10 }}>
              真正挡住它的不是任何不纯度指标，而是一个结构性观察：
              这个特征切出 {partition(ds.rows, 'Day').size} 个分支、每支只有 1 个样本。
              这是在记录数据，不是在学习规律。
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
