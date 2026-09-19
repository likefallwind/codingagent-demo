/**
 * API server.
 *
 * Exists for two reasons: the Minimax key must not reach the browser, and the
 * streaming endpoints need a server to relay SSE. It holds no learner state —
 * that lives in the browser's localStorage — so it is entirely stateless and any
 * request carries the context it needs.
 */

import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCourse, getConcept } from '../src/courses/index.js'
import { resolvePractice } from '../src/labs/practice.js'
import * as realTutor from './tutor.js'
import * as fakeTutor from './fakeTutor.js'
import { cleanScreen, cleanHistory } from './tutor.js'

/**
 * `LEARNAI_FAKE_LLM=1` swaps the model for a deterministic stand-in, so the
 * browser tests can run every tutor path without a key. Never on by default.
 */
const FAKE = process.env.LEARNAI_FAKE_LLM === '1'
const { gradeAnswer, diagnoseLabAction, hintForWrongChoice, answerQuestion, generateHint, gradeProjectExplanation } = FAKE ? fakeTutor : realTutor

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const app = express()
app.use(express.json({ limit: '256kb' }))

const PORT = process.env.PORT ?? 8787

/** Resolve course+concept from a request body, or send a 400 and return null. */
function resolve(req, res) {
  const { courseId, conceptId } = req.body ?? {}
  const course = getCourse(courseId)
  if (!course) {
    res.status(400).json({ error: `unknown courseId: ${courseId}` })
    return null
  }
  const concept = getConcept(courseId, conceptId)
  if (!concept) {
    res.status(400).json({ error: `unknown conceptId: ${conceptId}` })
    return null
  }
  return { course, concept, screen: cleanScreen(req.body?.screen) }
}

/**
 * A check by id: one the author wrote, or a generated practice question rebuilt
 * from its id. Rebuilt rather than taken from the request, so a hint is always
 * written against the real question and its real answer.
 */
function findCheck(concept, checkId) {
  if (typeof checkId !== 'string') return null
  return (concept.checks ?? []).find((c) => c.id === checkId) ?? resolvePractice(concept, checkId)
}

/**
 * Relay an async iterable of text deltas as SSE.
 *
 * Errors are sent as a typed event rather than a dropped connection, so the UI
 * can show the learner that the tutor failed instead of leaving a caret blinking
 * forever. The client abort signal is wired to the upstream request so a learner
 * who navigates away stops paying for tokens.
 */
async function streamSSE(res, req, iterate) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const ac = new AbortController()
  // Listen on the RESPONSE, not the request. For a POST whose body express.json()
  // has already consumed, the request stream ends immediately and `req` emits
  // 'close' right away — aborting before the upstream fetch is even issued, so
  // every stream returned 200 with an empty body in about two milliseconds.
  // The response closing is what actually means the client went away.
  res.on('close', () => ac.abort())
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ac.abort() }, MODEL_DEADLINE_MS)

  try {
    for await (const delta of iterate(ac.signal)) {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
  } catch (err) {
    if (timedOut) res.write(`data: ${JSON.stringify({ error: `AI 在 ${Math.round(MODEL_DEADLINE_MS / 1000)} 秒内没有完成，已停止` })}\n\n`)
    else if (!ac.signal.aborted) {
      console.error('[tutor stream]', err.message)
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    }
  } finally {
    clearTimeout(timer)
    res.end()
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(process.env.MINIMAX_API_KEY) || FAKE, fake: FAKE })
})

/** Echo the client's context tag, so a late reply can be matched to the task it belongs to. */
const tag = (req) => (typeof req.body?.contextKey === 'string' ? req.body.contextKey.slice(0, 200) : null)

/**
 * Every model call has a deadline, and stops when the learner does. Without
 * the first, a hung upstream leaves "批改中…" on screen for good; without the
 * second, a stopped request keeps spending tokens nobody will read.
 */
export const MODEL_DEADLINE_MS = Number(process.env.LEARNAI_MODEL_DEADLINE_MS ?? 60000)
function deadline(res, ms = MODEL_DEADLINE_MS) {
  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ac.abort() }, ms)
  res.on('close', () => { clearTimeout(timer); if (!res.writableEnded) ac.abort() })
  return { signal: ac.signal, timedOut: () => timedOut, done: () => clearTimeout(timer) }
}

/** The error to send when a model call failed: a timeout says so. */
const failure = (d, err) => (d.timedOut() ? `AI 在 ${Math.round(MODEL_DEADLINE_MS / 1000)} 秒内没有完成，已停止` : err.message)

/** Grade a written answer against the author's rubric. */
app.post('/api/tutor/grade', async (req, res) => {
  const found = resolve(req, res)
  if (!found) return
  const { concept, screen } = found
  const { checkId, answer, learner, misconceptionHistory } = req.body

  const check = findCheck(concept, checkId)
  if (!check || check.kind === 'mcq') return res.status(400).json({ error: `unknown written checkId: ${checkId}` })
  if (typeof answer !== 'string' || !answer.trim()) {
    return res.status(400).json({ error: 'answer is empty' })
  }

  const d = deadline(res)
  try {
    const result = await gradeAnswer({ concept, check, answer: answer.slice(0, 2000), learner, misconceptionHistory, screen, signal: d.signal })
    res.json({ ...result, contextKey: tag(req), gradingVersion: FAKE ? 'fake-grader-1' : 'llm-grader-2' })
  } catch (err) {
    if (!res.writableEnded && !res.destroyed) {
      console.error('[grade]', failure(d, err))
      res.status(d.timedOut() ? 504 : 502).json({ error: failure(d, err) })
    }
  } finally {
    d.done()
  }
})

/** Explain a lab mistake the deterministic layer already detected. */
app.post('/api/tutor/diagnose', async (req, res) => {
  const found = resolve(req, res)
  if (!found) return
  const { action, learner, misconceptionHistory } = req.body
  if (!Array.isArray(action?.facts) || !action.facts.length) return res.status(400).json({ error: 'action.facts is required' })
  const clean = {
    facts: action.facts.filter((f) => typeof f === 'string').slice(0, 30).map((f) => f.slice(0, 300)),
    description: typeof action.description === 'string' ? action.description.slice(0, 300) : '',
    retry: action.retry === true,
  }

  const d = deadline(res)
  try {
    const result = await diagnoseLabAction({ concept: found.concept, action: clean, learner, misconceptionHistory, screen: found.screen, signal: d.signal })
    res.json({ ...result, contextKey: tag(req) })
  } catch (err) {
    if (!res.writableEnded && !res.destroyed) {
      console.error('[diagnose]', failure(d, err))
      res.status(d.timedOut() ? 504 : 502).json({ error: failure(d, err) })
    }
  } finally {
    d.done()
  }
})

/** Hint after a wrong multiple-choice pick — without giving the answer away. */
app.post('/api/tutor/check-hint', async (req, res) => {
  const found = resolve(req, res)
  if (!found) return
  const { concept, screen } = found
  const { checkId, choice, learner, misconceptionHistory } = req.body

  const check = findCheck(concept, checkId)
  if (!check || check.kind !== 'mcq') return res.status(400).json({ error: `unknown mcq checkId: ${checkId}` })
  if (!Number.isInteger(choice) || !check.options[choice]) return res.status(400).json({ error: 'choice is out of range' })
  if (check.options[choice].correct) return res.status(400).json({ error: 'that choice is correct — nothing to hint' })

  const d = deadline(res)
  try {
    const result = await hintForWrongChoice({ concept, check, choice, learner, misconceptionHistory, screen, signal: d.signal })
    res.json({ ...result, contextKey: tag(req) })
  } catch (err) {
    if (!res.writableEnded && !res.destroyed) {
      console.error('[check-hint]', failure(d, err))
      res.status(d.timedOut() ? 504 : 502).json({ error: failure(d, err) })
    }
  } finally {
    d.done()
  }
})

/**
 * Free-form question. Sent over SSE like before, but the reply is checked for
 * invented figures and for giving away the current question's answer before any
 * of it is sent — see checkedReply in tutor.js.
 */
app.post('/api/tutor/ask', async (req, res) => {
  const found = resolve(req, res)
  if (!found) return
  const { question, learner, misconceptionHistory } = req.body
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is empty' })
  }

  const { course, concept, screen } = found
  const idx = course.concepts.findIndex((c) => c.id === concept.id)
  const upcoming = course.concepts.slice(idx + 1).map((c) => c.title)
  const check = screen?.check ? findCheck(concept, screen.check.id) : null

  await streamSSE(res, req, (signal) => answerQuestion({
    concept, question: question.slice(0, 500), history: cleanHistory(req.body.history), learner, misconceptionHistory, screen, check,
    courseTitle: course.title, upcoming, signal,
  }))
})

/** A hint at a chosen level (1 where to look … 5 full solution), aimed at what the learner is looking at. Checked like /ask. */
app.post('/api/tutor/hint', async (req, res) => {
  const found = resolve(req, res)
  if (!found) return
  const { learner, level = 1, misconceptionHistory } = req.body
  const { concept, screen } = found
  const check = screen?.check ? findCheck(concept, screen.check.id) : null
  const lv = Math.min(5, Math.max(1, Number.parseInt(level, 10) || 1))

  await streamSSE(res, req, (signal) => generateHint({
    concept, learner, level: lv, history: cleanHistory(req.body.history), misconceptionHistory, screen, check, signal,
  }))
})

/**
 * The written part of a project submission. Everything else in the project is
 * graded by rules on the client, from the run's own records; this endpoint only
 * judges the explanation against the author's points.
 */
app.post('/api/project/grade', async (req, res) => {
  const course = getCourse(req.body?.courseId)
  const project = course?.project
  if (!project) return res.status(400).json({ error: 'this course has no project' })
  const { taskId, roles, conclusion, chosen, records, split } = req.body
  const task = taskId === 'main' ? project.main : project.variants.find((v) => v.id === taskId)
  if (!task) return res.status(400).json({ error: `unknown project task: ${taskId}` })
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const cleanRecord = (r) => (r && typeof r === 'object' ? {
    name: String(r.name ?? '').slice(0, 80),
    params: Object.fromEntries(Object.entries(r.params ?? {}).slice(0, 10).map(([k, v]) => [String(k).slice(0, 40), typeof v === 'number' || v === null ? v : String(v).slice(0, 40)])),
    train_acc: num(r.train_acc), val_acc: num(r.val_acc), depth: num(r.depth), leaves: num(r.leaves),
  } : null)
  const recs = Array.isArray(records) ? records.slice(0, 20).map(cleanRecord).filter(Boolean) : []
  if (!recs.length) return res.status(400).json({ error: 'records are required' })
  const d = deadline(res)
  try {
    const result = await gradeProjectExplanation({
      signal: d.signal,
      project, task,
      roles: typeof roles === 'string' ? roles.slice(0, 1500) : '',
      conclusion: typeof conclusion === 'string' ? conclusion.slice(0, 2500) : '',
      chosen: cleanRecord(chosen),
      records: recs,
      split: split && typeof split === 'object' ? { n_train: num(split.n_train), n_val: num(split.n_val), random_state: split.random_state ?? null } : null,
    })
    res.json({ ...result, contextKey: tag(req), gradingVersion: FAKE ? 'fake-project-grader-1' : 'llm-project-grader-1' })
  } catch (err) {
    if (!res.writableEnded && !res.destroyed) {
      console.error('[project-grade]', failure(d, err))
      res.status(d.timedOut() ? 504 : 502).json({ error: failure(d, err) })
    }
  } finally {
    d.done()
  }
})

// Serve the built front end when one exists, so `npm run build && npm run server`
// is a single deployable process. In development Vite serves the app instead and
// proxies /api here, so this block simply does not apply.
const DIST = join(ROOT, 'dist')
if (existsSync(DIST)) {
  app.use(express.static(DIST))
  // Client-side routing fallback, but never for /api — an unknown API path must
  // 404 rather than quietly returning the HTML shell.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(DIST, 'index.html')))
}

app.listen(PORT, () => {
  if (FAKE) console.warn('⚠  LEARNAI_FAKE_LLM=1：AI 老师由确定性的替身回答，只用于测试。')
  else if (!process.env.MINIMAX_API_KEY) {
    console.warn('⚠  MINIMAX_API_KEY 未设置 —— AI 功能会返回 502，其余部分正常。')
  }
  console.log(`API listening on http://localhost:${PORT}`)
})
