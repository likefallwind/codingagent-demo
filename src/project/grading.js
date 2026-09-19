/**
 * Project grading by named criteria.
 *
 * Four of the five criteria are rules applied to the run's own records — what
 * the instrumented Python actually did, not what the learner says it did:
 *
 *   runs         the submitted code version ran to the end on the task's data
 *   data         a real validation split: the model never trained on validation
 *                rows, validation rows are not training rows, the target and the
 *                identifier columns are not features, the split is reproducible
 *   experiments  at least three distinct configurations on the same split,
 *                including a baseline and a change of a complexity parameter
 *   consistency  the chosen model is one of the recorded ones, and every figure
 *                the conclusion quotes appears in the records
 *
 * The fifth, the explanation, is judged against the author's points by the
 * model on the server, and stays pending when that is unavailable. No criterion
 * substitutes for another, and none needs a particular parameter or a
 * particular accuracy.
 *
 * Pure: the same inputs always give the same result, so an exported package can
 * be re-graded and checked.
 */

import { contentHash } from '../engine/ids.js'

export const PROJECT_GRADING_VERSION = 'project-rules-2026.09-1'

const COMPLEXITY = ['max_depth', 'min_samples_leaf', 'min_samples_split', 'max_leaf_nodes', 'ccp_alpha']
const DEFAULTS = { max_depth: null, min_samples_leaf: 1, min_samples_split: 2, max_leaf_nodes: null, ccp_alpha: 0 }

const isDefault = (k, v) => (DEFAULTS[k] === null ? v === null || v === undefined : Number(v) === DEFAULTS[k])

/** A configuration's identity: its complexity parameters and criterion. */
export const configKey = (r) => JSON.stringify([r.params?.criterion ?? 'gini', ...COMPLEXITY.map((k) => r.params?.[k] ?? DEFAULTS[k])])

export function isBaseline(r) {
  return /基线|baseline/i.test(r.name ?? '') || COMPLEXITY.every((k) => isDefault(k, r.params?.[k]))
}

export function changesComplexity(r) {
  return COMPLEXITY.some((k) => !isDefault(k, r.params?.[k]))
}

/** The distinct configurations among a run's records, first occurrence kept. */
export function distinctRecords(records) {
  const seen = new Set()
  return (records ?? []).filter((r) => {
    const k = configKey(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Every number written in a piece of text: 0.842, 84.2%, 84%, 16. */
export function numbersIn(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*(%|％)?/g)) {
    out.push({ raw: m[0].trim(), value: Number(m[1]), percent: Boolean(m[2]), decimals: (m[1].split('.')[1] ?? '').length })
  }
  return out
}

/**
 * Whether a quoted number can be traced to the records. A number matches a
 * value if it rounds to it at the precision it was written with; small counts
 * (up to 10) are allowed freely — "三种设置", "第 2 个".
 */
export function traceable(num, records, split) {
  if (!num.percent && num.decimals === 0 && num.value <= 10) return true
  const values = []
  for (const r of records) {
    values.push(r.train_acc, r.val_acc, r.depth, r.leaves, r.n_train, r.n_val)
    for (const v of Object.values(r.params ?? {})) if (typeof v === 'number') values.push(v)
    values.push(Math.abs(r.train_acc - r.val_acc))
  }
  // Differences between two settings ("验证准确率高了 11 个百分点") trace too.
  for (const a of records) {
    for (const b of records) {
      if (a === b) continue
      values.push(Math.abs(a.val_acc - b.val_acc), Math.abs(a.train_acc - b.train_acc), Math.abs(a.leaves - b.leaves))
    }
  }
  for (const s of split ? [split] : []) values.push(s.n_train, s.n_val, s.n_total, s.test_size, s.random_state)
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  const tol = 0.5 * 10 ** -num.decimals + 1e-9
  return nums.some((v) => {
    if (num.percent) return Math.abs(v * 100 - num.value) <= tol || Math.abs(v - num.value) <= tol
    return Math.abs(v - num.value) <= tol || (v <= 1 && Math.abs(v * 100 - num.value) <= tol)
  })
}

/**
 * The split the records were evaluated on: a train_test_split whose sizes they
 * match, or a DataFrame.sample that drew their training (or validation) rows.
 */
export function splitOf(report) {
  const splits = report?.splits ?? []
  const r = report?.records?.[0]
  if (!r) return splits.find((s) => s.kind !== 'sample') ?? null
  const tts = splits.find((s) => s.kind !== 'sample' && s.n_train === r.n_train && s.n_val === r.n_val)
  if (tts) return tts
  const drawn = splits.find((s) => s.kind === 'sample' && (s.n_sample === r.n_train || s.n_sample === r.n_val))
  if (drawn) {
    return { kind: 'sample', n_total: drawn.n_total, n_train: r.n_train, n_val: r.n_val, random_state: drawn.random_state, test_size: null }
  }
  return splits.find((s) => s.kind !== 'sample') ?? null
}

const result = (id, title, met, reasons, extra = {}) => ({ id, title, met, reasons, ...extra })

/**
 * Grade a submission by rules.
 *
 * `task`   the course's task (main or a variant): dataset.version, target, idColumns
 * `run`    { id, status, codeHash, dataVersion, dataHash, report }
 * `sub`    { codeHash, target, chosenIndex, conclusion, roles }
 * `independent` true for an independent variant: fewer diagnostics are shown in
 *          the preview so it does not do the task's thinking for the learner.
 */
export function gradeByRules({ task, run, sub, criteriaTitles = {} }) {
  const T = (id, fallback) => criteriaTitles[id] ?? fallback
  const report = run?.report ?? { splits: [], records: [] }
  const records = report.records ?? []
  const split = splitOf(report)
  const out = []

  // runs
  {
    const reasons = []
    if (!run) reasons.push('没有找到这次提交对应的运行记录')
    else {
      if (run.status !== 'ok') reasons.push(run.status === 'timeout' ? '运行超时了，没有跑完' : run.status === 'cancelled' ? '运行被停止了，没有跑完' : '运行报错了，没有跑完')
      if (run.codeHash !== sub.codeHash) reasons.push('提交的代码和这次运行的代码不是同一个版本')
      if (run.dataVersion !== task.dataset.version) reasons.push(`这次运行用的数据不是本任务的数据包 ${task.dataset.version}`)
      if (task.dataset.hash && run.dataHash && run.dataHash !== task.dataset.hash) reasons.push('数据文件的内容和任务包登记的不一致')
      if (!records.length) reasons.push('运行里没有任何 log_experiment 记录')
    }
    out.push(result('runs', T('runs', '代码能完整运行'), reasons.length === 0, reasons.length ? reasons : ['提交的代码版本完整运行，有实验记录']))
  }

  // data
  {
    const reasons = []
    if (sub.target && sub.target !== task.dataset.target) reasons.push(`你填的目标列是「${sub.target}」，这个任务要预测的是「${task.dataset.target}」`)
    if (!records.length) reasons.push('没有实验记录，无法检查数据用法')
    for (const r of records) {
      const name = `「${r.name}」`
      if (r.val_in_train === null || r.fit_uses_val === null) reasons.push(`${name}的训练数据和验证数据无法核对（请用同一份表格划分出的 X_train / X_val）`)
      else {
        if (r.val_in_train > 0) reasons.push(`${name}的验证数据里有 ${Math.round(r.val_in_train * 100)}% 的行也在训练数据里——这样量出来的不是没见过的数据上的表现`)
        if (r.fit_uses_val > 0) reasons.push(`${name}训练时用到了 ${Math.round(r.fit_uses_val * 100)}% 的验证行——验证集必须留在训练之外`)
      }
      if (r.n_val !== null && r.n_val === 0) reasons.push(`${name}没有验证数据`)
      const feats = r.features ?? []
      if (feats.includes(task.dataset.target)) reasons.push(`${name}把目标列「${task.dataset.target}」当成了特征`)
      for (const id of task.dataset.idColumns ?? []) if (feats.includes(id)) reasons.push(`${name}把编号列「${id}」当成了特征——编号只能记住每一行，不能泛化`)
    }
    if (records.length && !split) reasons.push('没有找到划分记录：请用 train_test_split（或 DataFrame.sample）划分出训练集和验证集')
    if (split) {
      if (split.random_state === null || split.random_state === undefined) reasons.push('划分没有固定 random_state，别人无法复现你的结果')
      const frac = split.n_total ? split.n_val / split.n_total : null
      if (frac !== null && (frac < 0.1 || frac > 0.5)) reasons.push(`验证集占 ${Math.round(frac * 100)}%，太${frac < 0.1 ? '少' : '多'}了（一般在 10%–50% 之间）`)
    }
    const unique = [...new Set(reasons)]
    out.push(result('data', T('data', '数据使用合理'), unique.length === 0 && records.length > 0, unique.length ? unique : [
      `训练 ${split?.n_train ?? records[0]?.n_train} 行、验证 ${split?.n_val ?? records[0]?.n_val} 行，模型只在训练行上拟合，验证行没有参与训练`,
    ]))
  }

  // experiments
  {
    const reasons = []
    const distinct = distinctRecords(records)
    if (distinct.length < 3) reasons.push(`只有 ${distinct.length} 种不同的设置，至少需要 3 种（参数完全相同的记录只算一种）`)
    if (!distinct.some(isBaseline)) reasons.push('没有基线：需要一个不加复杂度限制的模型（或名字里写明「基线」）作对照')
    if (!distinct.some(changesComplexity)) reasons.push('没有改变任何复杂度参数（max_depth、min_samples_leaf 等）')
    const sizes = new Set(records.map((r) => `${r.n_train}/${r.n_val}`))
    if (sizes.size > 1) reasons.push('这些设置用的数据划分不一样，放在一起比较不公平')
    out.push(result('experiments', T('experiments', '实验比较完整'), reasons.length === 0, reasons.length ? reasons : [
      `${distinct.length} 种设置，包括基线和复杂度参数的改变，都在同一个划分上记录了训练和验证准确率`,
    ]))
  }

  // consistency
  {
    const reasons = []
    const chosen = Number.isInteger(sub.chosenIndex) ? records[sub.chosenIndex] : null
    if (!chosen) reasons.push('没有从这次运行的实验记录里选出最终模型')
    const unknown = numbersIn(sub.conclusion).filter((n) => !traceable(n, records, split))
    if (unknown.length) reasons.push(`结论里的 ${[...new Set(unknown.map((n) => n.raw))].slice(0, 5).join('、')} 在这次运行的记录里找不到`)
    if (!String(sub.conclusion ?? '').trim()) reasons.push('还没有写结论')
    out.push(result('consistency', T('consistency', '结论与运行记录一致'), reasons.length === 0, reasons.length ? reasons : ['所选模型来自这次运行，结论里的数字都能在记录里找到']))
  }

  return out
}

/**
 * The explanation criterion. A deterministic floor first — a conclusion that
 * never mentions validation cannot pass, whatever the model says — then the
 * model's per-point judgement. `llm` is null when grading was unavailable.
 */
export function explanationCriterion({ sub, llm, points, title = '解释成立' }) {
  const text = `${sub.roles ?? ''}\n${sub.conclusion ?? ''}`
  if (!String(sub.roles ?? '').trim() || !String(sub.conclusion ?? '').trim()) {
    return result('explanation', title, false, ['「训练集和验证集的作用」和「结论」都要写'], { points: null })
  }
  if (!/验证|val/i.test(sub.conclusion)) {
    return result('explanation', title, false, ['结论没有提到验证集上的表现——不能只凭训练准确率判断模型好坏'], { points: null })
  }
  if (!llm) {
    return result('explanation', title, null, ['文字部分暂时没能批改（AI 服务不可用）。其他各项不受影响，稍后可以重新评定这一项。'], { points: null, pending: true })
  }
  const lowConfidence = Number.isFinite(llm.confidence) && llm.confidence < 0.5
  const required = (llm.points ?? []).filter((p) => p.required)
  const met = required.every((p) => p.met)
  if (lowConfidence) {
    return result('explanation', title, null, ['这次批改拿不准，标记为待核实：老师可以在导出记录里看到原文和评分依据。'], { points: llm.points, pending: true, needsReview: true, feedback: llm.feedback })
  }
  return result('explanation', title, met, (llm.points ?? []).map((p) => `${p.met ? '✓' : '✗'} ${p.text}${p.reason ? `：${p.reason}` : ''}`), {
    points: llm.points, feedback: llm.feedback, textHash: contentHash(text),
  })
}

/** Overall: true only if every criterion passed; null while any is pending; false otherwise. */
export function overall(criteria) {
  if (criteria.some((c) => c.met === false)) return false
  if (criteria.some((c) => c.met === null)) return null
  return true
}

/** The idempotency key of a submission: same run, same answers → same grade record. */
export function submissionKey(taskId, run, sub) {
  return `project:${taskId}:${contentHash({ run: run?.id, code: sub.codeHash, target: sub.target, chosen: sub.chosenIndex, roles: sub.roles, conclusion: sub.conclusion })}`
}
