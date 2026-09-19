/**
 * Seeded randomness for generated practice.
 *
 * A generated question must be reproducible from its seed alone: the page shows
 * it, the server regenerates it to write a hint without trusting the client's
 * copy, and the walkthrough tests regenerate it to know the right answer.
 *
 * Mulberry32 rather than the population's LCG: practice seeds are consecutive
 * integers (0, 1, 2 …), and an LCG started from neighbouring seeds produces
 * neighbouring sequences — the "fresh" question came out nearly identical to
 * the last one. Mulberry32 scrambles each step, so seed 1 has nothing to do with
 * seed 0.
 */
export function makeRng(seed) {
  let a = ((seed >>> 0) ^ 0x9e3779b9) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [lo, hi], inclusive. */
export const intIn = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

/** Fisher–Yates on a copy. */
export function shuffle(items, rnd) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `n` distinct items from `items`. */
export const sample = (items, n, rnd) => shuffle(items, rnd).slice(0, n)
