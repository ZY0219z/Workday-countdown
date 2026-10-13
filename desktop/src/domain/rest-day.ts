import type { DashboardSnapshot, LocalDate, Result, SnapshotWarning, WorkWeekDay } from '../shared/contracts'
import { success } from '../shared/validation'
import { findNextRestDay, type Calendar, type CalendarSearchOptions } from './calendar'
import { calendarWarnings } from './calculation-quality'

export type NextRestResult = ({ status: 'found'; weekday: WorkWeekDay; isTodayRest: boolean } & NonNullable<DashboardSnapshot['nextRest']> |
  { status: 'notFound'; lastDate: LocalDate; maxDays: number; quality: NonNullable<DashboardSnapshot['nextRest']>['quality'] }) &
  { checkedDays: number; warnings: SnapshotWarning[] }
export function calculateNextRestDay(calendar: Calendar, today: LocalDate, options: CalendarSearchOptions): Result<NextRestResult> {
  try {
    const searched = findNextRestDay(calendar, today, options)
    if (!searched.ok) return searched
    const result = searched.data, warnings = calendarWarnings(result.warnings, 'nextRest')
    return result.status === 'found'
      ? success({ status: 'found', date: result.date, days: result.distanceDays, weekday: result.day.weekday, isTodayRest: result.distanceDays === 0,
        quality: result.quality, checkedDays: result.checkedDays, warnings })
      : success({ status: 'notFound', lastDate: result.lastDate, maxDays: result.maxDays, quality: result.quality, checkedDays: result.checkedDays, warnings })
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取工作日历，未生成休息日结果。' } } }
}
