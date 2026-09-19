/**
 * Lab registry: the one place a widget type named in a course document is bound
 * to a component.
 *
 * This is the whole topic-specific surface of the platform. The engine routes by
 * `concept.lab.type` and never imports any of these; adding a subject means
 * adding entries here and a course document, with no engine change. The same
 * types are listed as plain data in labTypes.js for code that cannot load JSX.
 */

import { TreeReader, SplitExplorer, TreeBuilder } from './fruitTree/LabsBasics.jsx'
import { DepthExplorer, CurveExplorer, PruneExplorer } from './fruitTree/LabsGeneralization.jsx'
import InstabilityExplorer from './fruitTree/InstabilityExplorer.jsx'
import { EntropyExplorer, IdTrapExplorer, GainRatioExplorer } from './playTennis/Id3Labs.jsx'
import { labTypes } from './labTypes.js'

export const labs = {
  'tree-reader': TreeReader,
  'split-explorer': SplitExplorer,
  'tree-builder': TreeBuilder,
  'depth-explorer': DepthExplorer,
  'curve-explorer': CurveExplorer,
  'prune-explorer': PruneExplorer,
  'instability-explorer': InstabilityExplorer,
  'entropy-explorer': EntropyExplorer,
  'id-trap-explorer': IdTrapExplorer,
  'gain-ratio-explorer': GainRatioExplorer,
}

if (import.meta.env?.DEV) {
  const missing = labTypes.filter((t) => !labs[t])
  const extra = Object.keys(labs).filter((t) => !labTypes.includes(t))
  if (missing.length || extra.length) console.error('[labs] registry and labTypes.js disagree', { missing, extra })
}

export const getLab = (type) => labs[type] ?? null
