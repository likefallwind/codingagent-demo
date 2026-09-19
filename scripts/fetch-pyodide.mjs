/**
 * Vendor the Python runtime for the capstone project, so a pilot does not
 * depend on a CDN during class.
 *
 * Downloads Pyodide's core files and exactly the packages the project needs
 * (numpy, pandas, scikit-learn and their dependencies, resolved from Pyodide's
 * own lock file) into public/pyodide/v<version>/, checking every package
 * against the sha256 in the lock file. The worker uses this copy when it is
 * there and falls back to the CDN when it is not.
 *
 * Usage: npm run pyodide           (about 40 MB, once; the folder is gitignored)
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PYODIDE_VERSION = '0.27.7'
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const OUT = fileURLToPath(new URL(`../public/pyodide/v${PYODIDE_VERSION}/`, import.meta.url))
const CORE = ['pyodide.js', 'pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const WANT = ['numpy', 'pandas', 'scikit-learn']

async function download(name, { sha256 } = {}) {
  const dest = `${OUT}${name}`
  if (existsSync(dest)) {
    const have = readFileSync(dest)
    if (!sha256 || createHash('sha256').update(have).digest('hex') === sha256) return 'cached'
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${CDN}${name}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (sha256) {
        const got = createHash('sha256').update(buf).digest('hex')
        if (got !== sha256) throw new Error(`sha256 mismatch: ${got}`)
      }
      writeFileSync(dest, buf)
      return `${(buf.length / 1e6).toFixed(1)} MB`
    } catch (err) {
      if (attempt === 3) throw new Error(`${name}: ${err.message}`)
      console.warn(`  retrying ${name} (${err.message})`)
    }
  }
  return null
}

mkdirSync(OUT, { recursive: true })
for (const f of CORE) console.log(f, await download(f))
const lock = JSON.parse(readFileSync(`${OUT}pyodide-lock.json`, 'utf8'))
const need = new Set()
const stack = [...WANT]
while (stack.length) {
  const n = stack.pop()
  if (need.has(n)) continue
  need.add(n)
  stack.push(...(lock.packages[n]?.depends ?? []))
}
for (const n of [...need].sort()) {
  const p = lock.packages[n]
  console.log(n, p.file_name, await download(p.file_name, { sha256: p.sha256 }))
}
writeFileSync(`${OUT}VENDORED.json`, JSON.stringify({ version: PYODIDE_VERSION, packages: [...need].sort(), at: new Date().toISOString() }, null, 2))
console.log(`\nPython runtime vendored into ${OUT}`)
