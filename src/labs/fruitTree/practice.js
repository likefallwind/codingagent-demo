/**
 * Generated practice for the fruit steps.
 *
 * Each generator turns a seed into a fresh multiple-choice question whose answer
 * is computed by the same CART code the labs run, so a generated question can
 * never be wrong in a way an authored one might be. They exist because a concept
 * has only two or three authored checks: once those are used up, re-asking one
 * the learner has already seen the answer to measures memory, not understanding.
 *
 * A generator returns { prompt, table?, options, explain, facts }. Options may
 * name a misconception from the concept's own catalogue; the registry adds the
 * id and kind. Nothing here imports React — the server regenerates questions
 * from their id to write hints for them.
 */

import {
  buildFromSpec, ILLUSTRATIVE_SPEC, counts, rankFeatures, learningCurve, grow, errRate, leafCount, splitLabel,
} from './cart.js'
import { SAMPLES, FEATURES, PEEL_LABEL, DEPTHS, generatePopulation, holdout, classLabel } from './dataset.js'
import { makeRng, intIn, shuffle, sample } from '../rng.js'

const f3 = (v) => v.toFixed(3)
const pct = (v) => `${(v * 100).toFixed(1)}%`
const log2 = (x) => Math.log(x) / Math.LN2
const entropy2 = (a, n) => {
  const p = a / n
  return [p, 1 - p].reduce((h, q) => (q > 0 ? h - q * log2(q) : h), 0)
}

/** Three distinct distractor values that do not collide with the answer at display precision. */
function distinctValues(correct, candidates, fmt, need = 3) {
  const seen = new Set([fmt(correct)])
  const out = []
  for (const v of candidates) {
    const k = fmt(v)
    if (!Number.isFinite(v) || seen.has(k)) continue
    seen.add(k)
    out.push(v)
    if (out.length === need) break
  }
  return out
}

// ---------------------------------------------------------------- step 1

/** Route a new fruit down the step-1 tree and name the leaf it lands in. */
function leafRoute(seed) {
  const rnd = makeRng(seed)
  const tree = buildFromSpec(SAMPLES, ILLUSTRATIVE_SPEC)
  const leaves = []
  const walk = (n, key) => {
    if (!n.split) { leaves.push({ key, node: n }); return }
    walk(n.left, `${key}L`)
    walk(n.right, `${key}R`)
  }
  walk(tree, 'r')

  const peel = intIn(rnd, 1, 3)
  // Weights near the 180 g threshold half the time — that is where reading the
  // question carefully (≤, not <) actually matters.
  const w = rnd() < 0.5 ? intIn(rnd, 176, 184) : intIn(rnd, 120, 260)
  const aroma = rnd() < 0.5 ? 1 : 0

  let n = tree
  let key = 'r'
  const path = []
  while (n.split) {
    const yes = ({ w, peel, aroma })[n.split.key] <= n.split.thr
    path.push(`${n.split.key === 'peel' ? '果皮是薄的吗' : '重量 ≤ 180 g 吗'}？${yes ? '是' : '否'}`)
    key += yes ? 'L' : 'R'
    n = yes ? n.left : n.right
  }

  const where = ['最左边', '中间', '最右边']
  const describe = (l, i) => {
    const c = counts(l.node.rows)
    return `${where[i]}的叶子（${c.n} 个样本：${c.a} 苹果 / ${c.o} 橙子，判为${classLabel(l.node.cls)}）`
  }
  return {
    prompt: `新来一个水果：重量 ${w} g，果皮${PEEL_LABEL[peel]}，${aroma ? '有' : '无'}果香。沿第 1 步那棵示例树（先问「果皮是薄的吗」，再问「重量 ≤ 180 g 吗」）走下去，它会落进哪个叶子？`,
    options: leaves.map((l, i) => ({ text: describe(l, i), correct: l.key === key })),
    explain: `${path.join(' → ')}。${aroma ? '' : '果香这棵树根本没问，有没有都一样。'}`,
    facts: leaves.map(describe),
  }
}

/**
 * Read a tree the learner has never seen: grown by the real algorithm on a new
 * sample from another orchard, sometimes without the peel feature so the root
 * question changes, then asked where a new fruit lands. Weights sit on a
 * threshold now and then, where reading "≤" carefully is the whole question.
 */
function routeNewTree(seed) {
  const rnd = makeRng(seed)
  const featureSets = [null, ['w', 'aroma'], ['w', 'peel'], null]
  for (let tries = 0; tries < 300; tries++) {
    const keys = featureSets[(seed + tries) % featureSets.length]
    const rows = sample(generatePopulation(30000 + seed * 3 + tries, 160), 48, rnd)
    const tree = grow(rows, 0, 2, 3, keys)
    const leaves = []
    const walk = (n, key) => {
      if (!n.split) { leaves.push({ key, node: n }); return }
      walk(n.left, `${key}L`)
      walk(n.right, `${key}R`)
    }
    walk(tree, 'r')
    if (leaves.length < 3 || !tree.split) continue
    if (new Set(leaves.map((l) => l.node.cls)).size < 2) continue

    const thresholds = []
    const collect = (n) => { if (n.split) { if (n.split.key === 'w') thresholds.push(n.split.thr); collect(n.left); collect(n.right) } }
    collect(tree)
    const w = thresholds.length && rnd() < 0.45 ? thresholds[intIn(rnd, 0, thresholds.length - 1)] + intIn(rnd, -1, 1) : intIn(rnd, 118, 262)
    const fruit = { w, peel: intIn(rnd, 1, 3), aroma: rnd() < 0.6 ? 1 : 0 }

    let n = tree
    let key = 'r'
    const path = []
    while (n.split) {
      const yes = fruit[n.split.key] <= n.split.thr
      path.push(`${splitLabel(n.split.key, n.split.thr)}？${yes ? '是' : '否'}`)
      key += yes ? 'L' : 'R'
      n = yes ? n.left : n.right
    }
    if (path.length < 2 && rnd() < 0.7) continue // mostly routes that ask two questions

    const mark = ['①', '②', '③', '④']
    const name = new Map(leaves.map((l, i) => [l.key, mark[i]]))
    const leafText = (l) => {
      const c = counts(l.node.rows)
      return `叶子 ${name.get(l.key)}：判为${classLabel(l.node.cls)}（${c.n} 个样本：${c.a} 苹果 / ${c.o} 橙子）`
    }
    const diagram = []
    const draw = (node, key, indent, branch) => {
      const head = indent + branch
      if (!node.split) { diagram.push(`${head}${leafText({ key, node })}`); return }
      diagram.push(`${head}${splitLabel(node.split.key, node.split.thr)} ？`)
      const pad = indent + (branch ? (branch.startsWith('├') ? '│   ' : '    ') : '')
      draw(node.left, `${key}L`, pad, '├─ 是 → ')
      draw(node.right, `${key}R`, pad, '└─ 否 → ')
    }
    draw(tree, 'r', '', '')

    const desc = `重量 ${fruit.w} g，果皮${PEEL_LABEL[fruit.peel]}，${fruit.aroma ? '有' : '无'}果香`
    return {
      prompt: `另一个果园的 ${rows.length} 个水果上，算法长出了下面这棵两层的树。新来一个水果：${desc}。它会落进哪个叶子？`,
      diagram,
      options: leaves.map((l) => ({ text: leafText(l), correct: l.key === key })),
      explain: `${path.join(' → ')}，落进叶子 ${name.get(key)}。注意「≤」：正好等于阈值也走「是」。`,
      facts: [...diagram, `这个水果：${desc}`],
    }
  }
  return routeNewTree(seed + 7)
}

// ---------------------------------------------------------------- step 2

/**
 * Gini of a node, or which of three cuts gains the most. Alternates by seed
 * unless `config.variant` pins one ('value' | 'compare') — verification asks
 * only the comparison, which is the capability; the arithmetic alone is not.
 */
function giniPractice(seed, config = {}) {
  const rnd = makeRng(seed)
  const variant = config.variant ?? (seed % 2 === 0 ? 'value' : 'compare')

  if (variant === 'value') {
    const n = intIn(rnd, 5, 16)
    let a = intIn(rnd, 1, n - 1)
    if (a * 2 === n && rnd() < 0.7) a = Math.max(1, a - 1) // 50/50 is the one they already know
    const b = n - a
    const g = 1 - (a / n) ** 2 - (b / n) ** 2
    const wrong = distinctValues(g, shuffle([
      entropy2(a, n), // the entropy, not the gini
      Math.min(a, b) / n, // the error rate of the majority vote
      1 - (a / n) ** 2, // forgot the second class
      (a / n) * (b / n), // half of the gini
      Math.abs(a - b) / n,
    ], rnd), f3)
    return {
      prompt: `一个节点里有 ${a} 个苹果、${b} 个橙子。它的基尼不纯度是多少？`,
      options: shuffle([{ text: f3(g), correct: true }, ...wrong.map((v) => ({ text: f3(v) }))], rnd),
      explain: `1 − (${a}/${n})² − (${b}/${n})² = ${f3(g)}。`,
      facts: [`${a} 个苹果、${b} 个橙子的基尼不纯度是 ${f3(g)}`],
    }
  }

  // Three candidate cuts of an 8/8 node. One is lopsided in size but clean, one
  // balanced in size but muddy — size is the intuition this is here to break.
  for (let tries = 0; tries < 50; tries++) {
    const cuts = Array.from({ length: 3 }, () => {
      const la = intIn(rnd, 0, 8)
      const lo = intIn(rnd, 0, 8)
      return { la, lo, ra: 8 - la, ro: 8 - lo }
    }).filter((c) => c.la + c.lo > 0 && c.ra + c.ro > 0)
    if (cuts.length < 3) continue
    const gainOf = (c) => {
      const gl = 1 - (c.la / (c.la + c.lo)) ** 2 - (c.lo / (c.la + c.lo)) ** 2
      const gr = 1 - (c.ra / (c.ra + c.ro)) ** 2 - (c.ro / (c.ra + c.ro)) ** 2
      return 0.5 - ((c.la + c.lo) * gl + (c.ra + c.ro) * gr) / 16
    }
    const scored = cuts.map((c) => ({ ...c, gain: gainOf(c) })).sort((x, y) => y.gain - x.gain)
    // A clear winner, and three visibly different gains.
    if (scored[0].gain - scored[1].gain < 0.02 || scored[1].gain - scored[2].gain < 0.005) continue
    const label = (c) => `左边 ${c.la} 苹果 / ${c.lo} 橙子，右边 ${c.ra} 苹果 / ${c.ro} 橙子`
    return {
      prompt: '一个节点里有 8 个苹果、8 个橙子（基尼 0.500）。下面三种切法，哪一种的增益最高？',
      options: shuffle(scored.map((c, i) => ({ text: label(c), correct: i === 0 })), rnd),
      explain: scored.map((c) => `${label(c)}：增益 ${f3(c.gain)}`).join('；') + '。看的是切完之后两边各自有多纯，再按样本数加权。',
      facts: scored.map((c) => `${label(c)}，增益 ${f3(c.gain)}`),
    }
  }
  return giniPractice(seed + 2, config)
}

// ---------------------------------------------------------------- step 3

/**
 * Which question the greedy algorithm asks first on a small subset of the samples.
 *
 * On the full sixteen, peel always wins, so a naive random subset asks the same
 * question with the same answer nearly every time and the learner learns "pick
 * peel". The seed therefore chooses which feature should win, and the subset is
 * searched until it does.
 */
function firstCut(seed) {
  const rnd = makeRng(seed)
  const target = FEATURES[seed % FEATURES.length].key
  let fallback = null
  for (let tries = 0; tries < 4000; tries++) {
    const rows = sample(SAMPLES, intIn(rnd, 6, 8), rnd).sort((x, y) => x.w - y.w)
    const c = counts(rows)
    if (c.a < 2 || c.o < 2) continue
    const ranking = rankFeatures(rows, FEATURES)
    if (ranking.some((r) => r.thr === null)) continue // every feature must be able to cut
    if (ranking[0].gain - ranking[1].gain < 0.01) continue // one clear winner
    const q = {
      prompt: `只看下表这 ${rows.length} 个水果。贪心算法的第一刀会问哪个问题？（每个特征按它自己最好的阈值来切）`,
      table: {
        columns: ['类别', '重量', '果皮', '果香'],
        rows: rows.map((r) => [classLabel(r.c), `${r.w} g`, PEEL_LABEL[r.peel], r.aroma ? '有' : '无']),
      },
      options: shuffle(ranking.map((r, i) => ({ text: r.condition, correct: i === 0 })), rnd),
      explain: `三个特征各自最好的一刀：${ranking.map((r) => `「${r.condition}」增益 ${f3(r.gain)}`).join('，')}。算法只看眼前，取最大的那一刀。`,
      facts: ranking.map((r) => `「${r.condition}」增益 ${f3(r.gain)}`),
    }
    if (ranking[0].key === target) return q
    fallback ??= q
  }
  return fallback ?? firstCut(seed + FEATURES.length)
}

// ---------------------------------------------------------------- step 4

/**
 * Either the structural leaf bound, or reading train vs validation for two
 * depths ('bound' | 'table'). In the table variant the deeper tree sometimes
 * generalises better and sometimes worse, so "deeper is worse" cannot pass it
 * any more than "deeper is better" can.
 */
function depthPractice(seed, config = {}) {
  const rnd = makeRng(seed)
  const variant = config.variant ?? (seed % 2 === 0 ? 'bound' : 'table')

  if (variant === 'bound') {
    const d = intIn(rnd, 3, 10)
    const right = 2 ** d
    const wrong = distinctValues(right, shuffle([2 * d, 2 ** (d - 1), 2 ** (d + 1), d * d, d + 1], rnd), String)
    return {
      prompt: `一棵最大深度为 ${d} 的二叉决策树，最多能有几个叶子？`,
      options: shuffle([{ text: String(right), correct: true }, ...wrong.map((v) => ({ text: String(v) }))], rnd),
      explain: `每深一层，每个节点最多分成两个，叶子数最多翻一倍：2 的 ${d} 次方 = ${right}。实际往往少得多——节点纯了或样本不够就不再分。`,
      facts: [`深度 ${d} 的二叉树最多 ${right} 个叶子`],
    }
  }

  for (let tries = 0; tries < 100; tries++) {
    const { train, val } = holdout(generatePopulation(90000 + seed * 7 + tries, 300))
    const a = intIn(rnd, 2, 5)
    const b = intIn(rnd, a + 2, 8)
    const ta = grow(train, 0, a)
    const tb = grow(train, 0, b)
    const trA = errRate(ta, train)
    const trB = errRate(tb, train)
    const vaA = errRate(ta, val)
    const vaB = errRate(tb, val)
    if (trB >= trA || Math.abs(vaA - vaB) < 0.01) continue
    const worse = vaB > vaA
    const options = worse
      ? [
          { text: `depth ${b} 在训练集上更准，在验证集上反而更差——多记住的只是训练样本`, correct: true },
          { text: `depth ${b} 更好——它的训练误差更低`, misconception: 'deeper_is_better' },
          { text: `两者一样好——训练误差都不高` },
          { text: `depth ${a} 在两个数据集上都更好` },
        ]
      : [
          { text: `depth ${b} 更好——它在验证集上的误差也更低`, correct: true },
          { text: `depth ${a} 更好——越浅的树越不会过拟合` },
          { text: `没法比较——训练误差总会随深度下降` },
          { text: `depth ${b} 在训练集上更准，在验证集上反而更差` },
        ]
    return {
      prompt: `换一个果园的数据（${train.length} 个训练、${val.length} 个验证），建了两棵树。根据下表，哪个说法成立？`,
      table: {
        columns: ['max_depth', '叶子数', '训练误差', '验证误差'],
        rows: [[a, leafCount(ta), pct(trA), pct(vaA)], [b, leafCount(tb), pct(trB), pct(vaB)]],
      },
      options: shuffle(options, rnd),
      explain: `训练误差从 ${pct(trA)} 降到 ${pct(trB)}，这是加深的必然结果；该看的是验证误差：${pct(vaA)} → ${pct(vaB)}。`,
      facts: [`depth ${a}：训练误差 ${pct(trA)}，验证误差 ${pct(vaA)}`, `depth ${b}：训练误差 ${pct(trB)}，验证误差 ${pct(vaB)}`],
    }
  }
  return depthPractice(seed + 2, config)
}

// ---------------------------------------------------------------- step 5

/** Read a learning curve from another orchard and pick the depth. */
function pickDepth(seed) {
  const rnd = makeRng(seed)
  for (let tries = 0; tries < 200; tries++) {
    const { train, val } = holdout(generatePopulation(70000 + seed * 13 + tries, 300))
    const { curve } = learningCurve(train, val, DEPTHS)
    const minVa = Math.min(...curve.map((p) => p.va))
    const winners = curve.filter((p) => Math.abs(p.va - minVa) < 1e-9)
    if (winners.length !== 1) continue // an unambiguous answer
    const best = winners[0].d
    if (best === 1 || best === 8) continue // the deepest must be the tempting wrong answer
    const others = shuffle(DEPTHS.filter((d) => ![best, 8, 1].includes(d)), rnd).slice(0, 1)
    const opts = [
      { text: `depth ${best}`, correct: true },
      { text: 'depth 8', misconception: 'train_error_measures_quality' },
      { text: 'depth 1' },
      ...others.map((d) => ({ text: `depth ${d}` })),
    ]
    const bp = curve.find((p) => p.d === best)
    const deep = curve[curve.length - 1]
    return {
      prompt: `另一个果园的数据（${train.length} 个训练、${val.length} 个验证）画出了下面这张表。max_depth 应该选多少？`,
      table: {
        columns: ['max_depth', '叶子数', '训练误差', '验证误差'],
        rows: curve.map((p) => [p.d, p.leaves, pct(p.tr), pct(p.va)]),
      },
      options: shuffle(opts, rnd),
      explain: `验证误差在 depth ${best} 最低（${pct(bp.va)}）。训练误差在 depth 8 最低（${pct(deep.tr)}），但它永远支持更深，不能拿来选深度。`,
      facts: curve.map((p) => `depth ${p.d}：${p.leaves} 个叶子，训练误差 ${pct(p.tr)}，验证误差 ${pct(p.va)}`),
    }
  }
  return pickDepth(seed + 1)
}

// ---------------------------------------------------------------- step 6

/** Choose among four pruning settings by the one number that should decide it. */
function pickSetting(seed) {
  const rnd = makeRng(seed)
  const pool = []
  for (const d of [3, 4, 5, 6, 8]) for (const m of [1, 2, 4, 6, 8, 12, 16]) pool.push({ d, m })
  for (let tries = 0; tries < 300; tries++) {
    const { train, val } = holdout(generatePopulation(50000 + seed * 11 + (tries >> 3), 300))
    const picks = sample(pool, 4, rnd).map((s) => {
      const t = grow(train, 0, s.d, s.m)
      return { ...s, leaves: leafCount(t), tr: errRate(t, train), va: errRate(t, val) }
    })
    const minVa = Math.min(...picks.map((p) => p.va))
    const best = picks.filter((p) => Math.abs(p.va - minVa) < 1e-9)
    if (best.length !== 1) continue
    const minTr = picks.reduce((x, y) => (y.tr < x.tr ? y : x))
    if (minTr === best[0]) continue // lowest training error must be a trap, not the answer
    const fewest = picks.reduce((x, y) => (y.leaves < x.leaves ? y : x))
    const label = (p) => `max_depth ${p.d}，min_samples_leaf ${p.m}`
    return {
      prompt: '同一批 240 个训练样本、60 个验证样本，试了四种剪枝设置。选哪个？',
      table: {
        columns: ['设置', '叶子数', '训练误差', '验证误差'],
        rows: picks.map((p) => [label(p), p.leaves, pct(p.tr), pct(p.va)]),
      },
      options: picks.map((p) => ({
        text: label(p),
        correct: p === best[0],
        misconception: p !== best[0] && p === fewest ? 'pruning_always_helps' : undefined,
      })),
      explain: `验证误差最低的是「${label(best[0])}」（${pct(best[0].va)}）。训练误差最低的「${label(minTr)}」不是选择依据；叶子最少也不是目标本身。`,
      facts: picks.map((p) => `${label(p)}：${p.leaves} 个叶子，训练误差 ${pct(p.tr)}，验证误差 ${pct(p.va)}`),
    }
  }
  return pickSetting(seed + 1)
}

export const fruitPractice = {
  'leaf-route': leafRoute,
  'route-new-tree': routeNewTree,
  'gini-value': giniPractice,
  'first-cut': firstCut,
  'depth-read': depthPractice,
  'pick-depth': pickDepth,
  'pick-setting': pickSetting,
}
