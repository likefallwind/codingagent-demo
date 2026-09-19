/**
 * Every lab widget type the registry can render, as plain data.
 *
 * registry.js binds these to React components; this list exists separately so
 * node — the tests and the server — can check a course document's lab types
 * without importing JSX.
 */
export const labTypes = [
  'tree-reader',
  'split-explorer',
  'tree-builder',
  'depth-explorer',
  'curve-explorer',
  'prune-explorer',
  'instability-explorer',
  'entropy-explorer',
  'id-trap-explorer',
  'gain-ratio-explorer',
]
