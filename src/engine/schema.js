/**
 * The Course schema — the contract that makes this platform topic-agnostic.
 *
 * The engine (learner model, policy, tutor) never mentions decision trees. A
 * course is data: a concept graph with objectives, layered explanations, checks,
 * and a catalogue of known misconceptions. Teaching a new subject means authoring
 * one of these documents, not touching engine code.
 *
 * The only topic-specific CODE is the interactive widget a concept names in
 * `lab.type`, resolved through the lab registry.
 */

/**
 * Evidence strength by source. A judgement in a lab is worth more than a lucky
 * guess; merely having done something in a lab (dragged a slider past a point,
 * found a cut by sweeping) shows engagement, not understanding, so it barely
 * moves the estimate.
 */
export const EVIDENCE_WEIGHT = {
  mcq: 0.6,
  freeResponse: 1.0,
  labAction: 1.0,
  labExplore: 0.3,
  prediction: 0.8,
}

/**
 * Validate a course document, returning an array of human-readable problems.
 * An empty array means the course is well-formed.
 *
 * This runs in dev and in the authoring pipeline: a generated course is only
 * trustworthy if it is checked, and a dangling prerequisite or a check with no
 * rubric fails silently at runtime otherwise.
 */
export function validateCourse(course) {
  const errs = []
  const need = (cond, msg) => { if (!cond) errs.push(msg) }

  need(course && typeof course === 'object', 'course must be an object')
  if (errs.length) return errs

  need(typeof course.id === 'string' && course.id, 'course.id missing')
  need(typeof course.title === 'string' && course.title, 'course.title missing')
  need(Array.isArray(course.concepts) && course.concepts.length > 0, 'course.concepts must be a non-empty array')
  if (errs.length) return errs

  const ids = new Set()
  for (const c of course.concepts) {
    const at = `concept "${c.id ?? '(no id)'}"`
    need(typeof c.id === 'string' && c.id, `${at}: id missing`)
    need(!ids.has(c.id), `${at}: duplicate id`)
    ids.add(c.id)
    need(typeof c.title === 'string' && c.title, `${at}: title missing`)
    need(c.chapter === undefined || (typeof c.chapter === 'string' && c.chapter), `${at}: chapter must be a non-empty string`)
    // Generated practice is how a concept keeps producing fresh questions once
    // its authored checks are used up; the generator itself is topic code.
    need(c.practice === undefined || (typeof c.practice?.type === 'string' && c.practice.type), `${at}: practice.type missing`)
    need(Array.isArray(c.objectives) && c.objectives.length > 0, `${at}: needs at least one objective`)
    need(c.explain && typeof c.explain === 'object', `${at}: explain missing`)
    need(typeof c.explain?.intuition === 'string', `${at}: explain.intuition missing`)
    need(Array.isArray(c.checks), `${at}: checks must be an array`)
    // Optional, but if present it must not simply echo the quiz: surfacing a
    // check as a "you might ask" prompt gives the answer away before it is asked.
    if (c.suggestions !== undefined) {
      need(Array.isArray(c.suggestions), `${at}: suggestions must be an array`)
      for (const q of c.suggestions ?? []) {
        need(typeof q === 'string' && q.length > 0, `${at}: suggestion must be a non-empty string`)
        need(!(c.checks ?? []).some((chk) => chk.prompt === q), `${at}: suggestion "${q}" duplicates a check prompt`)
      }
    }

    for (const [i, chk] of (c.checks ?? []).entries()) {
      const cat = `${at} check[${i}]`
      need(typeof chk.id === 'string' && chk.id, `${cat}: id missing`)
      need(['mcq', 'freeResponse', 'prediction'].includes(chk.kind), `${cat}: kind must be mcq|freeResponse|prediction`)
      need(typeof chk.prompt === 'string' && chk.prompt, `${cat}: prompt missing`)
      if (chk.kind === 'mcq') {
        need(Array.isArray(chk.options) && chk.options.length >= 2, `${cat}: mcq needs >= 2 options`)
        need(chk.options?.some((o) => o.correct), `${cat}: mcq has no correct option`)
        for (const o of chk.options ?? []) {
          if (o.misconception === undefined) continue
          need((c.misconceptions ?? []).some((x) => x.id === o.misconception), `${cat}: option references unknown misconception "${o.misconception}"`)
        }
      } else {
        need(typeof chk.rubric === 'string' && chk.rubric, `${cat}: ${chk.kind} needs a rubric for the grader`)
      }
      for (const m of chk.misconceptions ?? []) {
        need((c.misconceptions ?? []).some((x) => x.id === m), `${cat}: references unknown misconception "${m}"`)
      }
    }

    for (const m of c.misconceptions ?? []) {
      need(typeof m.id === 'string' && m.id, `${at}: misconception missing id`)
      need(typeof m.belief === 'string' && m.belief, `${at} misconception "${m.id}": needs the mistaken belief stated`)
      need(typeof m.correction === 'string' && m.correction, `${at} misconception "${m.id}": needs a correction strategy`)
    }
  }

  // Prerequisites must resolve, and must not form a cycle — either one leaves a
  // learner with concepts that can never unlock.
  for (const c of course.concepts) {
    for (const p of c.prerequisites ?? []) {
      need(ids.has(p), `concept "${c.id}": unknown prerequisite "${p}"`)
    }
  }
  const cycle = findCycle(course.concepts)
  need(!cycle, `prerequisite cycle: ${cycle?.join(' -> ')}`)

  return errs
}

/** Depth-first cycle detection over the prerequisite edges. */
function findCycle(concepts) {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const state = new Map() // id -> 'open' | 'done'
  const stack = []

  const visit = (id) => {
    if (state.get(id) === 'done') return null
    if (state.get(id) === 'open') return [...stack.slice(stack.indexOf(id)), id]
    state.set(id, 'open')
    stack.push(id)
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if (!byId.has(p)) continue
      const found = visit(p)
      if (found) return found
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }

  for (const c of concepts) {
    const found = visit(c.id)
    if (found) return found
  }
  return null
}

/** Concepts in an order that always places prerequisites first. */
export function topoOrder(concepts) {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const seen = new Set()
  const out = []
  const visit = (id) => {
    if (seen.has(id) || !byId.has(id)) return
    seen.add(id)
    for (const p of byId.get(id).prerequisites ?? []) visit(p)
    out.push(byId.get(id))
  }
  for (const c of concepts) visit(c.id)
  return out
}
