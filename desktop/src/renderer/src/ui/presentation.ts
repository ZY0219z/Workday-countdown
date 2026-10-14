import type { BusinessState } from '../../../shared/contracts'

export type BadgeState = BusinessState | 'estimate'
export type BadgeTone = 'positive' | 'neutral' | 'warning' | 'danger'
const badges: Record<BadgeState, { label: string; tone: BadgeTone }> = {
  beforeWork: { label: '上班前', tone: 'neutral' },
  working: { label: '工作中', tone: 'positive' },
  break: { label: '午休中', tone: 'warning' },
  overtime: { label: '加班中', tone: 'warning' },
  finished: { label: '已下班', tone: 'positive' },
  rest: { label: '休息日', tone: 'neutral' },
  incomplete: { label: '数据不完整', tone: 'danger' },
  estimate: { label: '估算', tone: 'warning' }
}

export function badgePresentation(state: BadgeState) {
  const value = Object.hasOwn(badges, state) ? badges[state] : badges.incomplete
  return { ...value }
}

// Display guards only. Never calculate seconds, dates, shifts or salary here.
export function countdownPresentation(state: BusinessState, text: string | null, target?: 'workStart' | 'finalWorkEnd') {
  if (state === 'rest') return { heading: '今天休息', text: null, emptyLabel: '无活动班次 · 无工作进度' }
  if (state === 'finished') return { heading: '已经下班啦！', text: null, emptyLabel: '当前班次已结束' }
  const valid = typeof text === 'string' && /^\d{2,}:[0-5]\d:[0-5]\d$/.test(text)
  const heading = state === 'beforeWork' || target === 'workStart' ? '距离上班还有' : '距离下班还有'
  return { heading, text: valid ? text : null, emptyLabel: '暂无可用倒计时' }
}

export function metricValue(value: string | number | null): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  return typeof value === 'string' && value.trim().length ? value : null
}
