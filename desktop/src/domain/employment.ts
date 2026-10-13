import type { DashboardSnapshot, DataQuality, LocalDate, Result, SnapshotWarning } from '../shared/contracts'
import { LOCAL_DATE_PATTERN } from '../shared/formats'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { differenceInDays, fromDayOrdinal, MAX_DAY_ORDINAL, normalizeLocalDate, toDayOrdinal } from './local-date'
import type { Calendar } from './calendar'
import { createQualityAccumulator, exactDateQuality } from './calculation-quality'

export interface EmploymentInput { startDate: LocalDate | null; today: LocalDate }
export interface EmploymentLimits { maxDays: number } // Caller budget, not a product/history cutoff.
export interface NaturalDayResult {
  status: DashboardSnapshot['employment']['status']
  elapsedNaturalDays: number | null
  excludesToday: true
  quality: DataQuality
}
export type EmploymentResult = DashboardSnapshot['employment'] & {
  naturalQuality: DataQuality
  usesCurrentWorkWeek: true
  checkedDays: number
  warnings: SnapshotWarning[]
}
const inputShape = v.object<EmploymentInput>({ startDate: v.nullable(v.string(LOCAL_DATE_PATTERN, 10)), today: v.string(LOCAL_DATE_PATTERN, 10) })
export function calculateElapsedNaturalDays(input: unknown): Result<NaturalDayResult> {
  const checked = validateStructure(input, inputShape)
  if (!checked.ok) return checked
  const today = normalizeLocalDate(checked.data.today)
  if (!today.ok) return today
  if (checked.data.startDate === null) return success({ status: 'unset', elapsedNaturalDays: null, excludesToday: true, quality: exactDateQuality() })
  const difference = differenceInDays(checked.data.startDate, today.data)
  if (!difference.ok) return difference
  return success({ status: difference.data < 0 ? 'notStarted' : 'employed', elapsedNaturalDays: Math.max(0, difference.data), excludesToday: true, quality: exactDateQuality() })
}
export function calculateEmployment(input: unknown, calendar: Calendar, limits: EmploymentLimits): Result<EmploymentResult> {
  const checked = validateStructure(input, inputShape)
  if (!checked.ok) return checked
  const budget = validateStructure(limits, v.object<EmploymentLimits>({ maxDays: v.number(1, MAX_DAY_ORDINAL) }))
  if (!budget.ok) return budget
  const natural = calculateElapsedNaturalDays(checked.data)
  if (!natural.ok) return natural
  const count = natural.data.elapsedNaturalDays
  if (count !== null && count > budget.data.maxDays) return validationFailure([issue('$.limits.maxDays', 'LIMIT', '计划工作日回算超过本次计算预算；请提高预算或交由后续缓存服务分段计算。')])
  let planned: number | null = count === null ? null : 0, checkedDays = 0
  const accumulated = createQualityAccumulator()
  if (natural.data.status === 'employed' && checked.data.startDate !== null && count !== null) {
    const start = toDayOrdinal(checked.data.startDate)
    if (!start.ok) return start
    try {
      for (let offset = 0; offset < count; offset++) {
        const date = fromDayOrdinal(start.data + offset)
        if (!date.ok) return date
        const day = calendar.getDay(date.data)
        if (!day.ok) return day
        if (day.data.isWorkDay) planned = (planned ?? 0) + 1
        checkedDays++
        accumulated.add(day.data.quality, day.data.warnings)
      }
    } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取工作日历，未生成累计计划工作日。' } } }
  }
  const quality = accumulated.quality('currentSchedule')
  const currentRuleEstimate = natural.data.status === 'employed'
  quality.approximate ||= currentRuleEstimate
  const businessWarnings = accumulated.warnings('employment')
  if (currentRuleEstimate) businessWarnings.unshift({ code: 'CURRENT_RULE_ESTIMATE', message: '按当前工作周与日历回算计划工作日，不代表实际出勤。', affects: ['employment'], years: [] })
  return success({ status: natural.data.status, elapsedNaturalDays: count, plannedWorkDays: planned, excludesToday: true,
    isActualAttendance: false, quality, naturalQuality: natural.data.quality, usesCurrentWorkWeek: true, checkedDays, warnings: businessWarnings })
}
