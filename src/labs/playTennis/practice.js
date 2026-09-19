/**
 * Generated practice for the ID3 chapter. Same contract as the fruit
 * generators: a seed in, a multiple-choice question out, every answer computed.
 */

import { makeRng, intIn, shuffle } from '../rng.js'

const f3 = (v) => v.toFixed(3)
const log2 = (x) => Math.log(x) / Math.LN2
const h2 = (k, n) => {
  const p = k / n
  return [p, 1 - p].reduce((h, q) => (q > 0 ? h - q * log2(q) : h), 0)
}

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

/** Entropy of a two-class set. The error-rate distractor is the misconception this concept catalogues. */
function entropyValue(seed) {
  const rnd = makeRng(seed)
  const n = intIn(rnd, 4, 16)
  let k = intIn(rnd, 1, n - 1)
  if (k * 2 === n && rnd() < 0.7) k = Math.max(1, k - 1) // 1 bit is the one they already know
  const h = h2(k, n)
  const err = Math.min(k, n - k) / n
  const gini = 1 - (k / n) ** 2 - ((n - k) / n) ** 2
  const others = distinctValues(h, shuffle([gini, 1 - h, k / n, Math.abs(2 * k - n) / n], rnd), f3, 2)
  const opts = [{ text: f3(h), correct: true }, ...others.map((v) => ({ text: f3(v) }))]
  if (f3(err) !== f3(h) && !others.some((v) => f3(v) === f3(err))) {
    opts.push({ text: f3(err), misconception: 'entropy_is_error' })
  } else {
    const extra = distinctValues(h, [h / 2, Math.min(1, h + 0.25), 0], f3, 3).find((v) => !others.some((o) => f3(o) === f3(v)))
    opts.push({ text: f3(extra) })
  }
  return {
    prompt: `${n} 天里 ${k} 天打球、${n - k} 天不打。这个集合的熵是多少 bit？`,
    options: shuffle(opts, rnd),
    explain: `−(${k}/${n})·log₂(${k}/${n}) − (${n - k}/${n})·log₂(${n - k}/${n}) = ${f3(h)}。熵不是错误率：全猜多数类会错 ${f3(err)}。`,
    facts: [`${k} 打 / ${n - k} 不打的熵是 ${f3(h)} bit`, `全猜多数类的错误率是 ${f3(err)}`],
  }
}

/** Information gain of a row identifier — always the whole starting entropy. */
function idGain(seed) {
  const rnd = makeRng(seed)
  const n = intIn(rnd, 6, 20)
  const k = intIn(rnd, 1, n - 1)
  const h = h2(k, n)
  const opts = [{ text: f3(h), correct: true }, { text: f3(0) }]
  if (f3(log2(n)) !== f3(h)) opts.push({ text: f3(log2(n)), misconception: 'more_values_better' })
  const extra = distinctValues(h, [1, 0.5, h / 2, h / n], f3, 3).find((v) => !opts.some((o) => o.text === f3(v)))
  opts.push({ text: f3(extra) })
  return {
    prompt: `一个数据集有 ${n} 行，${k} 行是「是」、${n - k} 行是「否」。给它加一列行号 ID（每行都不一样），按 ID 分裂的信息增益是多少？`,
    options: shuffle(opts.slice(0, 4), rnd),
    explain: `ID 把每一行单独分成一支，每支都纯，分裂后的加权熵是 0，所以增益 = 初始熵 = ${f3(h)}，这是能达到的最大值。取值多只是让它切得碎，不是让它「信息量大」。`,
    facts: [`${k} 个「是」、${n - k} 个「否」的初始熵是 ${f3(h)} bit`, `${n} 行时 log₂${n} = ${f3(log2(n))}`],
  }
}

/** Split info of equal branches, or which of two features gain ratio prefers. */
function gainRatioPractice(seed) {
  const rnd = makeRng(seed)

  if (seed % 2 === 0) {
    const m = intIn(rnd, 2, 8)
    const per = intIn(rnd, 2, 5)
    const n = m * per
    const si = log2(m)
    const wrong = distinctValues(si, shuffle([m, log2(n), 1 / m, m / n, log2(per)], rnd), f3)
    return {
      prompt: `一个特征把 ${n} 个样本分成 ${m} 个一样大的分支（每支 ${per} 个）。它的 Split Info 是多少？`,
      options: shuffle([{ text: f3(si), correct: true }, ...wrong.map((v) => ({ text: f3(v) }))], rnd),
      explain: `Split Info 是分支大小分布的熵：${m} 个等大的分支，每支占 1/${m}，熵 = log₂${m} = ${f3(si)}。分支越多，它越大，增益率就被除得越狠。`,
      facts: [`${m} 个等大分支的 Split Info 是 ${f3(si)}`],
    }
  }

  for (let tries = 0; tries < 100; tries++) {
    const a = { ig: 0.1 + rnd() * 0.8, si: 0.8 + rnd() * 3.2 }
    const b = { ig: 0.05 + rnd() * 0.6, si: 0.8 + rnd() * 3.2 }
    if (a.ig - b.ig < 0.05) continue // A must win on raw gain
    const grA = a.ig / a.si
    const grB = b.ig / b.si
    if (Math.abs(grA - grB) < 0.02) continue
    const winner = grA > grB ? 'A' : 'B'
    return {
      prompt: `两个候选特征：A 的信息增益 ${f3(a.ig)}、Split Info ${f3(a.si)}；B 的信息增益 ${f3(b.ig)}、Split Info ${f3(b.si)}。按增益率，谁会被选中？`,
      options: shuffle([
        { text: 'A 胜出', correct: winner === 'A' },
        { text: 'B 胜出', correct: winner === 'B' },
        { text: '两者一样' },
        { text: '只给这些数字判断不了' },
      ], rnd),
      explain: `增益率 = 信息增益 ÷ Split Info。A：${f3(a.ig)} ÷ ${f3(a.si)} = ${f3(grA)}；B：${f3(b.ig)} ÷ ${f3(b.si)} = ${f3(grB)}。${winner === 'B' ? '信息增益高的 A 被自己的分支数拖了下来。' : 'A 的信息增益领先太多，除完仍然赢。'}`,
      facts: [`A 的增益率 ${f3(grA)}`, `B 的增益率 ${f3(grB)}`],
    }
  }
  return gainRatioPractice(seed + 2)
}

export const tennisPractice = {
  'entropy-value': entropyValue,
  'id-gain': idGain,
  'split-info': gainRatioPractice,
}
