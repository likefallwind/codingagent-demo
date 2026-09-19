/**
 * Build once, then run both browser suites: the whole-course walkthrough and
 * the M2 acceptance paths. Exit code is non-zero if either finds a problem.
 */

import { spawnSync, execSync } from 'node:child_process'
import { ROOT } from './lib.mjs'

if (!process.env.BASE_URL) execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' })
let failed = false
for (const script of ['e2e/walkthrough.mjs', 'e2e/acceptance.mjs']) {
  console.log(`\n##### ${script}`)
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SKIP_BUILD: '1' } })
  if (r.status !== 0) failed = true
}
process.exit(failed ? 1 : 0)
