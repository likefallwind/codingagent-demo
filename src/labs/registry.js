/**
 * Lab registry: the one place a widget type named in a course document is bound
 * to a component.
 *
 * This is the whole topic-specific surface of the platform. The engine routes by
 * `concept.lab.type` and never imports any of these; adding a subject means
 * adding entries here and a course document, with no engine change.
 */

import { TreeReader, SplitExplorer, TreeBuilder } from './fruitTree/LabsBasics.jsx'
import { DepthExplorer, CurveExplorer, PruneExplorer } from './fruitTree/LabsGeneralization.jsx'
import Id3Explorer from './playTennis/Id3Explorer.jsx'

export const labs = {
  'tree-reader': TreeReader,
  'split-explorer': SplitExplorer,
  'tree-builder': TreeBuilder,
  'depth-explorer': DepthExplorer,
  'curve-explorer': CurveExplorer,
  'prune-explorer': PruneExplorer,
  'id3-explorer': Id3Explorer,
}

export const getLab = (type) => labs[type] ?? null
