/**
 * Build the capstone project's data packages.
 *
 * Two versioned CSVs, generated deterministically so the package can be rebuilt
 * byte for byte and every learner gets the same rows:
 *
 *   germination-v1.csv — the main (assisted) project: will a seed sprout?
 *   farm-b-v1.csv      — the independent variant: another farm, different
 *                        columns, a string target and more label noise, so the
 *                        main project's code cannot simply be re-run.
 *   farm-c-v1.csv      — a parallel variant for a second independent try, so a
 *                        learner who fails the first is re-verified on data they
 *                        have not seen rather than on the same task again.
 *
 * Both carry an identifier column and one non-numeric column. Using the id as a
 * feature is the "row number" trap from the ID3 chapter; feeding the string
 * column straight to the tree is a real error to read and fix.
 *
 * Usage: node scripts/make-project-data.mjs   (writes into public/project/)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeRng } from '../src/labs/rng.js'
import { contentHash } from '../src/engine/ids.js'

const OUT = fileURLToPath(new URL('../public/project/', import.meta.url))
const r1 = (v) => Math.round(v * 10) / 10

function germination() {
  const rnd = makeRng(20260919)
  const rows = []
  for (let i = 1; i <= 480; i++) {
    const tray = 'ABCD'[Math.floor(rnd() * 4)]
    const moisture = Math.round(8 + rnd() * 54)
    const temp = r1(6 + rnd() * 28)
    const light = Math.round(rnd() * 14)
    const weight = r1(18 + rnd() * 64)
    const depth = r1(0.5 + rnd() * 4.5)
    const deepOk = depth <= 3.2 || (weight > 60 && depth <= 4.3)
    const shallowDark = depth < 1.2 && light < 4
    let y = moisture >= 22 && moisture <= 50 && temp >= 14 && temp <= 29 && deepOk && !shallowDark ? 1 : 0
    if (rnd() < 0.12) y = 1 - y
    rows.push([i, tray, moisture, temp, light, weight, depth, y])
  }
  return [['sample_id', 'tray', 'soil_moisture', 'temperature', 'light_hours', 'seed_weight', 'sow_depth', 'germinated'], ...rows]
}

function farmB() {
  const rnd = makeRng(20260920)
  const rows = []
  for (let i = 1; i <= 420; i++) {
    const id = `P${String(i).padStart(3, '0')}`
    const ph = r1(4.8 + rnd() * 3.8)
    const rain = Math.round(rnd() * 70)
    const temp = r1(5 + rnd() * 28)
    const sun = Math.round(2 + rnd() * 10)
    const mass = Math.round(15 + rnd() * 75)
    const soil = ['clay', 'loam', 'sand'][Math.floor(rnd() * 3)]
    let ok = ph >= 5.9 && ph <= 7.6 && rain >= 14 && rain <= 48 && temp >= 11
    if (rnd() < 0.13) ok = !ok
    rows.push([id, soil, ph, rain, temp, sun, mass, ok ? 'yes' : 'no'])
  }
  return [['plot_id', 'soil_type', 'soil_ph', 'rain_mm', 'avg_temp', 'sun_hours', 'seed_mass_mg', 'sprouted'], ...rows]
}

function farmC() {
  const rnd = makeRng(20260921)
  const rows = []
  for (let i = 1; i <= 440; i++) {
    const id = `F-${1000 + i}`
    const irrigation = ['drip', 'flood', 'none'][Math.floor(rnd() * 3)]
    const nitrogen = Math.round(5 + rnd() * 80)
    const ph = r1(5.0 + rnd() * 3.4)
    const frost = Math.round(rnd() * 8)
    const shade = Math.round(rnd() * 90)
    const sowDay = Math.round(60 + rnd() * 80)
    let ok = nitrogen >= 22 && nitrogen <= 62 && frost <= 3 && ph >= 5.5 && ph <= 7.8 && shade <= 70
    if (rnd() < 0.12) ok = !ok
    rows.push([id, irrigation, nitrogen, ph, frost, shade, sowDay, ok ? 'Y' : 'N'])
  }
  return [['field_id', 'irrigation', 'soil_n_ppm', 'soil_ph', 'frost_days', 'shade_pct', 'sow_day', 'emerged'], ...rows]
}

const csv = (table) => `${table.map((r) => r.join(',')).join('\n')}\n`
writeFileSync(`${OUT}germination-v1.csv`, csv(germination()))
writeFileSync(`${OUT}farm-b-v1.csv`, csv(farmB()))
writeFileSync(`${OUT}farm-c-v1.csv`, csv(farmC()))
for (const f of ['germination-v1.csv', 'farm-b-v1.csv', 'farm-c-v1.csv']) {
  console.log(f, contentHash(readFileSync(`${OUT}${f}`, 'utf8')))
}
