/**
 * The capstone workspace: real Python on data the learner has never seen.
 *
 * Two tasks, recorded separately:
 *   主项目   assisted — scaffolded code, the tutor available;
 *   新变式   independent — another farm's data with different columns and a
 *            different target; asking for help first asks whether to turn it
 *            into assisted practice. A second parallel variant exists, so a
 *            failed or assisted try is re-verified on data not seen before.
 *
 * Every run is tied to the exact code version (stored by hash), the dataset
 * version and content hash, the split and seeds the code used, and the runtime
 * versions. Results from an older code version stay visible and say so. A run
 * can be reproduced from its stored code at any time and the two results are
 * compared. Grading reads the run's own records, never numbers typed by hand.
 */

import React, { useEffect, useRef, useState } from 'react'
import { runtime, RUNTIME_LIMITS } from './runtime.js'
import {
  gradeByRules, explanationCriterion, overall, submissionKey, splitOf, distinctRecords, PROJECT_GRADING_VERSION,
} from './grading.js'
import { projectJudgements } from './summary.js'
import { gradeProjectExplanation } from '../api.js'
import { contentHash, newId } from '../engine/ids.js'
import { attemptFor } from '../engine/learnerModel.js'
import { Card, Button, Chip, Feedback } from '../components/ui.jsx'

const MAX_STDOUT_STORED = 8000
const MAX_RUNS_KEPT = 60

const pct = (v) => `${(v * 100).toFixed(1)}%`
const paramText = (p) => Object.entries(p ?? {})
  .filter(([k, v]) => v !== null && !(k === 'criterion' && v === 'gini') && k !== 'random_state' && !(k === 'min_samples_leaf' && v === 1) && !(k === 'min_samples_split' && v === 2) && !(k === 'ccp_alpha' && v === 0))
  .map(([k, v]) => `${k}=${v}`).join(', ') || '默认参数'

const RUN_LABEL = {
  running: { text: '运行中…', tone: 'brand' },
  ok: { text: '运行成功', tone: 'ok' },
  error: { text: '运行报错', tone: 'bad' },
  timeout: { text: '超时，已停止', tone: 'warn' },
  cancelled: { text: '已停止', tone: 'warn' },
  unavailable: { text: '运行环境不可用', tone: 'warn' },
}

/** Subscribe to the runtime's status line. */
function useRuntimeState() {
  const [s, setS] = useState(runtime.state)
  useEffect(() => runtime.subscribe(setS), [])
  return s
}

const emptyProject = (course) => ({ version: course.project.version, tasks: {}, code: {}, runs: {} })

export default function ProjectWorkspace({ course, L, bus }) {
  const p = course.project
  const learner = L.learner
  const proj = learner.project?.version === p.version ? learner.project : { ...emptyProject(course), ...(learner.project ?? {}), version: p.version }
  const rt = useRuntimeState()
  const latest = useRef(learner)
  latest.current = learner

  // --- which task ----------------------------------------------------------------------------
  // A variant is "spent" once its first rated submission is in, or once help
  // turned it into practice: it can still be worked on, but only the next,
  // unused variant can verify independently.
  const variantAttempts = p.variants.map((v) => ({ v, a: attemptFor(learner, `project:${v.id}:${p.version}`) }))
  const variantJudgements = projectJudgements(learner, course).variant
  const spent = (a) => Boolean(a && (a.converted || learner.judgements.some((j) => j.attemptId === a.id && j.correct !== null)))
  const passedVariant = variantJudgements.find((j) => j.correct === true && j.independent)
  const started = variantAttempts.filter((x) => x.a).sort((x, y) => x.a.startedAt - y.a.startedAt)
  const current = started.at(-1) ?? null
  const unused = variantAttempts.find((x) => !x.a) ?? null
  const inProgress = current && current.a.status === 'open' && !spent(current.a) ? current : null
  const canStartNext = !passedVariant && !inProgress && unused

  const [tab, setTab] = useState(() => (inProgress ? 'variant' : 'main'))
  const [variantPick, setVariantPick] = useState(null)
  const variantShown = variantPick
    ? variantAttempts.find((x) => x.v.id === variantPick)
    : (passedVariant ? variantAttempts.find((x) => x.a?.id === passedVariant.attemptId) : null) ?? current ?? unused
  const taskDef = tab === 'main' ? p.main : variantShown?.v
  const taskId = tab === 'main' ? 'main' : variantShown?.v.id
  const instanceKey = taskDef ? `project:${taskId}:${p.version}` : null
  const attempt = instanceKey ? attemptFor(learner, instanceKey) : null
  const independent = tab !== 'main'

  // The main project's attempt opens with the workspace; a variant's only on an explicit start.
  useEffect(() => {
    if (tab !== 'main') return
    const key = `project:main:${p.version}`
    if (!attemptFor(latest.current, key)) {
      L.startAttempt({ conceptId: p.id, taskId: 'main', taskVersion: p.version, activity: 'project', instanceKey: key, resources: 'guided', label: p.main.title })
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const startVariant = () => {
    const x = unused
    if (!x || !canStartNext) return
    // The spent variant stays open for practice; it just no longer verifies.
    L.startAttempt({
      conceptId: p.id, taskId: x.v.id, taskVersion: p.version, activity: 'project-verify',
      instanceKey: `project:${x.v.id}:${p.version}`, resources: 'independent', label: x.v.title,
    })
    L.event({ conceptId: p.id, object: 'project-variant', action: 'start', detail: { variant: x.v.id } })
    setVariantPick(x.v.id)
  }

  // --- code, drafts, runs ------------------------------------------------------------------------
  const codeKey = taskId ? `project:${taskId}:code` : null
  const code = (codeKey && learner.drafts[codeKey]) ?? taskDef?.starter ?? ''
  const codeHash = contentHash(code)
  const t = (taskId && proj.tasks[taskId]) ?? { versions: [], runs: [] }
  const versionOf = (hash) => (t.versions.findIndex((v) => v.hash === hash) + 1) || null
  const currentV = versionOf(codeHash)
  const runs = t.runs.map((id) => proj.runs[id]).filter(Boolean)
  const lastRun = runs.at(-1) ?? null
  const [running, setRunning] = useState(null)

  const setCode = (text) => L.draft(codeKey, text)
  const saveProject = (fn) => L.project((old) => fn(old?.version === p.version ? old : { ...emptyProject(course), ...(old ?? {}), version: p.version }))

  /** Store the code version (deduplicated by hash) and return its number. */
  const snapshotCode = (text, hash) => {
    let v = versionOf(hash)
    if (v) return v
    v = t.versions.length + 1
    saveProject((old) => {
      const task = old.tasks[taskId] ?? { versions: [], runs: [] }
      if (task.versions.some((x) => x.hash === hash)) return old
      return {
        ...old,
        code: { ...old.code, [hash]: text },
        tasks: { ...old.tasks, [taskId]: { ...task, versions: [...task.versions, { hash, savedAt: Date.now() }] } },
      }
    })
    return v
  }

  const loadData = async (def) => {
    const res = await fetch(`/${def.dataset.file}`)
    if (!res.ok) throw new Error(`数据包 ${def.dataset.version} 下载失败（${res.status}）`)
    const text = await res.text()
    return { text, hash: contentHash(text) }
  }

  const doRun = async ({ text = code, reproduceOf = null } = {}) => {
    if (running || !taskDef) return
    if (independent && (!attempt || attempt.status !== 'open')) return
    const hash = contentHash(text)
    const v = snapshotCode(text, hash)
    const runId = newId('run')
    setRunning({ runId, reproduceOf })
    bus.setFocus('project')
    const started = Date.now()
    let data
    try {
      data = await loadData(taskDef)
    } catch (err) {
      setRunning(null)
      storeRun({ id: runId, v, codeHash: hash, status: 'unavailable', startedAt: started, finishedAt: Date.now(), error: { type: 'DataUnavailable', message: err.message }, report: null, stdout: '' }, reproduceOf)
      return
    }
    const out = await runtime.run({ runId, code: text, files: [{ path: taskDef.dataset.path, text: data.text }] })
    setRunning(null)
    storeRun({
      id: runId, v, codeHash: hash, dataVersion: taskDef.dataset.version, dataHash: data.hash,
      dataMismatch: Boolean(taskDef.dataset.hash && data.hash !== taskDef.dataset.hash),
      status: out.status, startedAt: started, finishedAt: Date.now(), durationMs: out.durationMs,
      stdout: String(out.stdout ?? '').slice(0, MAX_STDOUT_STORED), error: out.error ?? null, report: out.report ?? null,
      versions: out.versions ?? runtime.state.versions ?? null, limits: RUNTIME_LIMITS.version,
    }, reproduceOf)
  }

  const storeRun = (run, reproduceOf) => {
    let match = null
    if (reproduceOf) {
      const orig = proj.runs[reproduceOf]
      const strip = (r) => JSON.stringify((r?.report?.records ?? []).map((x) => [x.name, x.params, x.train_acc, x.val_acc, x.depth, x.leaves]))
      match = orig ? strip(orig) === strip(run) && orig.status === run.status : null
    }
    const full = { ...run, taskId, attemptId: attempt?.id ?? null, reproduceOf, reproduceMatch: match }
    saveProject((old) => {
      const task = old.tasks[taskId] ?? { versions: [], runs: [] }
      const keep = [...task.runs, run.id].slice(-MAX_RUNS_KEPT)
      const dropped = task.runs.filter((id) => !keep.includes(id))
      const runsMap = { ...old.runs, [run.id]: full }
      for (const id of dropped) delete runsMap[id]
      return { ...old, runs: runsMap, tasks: { ...old.tasks, [taskId]: { ...task, runs: keep } } }
    })
    L.event({
      conceptId: p.id, object: 'project-run', action: reproduceOf ? 'reproduce' : 'run', attemptId: attempt?.id ?? null,
      resultVersion: run.id, detail: { status: run.status, v: run.v, codeHash: run.codeHash, data: run.dataVersion, records: run.report?.records?.length ?? 0, match },
    })
  }

  const stop = () => runtime.stop()

  // --- help gating and what the tutor sees ----------------------------------------------------------
  // Only a variant still being verified is gated; after its first rated
  // submission the work is practice, and help changes nothing that counts.
  const verifying = independent && attempt?.status === 'open' && !spent(attempt)
  useEffect(() => {
    bus.setGate(verifying
      ? { attemptId: attempt.id, conceptId: p.id, kind: 'project-verify', label: '新数据变式的独立验证' }
      : null)
    return () => bus.setGate(null)
  }, [verifying, attempt?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bus.setTask(attempt ? {
      key: `project:${taskId}:${attempt.id}`,
      label: independent ? `结课项目 · ${taskDef.title}` : '结课项目 · 主项目',
      activity: independent ? 'project-verify' : 'project',
      attemptIds: [attempt.id],
      object: 'project-code',
      attempt: attempt.converted ? '已转为辅助练习' : independent ? (spent(attempt) ? '已提交，之后只算练习' : '独立进行中') : attempt.assisted ? '用过帮助' : '',
      capability: independent ? '在新数据上完成一次完整的建模与取舍' : null,
      capabilityStatus: '',
    } : { key: `project:${taskId}:none`, label: '结课项目', activity: 'project', attemptIds: [], object: 'project-code' })
  }, [taskId, attempt?.id, attempt?.converted, attempt?.assisted]) // eslint-disable-line react-hooks/exhaustive-deps

  const records = lastRun?.report?.records ?? []
  useEffect(() => {
    const err = lastRun?.error ? `${lastRun.error.type}: ${lastRun.error.message}${lastRun.error.line ? `（第 ${lastRun.error.line} 行）` : ''}\n${lastRun.error.traceback ?? ''}` : ''
    const gated = verifying
    bus.reportProject({
      doing: running ? '代码正在运行' : lastRun ? `刚运行了代码 v${lastRun.v}（${RUN_LABEL[lastRun.status]?.text ?? lastRun.status}）${currentV === lastRun.v ? '' : '，之后又改了代码'}` : '在写项目代码，还没有运行',
      facts: records.map((r) => `「${r.name}」（${paramText(r.params)}）：训练准确率 ${r.train_acc.toFixed(3)}，验证准确率 ${r.val_acc.toFixed(3)}，深度 ${r.depth}，叶子 ${r.leaves}`),
      // During an independent variant the tutor is not consulted; nothing of the work is sent.
      code: gated ? null : { version: currentV ? `v${currentV}` : '未运行的修改', text: code.slice(0, 4000), error: err.slice(0, 800), output: (lastRun?.stdout ?? '').slice(-1200) },
    })
  }, [code, lastRun?.id, running, verifying]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- submission -------------------------------------------------------------------------------------
  const formKey = taskId ? `project:${taskId}:form` : null
  const form = (formKey && learner.drafts[formKey]) ?? {}
  const setForm = (patch) => L.draft(formKey, { ...form, ...patch })
  const okRuns = runs.filter((r) => r.status === 'ok' && r.report?.records?.length)
  const subRun = proj.runs[form.runId] ?? okRuns.at(-1) ?? null
  const subRecords = subRun?.report?.records ?? []
  const [grading, setGrading] = useState(false)
  const [shownGrade, setShownGrade] = useState(null)
  const gradeAbort = useRef(null)

  const judgementsHere = attempt ? learner.judgements.filter((j) => j.attemptId === attempt.id) : []
  const lastGrade = shownGrade ? judgementsHere.find((j) => j.id === shownGrade) : judgementsHere.at(-1)

  const grade = async () => {
    if (!attempt || !subRun || grading) return
    const sub = {
      codeHash: subRun.codeHash, target: (form.target ?? '').trim(), chosenIndex: Number.isInteger(form.chosenIndex) ? form.chosenIndex : null,
      roles: form.roles ?? '', conclusion: form.conclusion ?? '',
    }
    const key = submissionKey(taskId, subRun, sub)
    // The same submission is graded once: resubmitting it shows the existing grade.
    if (learner.judgements.some((j) => j.id === key)) { setShownGrade(key); return }
    setGrading(true)
    const rules = gradeByRules({ task: taskDef, run: subRun, sub, criteriaTitles: Object.fromEntries(p.criteria.map((c) => [c.id, c.title])) })
    let llm = null
    let llmError = null
    const chosen = sub.chosenIndex !== null ? subRecords[sub.chosenIndex] : null
    const ac = new AbortController()
    gradeAbort.current = ac
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ac.abort() }, 90000)
    try {
      llm = await gradeProjectExplanation({
        courseId: course.id, taskId, roles: sub.roles, conclusion: sub.conclusion, chosen,
        records: subRecords, split: splitOf(subRun.report), contextKey: `project:${taskId}:${attempt.id}`,
      }, ac.signal)
    } catch (err) {
      llmError = timedOut ? 'AI 批改超时，已停止' : err.message
    }
    clearTimeout(timer)
    gradeAbort.current = null
    // Stopped by the learner: nothing is recorded, the submission can be made again.
    // Timed out: recorded with the explanation pending, like any AI failure.
    if (ac.signal.aborted && !timedOut) {
      setGrading(false)
      L.event({ conceptId: p.id, object: 'project-grade', action: 'cancelled', attemptId: attempt.id })
      return
    }
    const expl = explanationCriterion({ sub, llm, points: p.explanationPoints, title: p.criteria.find((c) => c.id === 'explanation')?.title })
    const criteria = [...rules, expl].map((c) => ({ id: c.id, text: c.title, met: c.met, reasons: c.reasons, points: c.points ?? null, pending: Boolean(c.pending), needsReview: Boolean(c.needsReview), feedback: c.feedback ?? null }))
    const correct = overall(criteria)
    L.judge({
      id: key, attemptId: attempt.id, kind: 'project', correct,
      verdict: correct === null ? 'pending' : correct ? 'correct' : 'incorrect',
      criteria,
      answer: { runId: subRun.id, codeHash: subRun.codeHash, codeVersion: subRun.v, target: sub.target, chosenIndex: sub.chosenIndex, chosen, roles: sub.roles, conclusion: sub.conclusion },
      grading: { method: 'rules+llm', version: PROJECT_GRADING_VERSION, llmVersion: llm ? (llm.gradingVersion ?? 'llm') : null, llmError, dataVersion: subRun.dataVersion, runtime: subRun.versions },
      needsReview: criteria.some((c) => c.needsReview),
      capabilities: independent ? p.capabilities : null,
      detail: { label: independent ? `结课项目新变式：${taskDef.title}` : '结课项目：主项目' },
    })
    setShownGrade(key)
    setGrading(false)
  }

  /** Re-grade only the pending written criterion; the first grading is kept, the review is added. */
  const regrade = async (j) => {
    if (grading) return
    setGrading(true)
    const run = proj.runs[j.answer.runId]
    try {
      const llm = await gradeProjectExplanation({
        courseId: course.id, taskId, roles: j.answer.roles, conclusion: j.answer.conclusion, chosen: j.answer.chosen,
        records: run?.report?.records ?? [], split: splitOf(run?.report),
      })
      const expl = explanationCriterion({ sub: j.answer, llm, points: p.explanationPoints, title: p.criteria.find((c) => c.id === 'explanation')?.title })
      const criteria = (j.criteria ?? []).map((c) => (c.id === 'explanation' ? { id: expl.id, text: expl.title, met: expl.met, reasons: expl.reasons, points: expl.points ?? null, pending: Boolean(expl.pending), needsReview: Boolean(expl.needsReview), feedback: expl.feedback ?? null } : c))
      const correct = overall(criteria)
      L.review(j.id, { correct, verdict: correct === null ? 'pending' : correct ? 'correct' : 'incorrect', criteria, grading: { method: 'llm-review', version: PROJECT_GRADING_VERSION } })
    } catch (err) {
      L.event({ conceptId: p.id, object: 'project-grade', action: 'regrade-failed', detail: { error: err.message } })
    } finally {
      setGrading(false)
    }
  }

  // --- the editor ---------------------------------------------------------------------------------------
  const editorRef = useRef(null)
  const jumpToLine = (n) => {
    const el = editorRef.current
    if (!el || !n) return
    const lines = code.split('\n')
    const start = lines.slice(0, n - 1).reduce((s, l) => s + l.length + 1, 0)
    el.focus()
    el.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0))
    el.scrollTop = Math.max(0, (n - 4) * 21)
  }
  const onKeyDown = (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const el = e.target
      const s = el.selectionStart
      const next = `${code.slice(0, s)}    ${code.slice(el.selectionEnd)}`
      setCode(next)
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4))
    } else if (e.key === 'Escape') {
      e.target.blur()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      doRun()
    }
  }

  const lineCount = code.split('\n').length
  const locked = independent && (!attempt || attempt.status !== 'open')
  const editable = !locked

  // --- layout ---------------------------------------------------------------------------------------------
  const variantStatus = (x) => {
    if (!x.a) return '未开始'
    const j = learner.judgements.filter((k) => k.attemptId === x.a.id).at(-1)
    if (x.a.converted) return '转为辅助练习'
    if (!j) return '进行中'
    if (j.correct === true && j.independent) return '独立通过'
    return j.correct === null ? '待评定' : '未通过'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="project">
      <section aria-label="结课项目" style={{ background: 'linear-gradient(180deg,#F1F6FF 0%,#EAF1FF 100%)', border: '1px solid #DCE7FA', borderRadius: 13, padding: '16px 20px' }}>
        <div style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 500, marginBottom: 4 }}>{p.chapter} · 任务包 {p.version}</div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink-strong)' }}>{p.title}</h1>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.75, marginTop: 8 }}>
          {p.objectives.map((o, i) => <div key={i}>· {o}</div>)}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.75, marginTop: 8 }}>{p.explain.example}</div>
        {p.prerequisite && (
          <div data-testid="prerequisite" style={{ fontSize: 12.5, lineHeight: 1.75, marginTop: 8, padding: '8px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div><b style={{ color: 'var(--ink-mid)' }}>前置要求：</b>{p.prerequisite.text}</div>
            <div style={{ color: 'var(--muted)' }}>{p.prerequisite.separation}</div>
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--brand)' }}>Python 还不熟？先看这份补课（五分钟）</summary>
              <table className="data" style={{ marginTop: 6 }}>
                <tbody>
                  {p.prerequisite.primer.map(([line, what]) => (
                    <tr key={line}><td className="mono" style={{ whiteSpace: 'pre', fontSize: 12 }}>{line}</td><td>{what}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 6 }}>
                想系统补一补：{p.prerequisite.links.map((l, i) => (
                  <React.Fragment key={l.url}>{i ? '，' : ''}<a href={l.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>{l.title}</a></React.Fragment>
                ))}。独立验证时也可以查这些官方文档。
              </div>
            </details>
          </div>
        )}
        <div role="tablist" aria-label="项目任务" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <TabButton active={tab === 'main'} onClick={() => setTab('main')}>主项目（可以用 AI 老师）</TabButton>
          <TabButton active={tab === 'variant'} onClick={() => setTab('variant')} testid="tab-variant">新数据变式（独立验证）</TabButton>
        </div>
      </section>

      {tab === 'variant' && (
        <Card title="独立验证：换一个农场的数据" data-testid="variant-card">
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.8 }}>
            数据、列名和目标都和主项目不同，直接重跑主项目的代码不能通过。这一次从读数据开始由你自己完成，评分项和主项目一样。
            每个变式只有第一次提交算独立验证；没通过或中途求助，会换另一个农场的数据再验证。
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.8, color: 'var(--ink-soft)', background: 'var(--bg)', border: '1px solid var(--border-soft)', borderRadius: 10, padding: '9px 12px', marginTop: 10 }}>
            {p.variantResources}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {variantAttempts.map((x) => (
              <button key={x.v.id} onClick={() => x.a && setVariantPick(x.v.id)} disabled={!x.a}
                      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: `1px solid ${variantShown?.v.id === x.v.id ? 'var(--brand)' : 'var(--border)'}`, background: '#fff', color: x.a ? 'var(--ink-soft)' : 'var(--muted-light)' }}>
                {x.v.title.replace('独立验证：', '')} · {variantStatus(x)}
              </button>
            ))}
          </div>
          {current && spent(current.a) && !passedVariant && (
            <Feedback tone="warn" title={current.a.converted ? `${current.v.title.replace('独立验证：', '')}已转为辅助练习` : `${current.v.title.replace('独立验证：', '')}这次没有独立通过`} style={{ marginTop: 12 }}>
              {current.a.converted ? '你在独立验证中请求了帮助。' : '第一次提交的评分已经记下了。'}
              这个农场的数据还可以继续修改、运行、提交，但只算练习。
              {unused ? '要重新独立验证，请换一个没用过的农场的数据。' : ''}
            </Feedback>
          )}
          {canStartNext && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={startVariant} data-testid="variant-start">
                {current ? '换' : '开始独立验证：'}{unused.v.title.replace('独立验证：', '')}{current ? '的数据，重新独立验证' : ''}
              </Button>
              {!projectJudgements(learner, course).main.length && <span style={{ fontSize: 12, color: 'var(--muted)' }}>建议先完成并提交主项目。</span>}
            </div>
          )}
          {!passedVariant && !inProgress && !unused && (
            <Feedback tone="warn" title="准备好的变式都用过了" style={{ marginTop: 12 }}>
              两个变式都已经做过。它们仍然可以继续修改、运行、提交，但只作为练习，不再计入独立验证。
            </Feedback>
          )}
        </Card>
      )}

      {taskDef && (tab === 'main' || attempt) && (
        <>
          <Card title={tab === 'main' ? '数据包' : `数据包 · ${taskDef.title}`} pad={14}>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.8 }}>
              <span className="mono">{taskDef.dataset.path}</span> · 版本 <span className="mono">{taskDef.dataset.version}</span> · {taskDef.dataset.rows} 行 · 目标列 <span className="mono">{taskDef.dataset.target}</span>
              <div>{taskDef.dataset.description}</div>
            </div>
            {tab === 'main' && <Checklist records={records} split={splitOf(lastRun?.report)} submitted={judgementsHere.length > 0} />}
          </Card>

          <Card title="代码" data-object="project-code"
                right={<span style={{ fontSize: 12, color: 'var(--muted)' }}>{currentV ? `代码 v${currentV}` : `代码 v${t.versions.length + 1}（还没运行过）`}</span>}>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#fbfcfe' }}>
              <pre aria-hidden="true" className="code-editor" style={{ margin: 0, padding: '10px 8px', textAlign: 'right', color: 'var(--muted-light)', background: 'var(--bg)', userSelect: 'none', minWidth: 40, overflow: 'hidden' }}>
                {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
              </pre>
              <textarea ref={editorRef} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onKeyDown}
                        readOnly={!editable} spellCheck={false} aria-label="项目代码（Tab 缩进，Esc 离开编辑器，Ctrl+Enter 运行）"
                        className="code-editor" data-testid="code-editor"
                        rows={Math.min(28, Math.max(14, lineCount + 1))}
                        style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 12px', resize: 'vertical', background: 'transparent', color: 'var(--ink)' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => doRun()} disabled={Boolean(running) || !editable} data-testid="run">{running ? '运行中…' : '运行 ▶'}</Button>
              <Button variant="quiet" onClick={stop} disabled={!running} data-testid="stop">停止 ■</Button>
              <Button variant="quiet" onClick={() => setCode(taskDef.starter)} disabled={!editable || code === taskDef.starter}>恢复起始代码</Button>
              <span role="status" data-testid="runtime-status" data-status={rt.status} style={{ fontSize: 12, color: rt.status === 'failed' ? 'var(--bad)' : 'var(--muted)' }}>
                {rt.status === 'idle' && !lastRun ? '第一次运行会下载 Python 运行环境（约 30 MB），之后会快很多。' : rt.text}
                {rt.versions && rt.status !== 'loading' ? ` · Python ${rt.versions.python} · scikit-learn ${rt.versions.sklearn} · pandas ${rt.versions.pandas}` : ''}
                {rt.error ? `（${rt.error}）` : ''}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 6 }}>
              代码在浏览器里隔离的 Python 环境中真实运行，不能联网，碰不到平台的密钥和你的学习记录；单次运行上限 {Math.round(RUNTIME_LIMITS.runTimeoutMs / 1000)} 秒，超时会自动停止。{RUNTIME_LIMITS.note}
            </div>
          </Card>

          <RunOutput run={running ? { status: 'running', v: currentV } : lastRun} currentV={currentV} onJump={jumpToLine} />

          <ExperimentTable runs={runs} currentHash={codeHash} versionOf={versionOf} onReproduce={(r) => doRun({ text: proj.code[r.codeHash], reproduceOf: r.id })} busy={Boolean(running)} codeStore={proj.code} />

          {attempt && (
            <Card title="提交作品" data-object="project-submit">
              {!okRuns.length ? (
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>先成功运行一次带 log_experiment 记录的代码，才能提交。</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ color: 'var(--muted)' }}>提交哪一次运行的结果（结果和代码版本绑定）</span>
                    <select value={subRun?.id ?? ''} onChange={(e) => setForm({ runId: e.target.value, chosenIndex: null })} style={field}>
                      {okRuns.slice().reverse().map((r) => (
                        <option key={r.id} value={r.id}>运行 #{runs.indexOf(r) + 1} · 代码 v{r.v}{r.codeHash === codeHash ? '（当前代码）' : '（旧版本代码）'} · {r.report.records.length} 条实验记录</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ color: 'var(--muted)' }}>目标列（你要预测的那一列）</span>
                    <input value={form.target ?? ''} onChange={(e) => setForm({ target: e.target.value })} placeholder="列名" style={field} data-testid="form-target" />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ color: 'var(--muted)' }}>训练集和验证集各自用来做什么？</span>
                    <textarea value={form.roles ?? ''} onChange={(e) => setForm({ roles: e.target.value })} rows={3} style={field} data-testid="form-roles" />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ color: 'var(--muted)' }}>你选哪个模型</span>
                    <select value={Number.isInteger(form.chosenIndex) ? form.chosenIndex : ''} onChange={(e) => setForm({ chosenIndex: e.target.value === '' ? null : Number(e.target.value), runId: subRun.id })} style={field} data-testid="form-chosen">
                      <option value="">选一个实验记录</option>
                      {subRecords.map((r, i) => <option key={i} value={i}>「{r.name}」{paramText(r.params)} · 验证准确率 {r.val_acc.toFixed(3)}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ color: 'var(--muted)' }}>结论：为什么选它？引用的数字要和实验记录一致</span>
                    <textarea value={form.conclusion ?? ''} onChange={(e) => setForm({ conclusion: e.target.value })} rows={5} style={field} data-testid="form-conclusion" />
                  </label>
                  <Preview independent={independent} run={subRun} form={form} />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Button variant="primary" onClick={grade} disabled={grading || !subRun} data-testid="submit-project">{grading ? '评分中…' : '提交并评分'}</Button>
                    {grading && <Button variant="quiet" onClick={() => gradeAbort.current?.abort()}>停止评分</Button>}
                    {verifying && (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>这是本变式第一次提交，会作为独立验证的结果。</span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {lastGrade && <GradeResult j={lastGrade} onRegrade={() => regrade(lastGrade)} grading={grading} independent={independent} code={proj.code[lastGrade.answer?.codeHash]} run={proj.runs[lastGrade.answer?.runId]} />}
        </>
      )}

      {tab === 'main' && projectJudgements(learner, course).main.length > 0 && !inProgress && !passedVariant && (
        <Feedback tone="neutral" title="下一步：新数据上的独立验证">
          主项目的结果和新变式的独立验证分开记录。准备好了就去做新变式。
          <div style={{ marginTop: 8 }}><Button variant="primary" onClick={() => setTab('variant')}>去新数据变式</Button></div>
        </Feedback>
      )}
      {passedVariant && (
        <Feedback tone="ok" title="✓ 新数据变式独立通过">
          「{p.capabilities.map((id) => course.concepts.find((c) => c.capability?.id === id)?.capability.title).filter(Boolean).join('」「')}」
          这几项能力在新情境里有了独立证据（前提是它们各自的独立验证也已通过）。
          <div style={{ marginTop: 8 }}><Button variant="quiet" onClick={() => bus.openProfile()}>查看能力档案</Button></div>
        </Feedback>
      )}
    </div>
  )
}

const field = { border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', fontSize: 13, color: 'var(--ink-mid)', background: '#fff', fontFamily: 'inherit' }

function TabButton({ active, onClick, children, testid }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} data-testid={testid}
      style={{ fontSize: 13, padding: '6px 12px', borderRadius: 9, border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`, background: active ? 'var(--brand)' : '#fff', color: active ? '#fff' : 'var(--ink-soft)' }}>
      {children}
    </button>
  )
}

/** The main project's scaffolding: which parts are done, read off the latest run. */
function Checklist({ records, split, submitted }) {
  const distinct = distinctRecords(records)
  const items = [
    { done: Boolean(split), text: '选特征和目标，用 train_test_split 划分训练集和验证集（固定 random_state）' },
    { done: records.length > 0, text: '跑通基线，并用 log_experiment 记录' },
    { done: distinct.length >= 3, text: `比较至少三种设置，包括复杂度参数的改变（现在 ${distinct.length} 种）` },
    { done: submitted, text: '选一个模型，写清理由，提交' },
  ]
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', fontSize: 12.5, lineHeight: 1.9 }}>
      {items.map((it, i) => (
        <li key={i} style={{ color: it.done ? 'var(--ok-deep)' : 'var(--ink-soft)' }}>
          <span aria-hidden="true">{it.done ? '✓' : '○'}</span> {it.text}<span className="sr-only">{it.done ? '（已完成）' : '（未完成）'}</span>
        </li>
      ))}
    </ol>
  )
}

function RunOutput({ run, currentV, onJump }) {
  if (!run) return null
  const label = RUN_LABEL[run.status] ?? { text: run.status, tone: 'neutral' }
  return (
    <Card title="运行结果" data-object="project-output" data-testid="run-output" data-status={run.status}
          right={<span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--muted)' }}>
            <Chip tone={label.tone}>{label.text}</Chip>
            {run.v && <span>代码 v{run.v}{currentV && run.v !== currentV ? '（之后改过代码）' : ''}</span>}
            {run.dataVersion && <span>数据 {run.dataVersion}</span>}
            {Number.isFinite(run.durationMs) && <span>{(run.durationMs / 1000).toFixed(1)} 秒</span>}
          </span>}>
      {run.status === 'running' && <div className="streaming" style={{ fontSize: 13, color: 'var(--muted)' }}>正在运行，可以随时停止。</div>}
      {run.dataMismatch && <Feedback tone="warn" title="数据文件和任务包登记的不一致">这次运行的结果不能作为这个任务版本的依据。</Feedback>}
      {run.reproduceOf && (
        <Feedback tone={run.reproduceMatch ? 'ok' : 'warn'} title={run.reproduceMatch ? '复现一致' : '复现结果不一致'} style={{ marginBottom: 8 }}>
          {run.reproduceMatch ? '用保存的代码和同一数据包重跑，得到了完全相同的实验记录。' : '重跑得到的实验记录和原来不同。检查代码里是否有没固定的随机种子。'}
        </Feedback>
      )}
      {run.stdout && <pre className="console" data-testid="stdout" style={{ margin: 0, padding: '10px 12px', background: '#1f2533', color: '#dfe5f0', borderRadius: 9, maxHeight: 320, overflow: 'auto' }}>{run.stdout}</pre>}
      {run.error && (
        <div data-testid="run-error" style={{ marginTop: 10, border: '1px solid var(--bad-line)', background: 'var(--bad-bg)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 13, color: 'var(--bad)', fontWeight: 500 }}>
            {run.error.type}：{run.error.message}
            {run.error.line && <button onClick={() => onJump(run.error.line)} style={{ marginLeft: 8, fontSize: 12, color: 'var(--brand)', background: 'none', border: 'none' }}>跳到第 {run.error.line} 行</button>}
          </div>
          {run.error.traceback && <pre className="console" style={{ margin: '8px 0 0', color: 'var(--ink-soft)', maxHeight: 200, overflow: 'auto' }}>{run.error.traceback}</pre>}
        </div>
      )}
    </Card>
  )
}

/** Every recorded experiment of this task, newest run first; rows from older code say which version they came from. */
function ExperimentTable({ runs, currentHash, versionOf, onReproduce, busy, codeStore }) {
  const withRecords = runs.filter((r) => r.report?.records?.length).slice().reverse()
  if (!withRecords.length) return null
  return (
    <Card title="实验记录（来自真实运行）" data-object="project-experiments" data-testid="experiments">
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr><th>运行</th><th>名称</th><th>参数</th><th>训练准确率</th><th>验证准确率</th><th>深度</th><th>叶子</th><th>来源</th></tr>
          </thead>
          <tbody>
            {withRecords.flatMap((run) => run.report.records.map((r, i) => {
              const old = run.codeHash !== currentHash
              return (
                <tr key={`${run.id}:${i}`} data-old={old ? '1' : '0'} style={{ opacity: old ? 0.62 : 1 }}>
                  <td className="mono">{i === 0 ? `#${runs.indexOf(run) + 1}` : ''}</td>
                  <td>{r.name}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{paramText(r.params)}</td>
                  <td className="mono">{r.train_acc.toFixed(3)}</td>
                  <td className="mono">{r.val_acc.toFixed(3)}</td>
                  <td className="mono">{r.depth}</td>
                  <td className="mono">{r.leaves}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {old ? <span data-testid="old-version">旧版本 v{versionOf(run.codeHash) ?? run.v}</span> : <span style={{ color: 'var(--ok-deep)' }}>当前代码 v{run.v}</span>}
                    {i === 0 && codeStore[run.codeHash] && (
                      <button onClick={() => onReproduce(run)} disabled={busy} style={{ marginLeft: 8, fontSize: 12, color: 'var(--brand)', background: 'none', border: 'none' }}>复现</button>
                    )}
                  </td>
                </tr>
              )
            }))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted-light)', marginTop: 6 }}>
        准确率 = 判对的比例，由 scikit-learn 的 score() 在这次运行中算出。改了代码或参数之后，旧的行会标成对应的旧版本。本页前面实验里的数字来自课程自己的 JavaScript 实现，和这里的 Python 结果各算各的，不混用。
      </div>
    </Card>
  )
}

/** Before submitting: structural checks only in the independent task, so the preview does not do the task's thinking. */
function Preview({ independent, run, form }) {
  const records = run?.report?.records ?? []
  const items = [
    { ok: records.length > 0, text: '选中的运行里有实验记录' },
    { ok: Boolean((form.target ?? '').trim()), text: '填了目标列' },
    { ok: Boolean((form.roles ?? '').trim()), text: '写了训练集和验证集的作用' },
    { ok: Number.isInteger(form.chosenIndex), text: '选了一个模型' },
    { ok: Boolean((form.conclusion ?? '').trim()), text: '写了结论' },
  ]
  return (
    <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
      提交前检查（只检查有没有填写{independent ? '，不替你判断对不对' : ''}）：
      {items.map((it) => <span key={it.text} style={{ marginLeft: 8, color: it.ok ? 'var(--ok-deep)' : 'var(--muted)' }}>{it.ok ? '✓' : '○'} {it.text}</span>)}
    </div>
  )
}

function GradeResult({ j, onRegrade, grading, independent, code, run }) {
  const eff = j.reviews?.length ? { ...j, ...j.reviews.at(-1) } : j
  const verdict = eff.correct === true ? '全部评分项通过' : eff.correct === false ? '有评分项没通过' : '部分评分项待评定'
  const counted = independent ? (j.eligible ? (eff.correct === true ? '计入独立验证：通过' : eff.correct === null ? '独立验证结果待定' : '计入独立验证：未通过') : j.assisted ? '用过帮助，不计入独立验证' : '重试，不计入独立验证') : j.assisted ? '辅助完成（用过 AI 帮助）' : '平台内没有使用帮助'
  return (
    <Card title="评分结果" data-object="project-grade" data-testid="grade" data-correct={String(eff.correct)}
          right={<span style={{ display: 'flex', gap: 8 }}><Chip tone={eff.correct === true ? 'ok' : eff.correct === false ? 'bad' : 'warn'}>{verdict}</Chip><Chip tone="neutral">{counted}</Chip></span>}>
      {(eff.criteria ?? []).map((c) => (
        <div key={c.id} data-criterion={c.id} data-met={String(c.met)} style={{ borderTop: '1px solid var(--border-faint)', padding: '8px 0' }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: c.met === true ? 'var(--ok-deep)' : c.met === false ? 'var(--bad)' : 'var(--warn)' }}>
            <span aria-hidden="true">{c.met === true ? '✓' : c.met === false ? '✗' : '…'}</span> {c.text}
            <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{c.met === null ? (c.needsReview ? '（待核实）' : '（待评定）') : ''}</span>
          </div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.75 }}>
            {(c.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {c.feedback && <div style={{ fontSize: 12.5, color: 'var(--ink-mid)', marginTop: 4 }}>{c.feedback}</div>}
          {c.id === 'explanation' && c.met === null && (
            <Button variant="quiet" style={{ height: 30, fontSize: 12.5, marginTop: 6 }} onClick={onRegrade} disabled={grading}>{grading ? '评定中…' : '重新评定这一项'}</Button>
          )}
        </div>
      ))}
      {j.reviews?.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted-light)' }}>当前显示的是 {new Date(j.reviews.at(-1).ts).toLocaleString('zh-CN')} 的复核结果；最初的评分也保存在记录里。</div>}
      <details data-testid="submitted-work" style={{ marginTop: 10, fontSize: 12.5 }}>
        <summary style={{ cursor: 'pointer', color: 'var(--brand)' }}>查看这次提交的作品（代码 v{j.answer?.codeVersion}，{run?.dataVersion ?? '数据版本未知'}）</summary>
        <div style={{ color: 'var(--ink-soft)', lineHeight: 1.8, margin: '8px 0' }}>
          <div>目标列：{j.answer?.target || '（没填）'} · 选的模型：{j.answer?.chosen ? `「${j.answer.chosen.name}」` : '（没选）'}</div>
          <div>训练集和验证集的作用：{j.answer?.roles || '（没写）'}</div>
          <div>结论：{j.answer?.conclusion || '（没写）'}</div>
        </div>
        {code
          ? <pre className="mono console" style={{ margin: 0, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border-soft)', borderRadius: 9, maxHeight: 320, overflow: 'auto' }}>{code}</pre>
          : <div style={{ color: 'var(--muted)' }}>这次提交的代码没有保存在本机（可能来自导入的记录）。</div>}
      </details>
    </Card>
  )
}
