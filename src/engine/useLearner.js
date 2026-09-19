/**
 * React binding for the learner model.
 *
 * The model itself is pure (see learnerModel.js); this hook owns the single copy
 * of it, persists every change, and exposes the derived views the UI needs. All
 * mutation goes through here so persistence can never be forgotten at a call
 * site.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadLearner, saveLearner, resetLearner, recordEvidence, markExplained,
  setCurrentConcept, conceptStatus, activeMisconceptions, progress,
} from './learnerModel.js'
import { nextAction, explainDecision } from './policy.js'

export function useLearner(course) {
  const [learner, setLearner] = useState(() => loadLearner(course))

  // Switching courses must swap in that course's own saved model. useState's
  // initializer runs once, so without this the learner would keep the previous
  // course's concepts and every lookup would miss.
  useEffect(() => {
    setLearner((current) => (current.courseId === course.id ? current : loadLearner(course)))
  }, [course])

  useEffect(() => {
    // Guard against persisting one course's model under another's key during the
    // render between a course switch and the effect above.
    if (learner.courseId === course.id) saveLearner(learner)
  }, [learner, course.id])

  const record = useCallback((obs) => setLearner((l) => recordEvidence(l, obs)), [])
  const explained = useCallback((id, layer) => setLearner((l) => markExplained(l, id, layer)), [])
  const goTo = useCallback((id) => setLearner((l) => setCurrentConcept(l, id)), [])
  const reset = useCallback(() => setLearner(resetLearner(course)), [course])

  const derived = useMemo(() => ({
    action: nextAction(learner, course),
    decision: explainDecision(learner, course),
    progress: progress(learner, course),
    statusOf: (id) => conceptStatus(learner, course, id),
    misconceptionsOf: (id) => activeMisconceptions(learner, id),
  }), [learner, course])

  return { learner, setLearner, record, explained, goTo, reset, ...derived }
}
