/**
 * What happened to the saved record when the page loaded: an old save migrated
 * into history, a course upgrade, or a save that could not be read. Says what
 * was kept and what needs verifying again.
 */

import React from 'react'
import { Button } from './ui.jsx'

const TITLE = {
  migrated: '已从旧版进度升级',
  'course-updated': '课程内容更新了',
  unreadable: '上次的存档读不出来',
}

export default function NoticeBanner({ notice, onDismiss }) {
  if (!notice) return null
  return (
    <div role="status" data-testid="notice" data-kind={notice.kind} style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 18px',
      background: 'var(--warn-bg)', borderBottom: '1px solid var(--warn-line)', fontSize: 12.5, lineHeight: 1.75,
    }}>
      <div style={{ flex: 1 }}>
        <b style={{ color: '#8a6414' }}>{TITLE[notice.kind] ?? '提示'}</b>
        {notice.kind === 'course-updated' && <span>（{notice.from} → {notice.to}）</span>}
        {notice.restored?.length > 0 && <span>。已恢复：{notice.restored.join('、')}</span>}
        {notice.reverify?.length > 0 && <span>。需要重新独立验证：{notice.reverify.join('、')}</span>}
        {notice.note && <div style={{ color: 'var(--ink-soft)' }}>{notice.note}</div>}
        {notice.kind === 'unreadable' && <div style={{ color: 'var(--ink-soft)' }}>原存档已原样另存（没有删除），这次从头开始记录。错误：{notice.error}</div>}
      </div>
      <Button variant="quiet" style={{ height: 28, fontSize: 12 }} onClick={onDismiss}>知道了</Button>
    </div>
  )
}
