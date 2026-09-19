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
 * Evidence strength by source, for the internal estimate only.
 *
 * Only judgements move it — a prediction, a submitted answer, a committed
 * choice in a lab. Exploring (dragging a slider past a point, sweeping until a
 * number peaks, opening an explanation) is recorded as behaviour and never
 * reaches the estimate: it shows the learner was active, not what they believe.
 */
export const EVIDENCE_WEIGHT = {
  mcq: 0.6,
  freeResponse: 1.0,
  labAction: 1.0,
  prediction: 0.8,
  verify: 1.0,
}

/** Activity types a task can declare. */
export const ACTIVITIES = ['lab', 'check', 'practice', 'verify', 'project', 'project-verify']

/**
 * Validate a course document, returning an array of human-readable problems.
 * An empty array means the course is well-formed.
 *
 * This runs in dev and in the authoring pipeline: a generated course is only
 * trustworthy if it is checked, and a dangling prerequisite or a check with no
 * rubric fails silently at runtime otherwise.
 *
 * `opts.generators`, when given, is the set of practice/verification generator
 * types that exist. A verification task naming a generator that does not exist
 * would otherwise surface only when a learner reached it — and a verification
 * that cannot be built must never be skipped into a pass.
 */
export function validateCourse(course, opts = {}) {
  const errs = []
  const need = (cond, msg) => { if (!cond) errs.push(msg) }
  const generators = opts.generators ? new Set(opts.generators) : null

  need(course && typeof course === 'object', 'course must be an object')
  if (errs.length) return errs

  need(typeof course.id === 'string' && course.id, 'course.id missing')
  need(typeof course.title === 'string' && course.title, 'course.title missing')
  need(course.version === undefined || (typeof course.version === 'string' && course.version), 'course.version must be a non-empty string')
  need(Array.isArray(course.concepts) && course.concepts.length > 0, 'course.concepts must be a non-empty array')
  if (errs.length) return errs

  const capIds = new Set()

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
    if (c.practice && generators) need(generators.has(c.practice.type), `${at}: practice type "${c.practice.type}" has no generator`)

    // A capability is what the learner is told they can now do; it is the unit
    // the evidence summary is organised by.
    if (c.capability !== undefined) {
      need(typeof c.capability?.id === 'string' && c.capability.id, `${at}: capability.id missing`)
      need(typeof c.capability?.title === 'string' && c.capability.title, `${at}: capability.title missing`)
      need(!capIds.has(c.capability?.id), `${at}: duplicate capability id "${c.capability?.id}"`)
      capIds.add(c.capability?.id)
      need(c.capability?.transfer === undefined || typeof c.capability.transfer === 'string', `${at}: capability.transfer must name a task`)
    }

    // An independent verification: unseen generated instances, graded by the
    // same code that generates them. Without a capability it would verify
    // nothing nameable; without a version its results could not be told apart
    // from an older task's.
    if (c.verify !== undefined) {
      need(c.capability, `${at}: verify needs a capability to verify`)
      need(typeof c.verify?.version === 'string' && c.verify.version, `${at}: verify.version missing`)
      need(typeof c.verify?.resources === 'string' && c.verify.resources, `${at}: verify.resources must say what the learner may use`)
      need(Array.isArray(c.verify?.items) && c.verify.items.length > 0, `${at}: verify.items must be a non-empty array`)
      for (const [i, item] of (c.verify?.items ?? []).entries()) {
        need(typeof item?.type === 'string' && item.type, `${at} verify.items[${i}]: type missing`)
        need(typeof item?.criterion === 'string' && item.criterion, `${at} verify.items[${i}]: criterion missing`)
        if (generators && item?.type) need(generators.has(item.type), `${at} verify.items[${i}]: generator "${item.type}" does not exist`)
      }
    }

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
        // Scoring points let a partly right answer keep what it got right.
        if (chk.points !== undefined) {
          need(Array.isArray(chk.points) && chk.points.length > 0, `${cat}: points must be a non-empty array`)
          for (const p of chk.points ?? []) need(typeof p === 'string' && p, `${cat}: every point must be a non-empty string`)
        }
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

  if (course.project !== undefined) validateProject(course.project, capIds, ids, need)

  return errs
}

/**
 * The capstone project: a task package with a versioned dataset, an assisted
 * main task and independent variants on different data. Grading is by named
 * criteria, never by matching one author parameter or one accuracy threshold.
 */
function validateProject(p, capIds, conceptIds, need) {
  const at = `project "${p?.id ?? '(no id)'}"`
  need(typeof p?.id === 'string' && p.id && !conceptIds.has(p.id), `${at}: id missing or clashes with a concept`)
  need(typeof p?.title === 'string' && p.title, `${at}: title missing`)
  need(typeof p?.version === 'string' && p.version, `${at}: version missing`)
  need(Array.isArray(p?.objectives) && p.objectives.length > 0, `${at}: needs objectives`)
  need(typeof p?.explain?.intuition === 'string', `${at}: explain.intuition missing`)
  need(Array.isArray(p?.criteria) && p.criteria.length > 0, `${at}: criteria must be a non-empty array`)
  for (const c of p?.criteria ?? []) {
    need(typeof c?.id === 'string' && typeof c?.title === 'string', `${at}: every criterion needs id and title`)
    need(['rule', 'llm'].includes(c?.method), `${at} criterion "${c?.id}": method must be rule|llm`)
  }
  need(Array.isArray(p?.explanationPoints) && p.explanationPoints.length > 0, `${at}: explanationPoints must be a non-empty array`)
  const checkTask = (t, label, resources) => {
    need(t && typeof t === 'object', `${at}: ${label} task missing`)
    if (!t) return
    need(typeof t.dataset?.file === 'string' && t.dataset.file, `${at} ${label}: dataset.file missing`)
    need(typeof t.dataset?.path === 'string' && t.dataset.path, `${at} ${label}: dataset.path missing`)
    need(typeof t.dataset?.version === 'string' && t.dataset.version, `${at} ${label}: dataset.version missing`)
    need(typeof t.dataset?.target === 'string' && t.dataset.target, `${at} ${label}: dataset.target missing`)
    need(typeof t.starter === 'string' && t.starter, `${at} ${label}: starter code missing`)
    need(t.resources === resources, `${at} ${label}: resources must be ${resources}`)
  }
  checkTask(p?.main, 'main', 'guided')
  need(Array.isArray(p?.variants) && p.variants.length > 0, `${at}: needs at least one independent variant`)
  const files = new Set([p?.main?.dataset?.file])
  for (const [i, v] of (p?.variants ?? []).entries()) {
    checkTask(v, `variants[${i}]`, 'independent')
    need(typeof v?.id === 'string' && v.id, `${at} variants[${i}]: id missing`)
    // The independent variant must change the data: re-running the main task is not verification.
    need(!files.has(v?.dataset?.file), `${at} variants[${i}]: must use data no other task uses`)
    files.add(v?.dataset?.file)
  }
  for (const id of p?.capabilities ?? []) need(capIds.has(id), `${at}: names unknown capability "${id}"`)
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
