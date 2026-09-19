/**
 * The capstone's standing, in words: the assisted main project and the
 * independent variants are reported separately, never merged into one grade.
 */

import { effective } from '../engine/capabilities.js'

const verdictText = (j) => (j.correct === true ? '通过' : j.correct === false ? '未通过' : '部分待评定')

export function projectJudgements(learner, course) {
  const p = course.project
  if (!p) return { main: [], variant: [] }
  const js = learner.judgements.filter((j) => j.conceptId === p.id).map(effective)
  return {
    main: js.filter((j) => j.activity === 'project'),
    variant: js.filter((j) => j.activity === 'project-verify'),
  }
}

/** { key, short, rows } for the navigation and the capability profile. */
export function projectSummary(learner, course) {
  const p = course.project
  if (!p) return { key: 'unverified', short: '', rows: [] }
  const { main, variant } = projectJudgements(learner, course)
  const lastMain = main.at(-1)
  const passV = variant.find((j) => j.correct === true && j.independent)
  const lastV = variant.at(-1)
  const started = Object.values(learner.attempts).some((a) => a.conceptId === p.id)
  const key = passV ? 'transfer' : started || main.length ? 'learning' : 'unverified'
  const short = passV ? '新变式独立通过' : lastMain ? `主项目${verdictText(lastMain)}` : started ? '进行中' : '未开始'
  const rows = [
    {
      label: '主项目',
      value: lastMain ? `${verdictText(lastMain)}（${lastMain.assisted ? '用过 AI 帮助，记为辅助完成' : '平台内没有使用帮助'}）` : '还没有提交',
      tone: lastMain?.correct === true ? 'ok' : lastMain?.correct === false ? 'bad' : null,
    },
    {
      label: '新数据变式（独立验证）',
      value: passV ? `独立通过（${new Date(passV.ts).toLocaleDateString('zh-CN')}）`
        : lastV ? `${verdictText(lastV)}${lastV.independent || lastV.correct === null ? '' : lastV.assisted ? '（转为辅助，不计入）' : '（重试，不计入）'}` : '还没有做',
      tone: passV ? 'ok' : lastV?.correct === false ? 'bad' : null,
    },
  ]
  return { key, short, rows }
}
