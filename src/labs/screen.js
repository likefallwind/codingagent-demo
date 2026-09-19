/**
 * What a lab is showing, reported upward so the tutor can see it.
 *
 * Every lab publishes a small snapshot whenever its visible state changes:
 *
 *   doing  — one line, in the learner's terms: what they are doing right now
 *   facts  — the figures currently on screen, exactly as displayed
 *   moment — optional: a notable state the learner has just reached, with a
 *            deterministic remark the tutor may volunteer ({ id, text, ask })
 *
 * The facts are the contract that keeps the tutor honest in both directions.
 * They are what it may quote — the server's number check accepts a figure only
 * if it appears in them or in the course text — and they contain only what the
 * learner can already see, so a hint cannot leak an answer the lab is still
 * hiding behind a prediction.
 */

import { useEffect } from 'react'

export function useScreen(onScreen, snapshot) {
  // Keyed on content rather than identity: labs build the snapshot inline on
  // every render, and only a real change should reach the tutor.
  const key = JSON.stringify(snapshot)
  useEffect(() => {
    onScreen?.(snapshot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onScreen])
}
