/**
 * React binding for the learner model.
 *
 * The model itself is pure (see learnerModel.js); this hook owns the single copy
 * of it, persists changes, and exposes the derived views the UI needs. All
 * mutation goes through here so persistence can never be forgotten at a call
 * site.
 *
 * Saving is debounced — drafts change on every keystroke — and flushed when the
 * page is hidden or closed. The outcome of every write is kept in `saveState`,
 * so the page can show "未保存" instead of pretending.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  recordJudgement, judgeInAttempt, recordEvent, recordHelp, updateHelpText, startAttempt, closeAttempt, convertAttempt,
  markRevealed, markExplained, setCurrentConcept, setSetting, setDraft, setConversation, setProject,
  reviewJudgement, activeMisconceptions, misconceptionList,
} from './learnerModel.js'
import { loadLearner, saveLearner, resetLearner, exportPackage } from './persistence.js'
import { nextAction, conceptDone, suggestedFirst, conceptStarted, progress } from './policy.js'
import { capabilityStatus, capabilityProfile } from './capabilities.js'

const SAVE_DELAY_MS = 400

export function useLearner(course) {
  const [boot] = useState(() => loadLearner(course))
  const [learner, setLearner] = useState(boot.learner)
  const [notice, setNotice] = useState(boot.notice)
  const [saveState, setSaveState] = useState({ status: 'saved', at: null, error: null })
  const latest = useRef(learner)
  latest.current = learner
  const timer = useRef(null)
  const dirty = useRef(false)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
    if (!dirty.current) return
    const r = saveLearner(latest.current)
    if (r.ok) {
      dirty.current = false
      setSaveState({ status: 'saved', at: r.at, error: null })
    } else {
      setSaveState({ status: 'failed', at: null, error: r.error })
    }
  }, [])

  useEffect(() => {
    dirty.current = true
    setSaveState((s) => (s.status === 'failed' ? s : { ...s, status: 'saving' }))
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [learner, flush])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  const update = useCallback((fn) => setLearner((l) => fn(l)), [])

  const api = useMemo(() => ({
    startAttempt: (spec) => update((l) => startAttempt(l, spec)),
    closeAttempt: (id, status) => update((l) => closeAttempt(l, id, status)),
    convertAttempt: (id) => update((l) => convertAttempt(l, id)),
    judge: (j) => update((l) => recordJudgement(l, course, j)),
    judgeIn: (spec, j) => update((l) => judgeInAttempt(l, course, spec, j)),
    review: (id, r) => update((l) => reviewJudgement(l, id, r)),
    event: (e) => update((l) => recordEvent(l, e)),
    help: (h) => update((l) => recordHelp(l, h)),
    helpText: (id, text) => update((l) => updateHelpText(l, id, text)),
    revealed: (key) => update((l) => markRevealed(l, key)),
    explained: (id, layer) => update((l) => markExplained(l, id, layer)),
    goTo: (id) => update((l) => setCurrentConcept(l, id)),
    setting: (k, v) => update((l) => setSetting(l, k, v)),
    draft: (k, v) => update((l) => setDraft(l, k, v)),
    conversation: (id, ms) => update((l) => setConversation(l, id, ms)),
    project: (fn) => update((l) => setProject(l, fn(l.project))),
  }), [update, course])

  const retrySave = useCallback(() => { dirty.current = true; flush() }, [flush])
  const reset = useCallback(() => {
    setLearner((l) => resetLearner(course, l))
    setNotice(null)
  }, [course])
  const exportNow = useCallback((extra) => exportPackage(latest.current, course, extra), [course])

  const derived = useMemo(() => ({
    action: nextAction(learner, course),
    actionFor: (id) => nextAction(learner, course, id),
    progress: progress(learner, course),
    capabilityOf: (id) => capabilityStatus(learner, course, id),
    profile: () => capabilityProfile(learner, course),
    doneOf: (id) => conceptDone(learner, course, id),
    startedOf: (id) => conceptStarted(learner, id),
    suggestedFirstOf: (id) => suggestedFirst(learner, course, id),
    misconceptionsOf: (id) => activeMisconceptions(learner, id),
    allMisconceptionsOf: (id) => misconceptionList(learner, id),
  }), [learner, course])

  return {
    learner, notice, dismissNotice: () => setNotice(null), saveState, retrySave, reset, exportNow,
    ...api, ...derived,
  }
}
