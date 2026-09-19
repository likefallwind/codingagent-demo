/**
 * The Python side of the project, run on real scikit-learn when one is
 * available (LEARNAI_TEST_PYTHON, or a python3 that can import sklearn). The
 * browser runs the same module under Pyodide; e2e/acceptance.mjs covers that.
 *
 * The records it produces are fed to the grading rules, so AC-08 is checked
 * end to end: code that only ever scores on its training data fails the data
 * criterion, and says why.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gradeByRules } from '../src/project/grading.js'
import { courseList } from '../src/courses/index.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const task = courseList[0].project.main

function findPython() {
  for (const py of [process.env.LEARNAI_TEST_PYTHON, 'python3'].filter(Boolean)) {
    try {
      execFileSync(py, ['-c', 'import sklearn, pandas'], { stdio: 'ignore' })
      return py
    } catch { /* try the next */ }
  }
  return null
}
const PY = findPython()

function run(code) {
  const dir = mkdtempSync(join(tmpdir(), 'learnai-py-'))
  mkdirSync(join(dir, 'data'))
  copyFileSync(join(ROOT, 'public/pyruntime/learnai.py'), join(dir, 'learnai.py'))
  copyFileSync(join(ROOT, 'public', task.dataset.file), join(dir, task.dataset.path))
  writeFileSync(join(dir, 'project.py'), code)
  const out = execFileSync(PY, ['-c', 'import learnai, runpy, sys; runpy.run_path("project.py"); sys.stdout.write("\\n@@REPORT@@" + learnai._report())'], { cwd: dir, encoding: 'utf8' })
  return JSON.parse(out.split('@@REPORT@@')[1])
}

const header = `import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier
from learnai import log_experiment
df = pd.read_csv("data/germination.csv")
X = df[["soil_moisture", "temperature", "light_hours", "seed_weight", "sow_depth"]]
y = df["germinated"]
`
const configs = `[("基线", {}), ("max_depth=4", {"max_depth": 4}), ("min_samples_leaf=5", {"min_samples_leaf": 5})]`

test('a proper split: records carry the split, and the rules pass the data and experiment criteria', { skip: !PY && 'no python with scikit-learn' }, () => {
  const report = run(`${header}X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, random_state=42)
for name, kw in ${configs}:
    m = DecisionTreeClassifier(random_state=0, **kw).fit(X_train, y_train)
    log_experiment(name, m, X_train, y_train, X_val, y_val)
`)
  assert.equal(report.records.length, 3)
  assert.equal(report.splits[0].random_state, 42)
  assert.ok(report.records.every((r) => r.val_in_train === 0 && r.fit_uses_val === 0 && r.from_split))
  const base = report.records[0]
  assert.ok(base.train_acc > base.val_acc + 0.1, 'the unlimited tree overfits this data')
  const run1 = { id: 'r', status: 'ok', codeHash: 'h', dataVersion: task.dataset.version, report }
  const c = Object.fromEntries(gradeByRules({ task, run: run1, sub: { codeHash: 'h', target: 'germinated', chosenIndex: 2, conclusion: '选第 3 个。' } }).map((x) => [x.id, x]))
  assert.equal(c.data.met, true, c.data.reasons.join(' | '))
  assert.equal(c.experiments.met, true, c.experiments.reasons.join(' | '))
})

test('AC-08: training scores only — the instrumentation sees it and the data criterion fails with a reason', { skip: !PY && 'no python with scikit-learn' }, () => {
  const report = run(`${header}for name, kw in ${configs}:
    m = DecisionTreeClassifier(random_state=0, **kw).fit(X, y)
    log_experiment(name, m, X, y, X, y)
`)
  assert.ok(report.records.every((r) => r.val_in_train === 1))
  const run1 = { id: 'r', status: 'ok', codeHash: 'h', dataVersion: task.dataset.version, report }
  const data = gradeByRules({ task, run: run1, sub: { codeHash: 'h', target: 'germinated', chosenIndex: 0, conclusion: '' } }).find((x) => x.id === 'data')
  assert.equal(data.met, false)
  assert.ok(data.reasons.some((r) => r.includes('验证数据') && r.includes('训练数据')))
})

test('training on everything and scoring on a held-out slice is caught as validation leakage', { skip: !PY && 'no python with scikit-learn' }, () => {
  const report = run(`${header}X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, random_state=42)
m = DecisionTreeClassifier(random_state=0).fit(X, y)
log_experiment("全量", m, X_train, y_train, X_val, y_val)
`)
  assert.equal(report.records[0].fit_uses_val, 1)
  assert.equal(report.records[0].fit_is_train, false)
})

test('a manual DataFrame.sample split is recorded and passes the data criterion', { skip: !PY && 'no python with scikit-learn' }, () => {
  const report = run(`import pandas as pd
from sklearn.tree import DecisionTreeClassifier
from learnai import log_experiment
df = pd.read_csv("data/germination.csv")
train = df.sample(frac=0.75, random_state=7)
val = df.drop(train.index)
cols = ["soil_moisture", "temperature", "light_hours", "seed_weight", "sow_depth"]
for name, kw in ${configs}:
    m = DecisionTreeClassifier(random_state=0, **kw).fit(train[cols], train["germinated"])
    log_experiment(name, m, train[cols], train["germinated"], val[cols], val["germinated"])
`)
  assert.equal(report.splits[0].kind, 'sample')
  const run1 = { id: 'r', status: 'ok', codeHash: 'h', dataVersion: task.dataset.version, report }
  const data = gradeByRules({ task, run: run1, sub: { codeHash: 'h', target: 'germinated', chosenIndex: 0, conclusion: '' } }).find((x) => x.id === 'data')
  assert.equal(data.met, true, data.reasons.join(' | '))
})
