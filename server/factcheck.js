/**
 * Numeric fact checking for model output.
 *
 * The grading prompt tells the model to cite only the figures it was given and
 * not to invent any. It invents them anyway: asked to explain why a deeper tree
 * is worse, it produced "训练误差从 3.8% 降到 2.9%" when the real figure is 6.3%.
 * The 2.9% was real and the sentence read as authoritative, which is precisely
 * what makes a wrong number in a teaching tool worse than no number.
 *
 * So the constraint is enforced rather than requested: every quantity in the
 * feedback must appear in the material the model was given. A violation is fed
 * back as a validation failure, which triggers the retry that chatJSON already
 * performs.
 */

/**
 * Pull every quantity out of a piece of text as a normalised number.
 *
 * Percentages and decimals are what matter — those are the claims a learner will
 * take away. Bare small integers ("那 1 个苹果", "两刀") are excluded: they are
 * usually counts flowing from the prose rather than cited statistics, and
 * policing them produces false positives without catching real errors.
 */
export function extractQuantities(text) {
  if (!text) return []
  const out = []
  // Percentages: 10%, 10.0%, 13.3%
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    out.push({ raw: m[0], value: Number(m[1]), kind: 'percent' })
  }
  // Bare decimals: 0.389, 6.3 — but not the integer part of a percentage, which
  // the pass above already consumed.
  for (const m of text.matchAll(/(?<![\d.%])(\d+\.\d+)(?!\s*%)/g)) {
    out.push({ raw: m[0], value: Number(m[1]), kind: 'decimal' })
  }
  return out
}

/** Two quantities match if they are numerically equal to within rounding. */
const sameValue = (a, b) => Math.abs(a - b) < 0.05

/**
 * Quantities in `text` that do not appear in `allowed`.
 *
 * Comparison is numeric, not textual, so a model writing "10%" against a source
 * saying "10.0%" is accepted — that is a formatting choice, not a new claim.
 * Percentages are also matched against their decimal form (13.3% vs 0.133),
 * since the prose and the underlying data express the same figure both ways.
 */
export function unknownQuantities(text, allowed) {
  const known = extractQuantities(allowed)
  return extractQuantities(text).filter((q) => {
    for (const k of known) {
      if (sameValue(q.value, k.value)) return false
      if (q.kind === 'percent' && sameValue(q.value / 100, k.value)) return false
      if (k.kind === 'percent' && sameValue(q.value, k.value / 100)) return false
    }
    return true
  })
}

/**
 * Validation message for invented figures, or null when everything checks out.
 * Names the offending values so the retry knows what to drop.
 */
export function checkQuantities(text, allowed) {
  const bad = unknownQuantities(text, allowed)
  if (bad.length === 0) return null
  const list = [...new Set(bad.map((q) => q.raw))].join('、')
  return `feedback 里出现了材料中没有的数字：${list}。只能引用给定事实里的数字，不确定就不要提数字。`
}

/**
 * Drop the sentences that carry an invented figure, keep the rest.
 *
 * The last resort after a retry still invents numbers: a reply with one bad
 * sentence usually has two good ones, and showing those beats showing nothing.
 * Sentences end at Chinese or Western terminators or a newline.
 */
export function redactUnknownFigures(text, allowed) {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?]?\n?/g) ?? []
  return sentences.filter((s) => unknownQuantities(s, allowed).length === 0).join('').trim()
}
