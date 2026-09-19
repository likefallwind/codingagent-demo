/**
 * Identifiers and content hashes.
 *
 * Every record the learner model keeps — an attempt, a judgement, a help
 * exposure, a behaviour event — carries an id, and writes are idempotent on it:
 * a retried request, a double click or a replayed response cannot count twice.
 *
 * Content hashes identify a task instance by what the learner actually saw, so
 * the same question reached through a different seed, or with its options in a
 * different order, is recognised as the same instance rather than a fresh one.
 */

/** FNV-1a, 32 bit, as 8 hex digits. Stable across browser and node. */
export function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Hash of any JSON-able value. Two hashes with different salts make collisions negligible. */
export function contentHash(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value)
  return `${hashString(s)}${hashString(`~${s}`)}`
}

let counter = 0

/** A fresh, practically unique id with a readable prefix. */
export function newId(prefix = 'id') {
  counter = (counter + 1) % 1679616
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}-${rand}`
}
