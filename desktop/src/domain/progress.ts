import type { DashboardSnapshot, Result } from '../shared/contracts'
import { issue, success, validationFailure } from '../shared/validation'
import { validateInstant, type Instant } from './local-time'
import { exactDateQuality } from './calculation-quality'
import { isResolvedShift, type ResolvedShift } from './schedule'

export type WorkProgress = NonNullable<DashboardSnapshot['progress']> & {
  elapsedWorkMilliseconds: number
  totalWorkMilliseconds: number
  timeQuality: ReturnType<typeof exactDateQuality>
}
export function calculateProgress(shift: ResolvedShift | null, instant: Instant, timeZoneId: string): Result<WorkProgress | null> {
  const now = validateInstant(instant)
  if (!now.ok) return now
  if (shift === null) return success(null)
  if (!isResolvedShift(shift)) return validationFailure([issue('$.shift', 'TYPE', '班次未经过解析校验，不生成进度。')])
  if (shift.timeZoneId !== timeZoneId) return validationFailure([issue('$.timeZoneId', 'FORMAT', '时区变化后须重新解析班次，不复用旧进度边界。')])
  const elapsed = shift.effectiveIntervals.reduce((sum, interval) => sum + Math.max(0, Math.min(now.data, interval.endsAt) - interval.startsAt), 0)
  const completed = Math.min(shift.totalWorkMilliseconds, elapsed)
  return success({ percent: Math.max(0, Math.min(100, completed / shift.totalWorkMilliseconds * 100)),
    elapsedWorkSeconds: completed / 1000, totalWorkSeconds: shift.totalWorkMilliseconds / 1000,
    elapsedWorkMilliseconds: completed, totalWorkMilliseconds: shift.totalWorkMilliseconds,
    quality: { ...shift.quality, incompleteYears: [...shift.quality.incompleteYears] }, timeQuality: exactDateQuality() })
}
