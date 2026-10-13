import type { ContractError, DashboardSnapshot, DataQuality, LocalDate, Result, SalaryPolicy, SnapshotWarning } from '../shared/contracts'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { daysInMonth, formatLocalDate, MAX_YEAR, normalizeLocalDate, parseLocalDate, toDayOrdinal } from './local-date'
import { findNextWorkDay, findPreviousWorkDay, type Calendar } from './calendar'
import { calendarWarnings, exactDateQuality, mergeQualities } from './calculation-quality'

export const SALARY_MONTH_RADIUS = 12
export const SALARY_SEARCH_DAYS = 366
export type AdjustmentReason = 'policyNone' | 'alreadyWorkDay' | 'delayed' | 'advanced'
export interface AdjustedSalaryDate {
  nominalDate: LocalDate; actualDate: LocalDate; policy: SalaryPolicy
  adjustmentReason: AdjustmentReason; shiftDays: number; quality: DataQuality; warnings: SnapshotWarning[]
}
export type SalaryAdjustmentResult = ({ status: 'found' } & AdjustedSalaryDate) |
  { status: 'notFound'; nominalDate: LocalDate; policy: SalaryPolicy; lastDate: LocalDate; maxDays: number; quality: DataQuality; warnings: SnapshotWarning[] }
export interface SalaryCycle {
  monthOffset: number; nominalDate: LocalDate; monthEndApplied: boolean
  result: SalaryAdjustmentResult | { status: 'dateBoundary'; error: ContractError }
}
export type SalaryResult = ({ status: 'found'; isTodayPayday: boolean; adjustmentReason: AdjustmentReason; shiftDays: number; monthEndApplied: boolean } & NonNullable<DashboardSnapshot['salary']> |
  { status: 'ambiguous'; actualDate: LocalDate; days: number; policy: SalaryPolicy; isPlanned: true; isTodayPayday: boolean;
    quality: DataQuality; matchingCycles: Array<AdjustedSalaryDate & { monthOffset: number; monthEndApplied: boolean }> } |
  { status: 'notFound'; reason: 'noWorkingDay' | 'outsideHorizon'; policy: SalaryPolicy; isPlanned: true; quality: DataQuality }) &
  { warnings: SnapshotWarning[]; cycles: SalaryCycle[]; skippedMonthOffsets: number[] }

export function nominalSalaryDate(year: number, month: number, day: number): Result<LocalDate> {
  const checkedDay = validateStructure(day, v.number(1, 31))
  if (!checkedDay.ok) return checkedDay
  const length = daysInMonth(year, month)
  return length.ok ? formatLocalDate({ year, month, day: Math.min(checkedDay.data, length.data) }) : length
}
// Does not choose a monthly cycle, and never infers actual receipt of salary.
export function adjustSalaryDate(calendar: Calendar, nominalDate: LocalDate, policy: SalaryPolicy = 'delay'): Result<SalaryAdjustmentResult> {
  const date = normalizeLocalDate(nominalDate)
  if (!date.ok) return date
  const checkedPolicy = validateStructure(policy, v.enum(['delay', 'advance', 'none'] as const))
  if (!checkedPolicy.ok) return checkedPolicy
  if (checkedPolicy.data === 'none') return success({ status: 'found', nominalDate: date.data, actualDate: date.data, policy: 'none',
    adjustmentReason: 'policyNone', shiftDays: 0, quality: exactDateQuality(), warnings: [] })
  try {
    const searched = checkedPolicy.data === 'delay'
      ? findNextWorkDay(calendar, date.data, { includeStart: true, maxDays: SALARY_SEARCH_DAYS })
      : findPreviousWorkDay(calendar, date.data, { includeStart: true, maxDays: SALARY_SEARCH_DAYS })
    if (!searched.ok) return searched
    const result = searched.data, warnings = calendarWarnings(result.warnings, 'salary')
    if (result.status === 'notFound') return success({ status: 'notFound', nominalDate: date.data, policy: checkedPolicy.data,
      lastDate: result.lastDate, maxDays: SALARY_SEARCH_DAYS, quality: result.quality, warnings })
    return success({ status: 'found', nominalDate: date.data, actualDate: result.date, policy: checkedPolicy.data,
      adjustmentReason: result.distanceDays === 0 ? 'alreadyWorkDay' : checkedPolicy.data === 'delay' ? 'delayed' : 'advanced',
      shiftDays: result.distanceDays === 0 ? 0 : checkedPolicy.data === 'delay' ? result.distanceDays : -result.distanceDays, quality: result.quality, warnings })
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取工作日历，未生成计划发薪日期。' } } }
}
function isDateBoundary(error: ContractError): boolean {
  return error.code === 'VALIDATION' && error.issues.some(entry => entry.field === '$.days' && entry.reason === 'RANGE')
}
function combineWarnings(values: readonly SnapshotWarning[]): SnapshotWarning[] {
  const grouped = new Map<string, SnapshotWarning>()
  for (const value of values) {
    const key = `${value.code}:${value.message}`
    const previous = grouped.get(key)
    grouped.set(key, { code: value.code, message: value.message, affects: ['salary'],
      years: [...new Set([...(previous?.years ?? []), ...value.years])].sort((a, b) => a - b) })
  }
  return [...grouped.values()]
}
export function calculateNextSalary(calendar: Calendar, today: LocalDate, day: number, policy: SalaryPolicy = 'delay'): Result<SalaryResult> {
  const current = parseLocalDate(today)
  if (!current.ok) return current
  const checked = validateStructure({ day, policy }, v.object<{ day: number; policy: SalaryPolicy }>({ day: v.number(1, 31), policy: v.enum(['delay', 'advance', 'none'] as const) }))
  if (!checked.ok) return checked
  const todayOrdinal = toDayOrdinal(today)
  if (!todayOrdinal.ok) return todayOrdinal
  const monthIndex = (current.data.year - 1) * 12 + current.data.month - 1
  const cycles: SalaryCycle[] = [], skippedMonthOffsets: number[] = []
  const eligible: Array<AdjustedSalaryDate & { monthOffset: number; monthEndApplied: boolean; ordinal: number }> = []
  for (let offset = -SALARY_MONTH_RADIUS; offset <= SALARY_MONTH_RADIUS; offset++) {
    const index = monthIndex + offset
    if (index < 0 || index >= MAX_YEAR * 12) { skippedMonthOffsets.push(offset); continue }
    const nominal = nominalSalaryDate(Math.floor(index / 12) + 1, index % 12 + 1, checked.data.day)
    if (!nominal.ok) return nominal
    const parsed = parseLocalDate(nominal.data)
    if (!parsed.ok) return parsed
    const monthEndApplied = parsed.data.day < checked.data.day
    const adjusted = adjustSalaryDate(calendar, nominal.data, checked.data.policy)
    if (!adjusted.ok) {
      if (!isDateBoundary(adjusted.error)) return adjusted // Query failures never become valid paydays.
      cycles.push({ monthOffset: offset, nominalDate: nominal.data, monthEndApplied, result: { status: 'dateBoundary', error: adjusted.error } })
      continue
    }
    cycles.push({ monthOffset: offset, nominalDate: nominal.data, monthEndApplied, result: adjusted.data })
    if (adjusted.data.status !== 'found') continue
    const actual = toDayOrdinal(adjusted.data.actualDate)
    if (!actual.ok) return actual
    const distance = actual.data - todayOrdinal.data
    if (distance >= 0 && distance <= SALARY_SEARCH_DAYS) eligible.push({ ...adjusted.data, monthOffset: offset, monthEndApplied, ordinal: actual.data })
  }
  // Sort absolute Civil ordinals, not input iteration order. A tie remains a tie.
  eligible.sort((a, b) => a.ordinal - b.ordinal || a.monthOffset - b.monthOffset)
  const first = eligible[0]
  if (!first) {
    const boundary = cycles.find(cycle => cycle.result.status === 'dateBoundary')
    if (boundary?.result.status === 'dateBoundary') return { ok: false, error: boundary.result.error }
    if (skippedMonthOffsets.some(offset => offset > 0)) return validationFailure([issue('$.candidateWindow', 'RANGE', '未来名义发薪周期超出支持的日期范围。')])
    const results = cycles.flatMap(cycle => cycle.result.status === 'dateBoundary' ? [] : [cycle.result])
    const source = results[results.length - 1]?.quality.source ?? 'clock'
    return success({ status: 'notFound', reason: results.some(result => result.status === 'found') ? 'outsideHorizon' : 'noWorkingDay',
      policy: checked.data.policy, isPlanned: true, quality: mergeQualities(results.map(result => result.quality), source),
      warnings: combineWarnings(results.flatMap(result => result.warnings)), cycles, skippedMonthOffsets })
  }
  const matching = eligible.filter(candidate => candidate.ordinal === first.ordinal)
  // Retain uncertainty from prior cycles that could enter the result horizon;
  // unrelated later cycles do not taint a known nearest date.
  const relevant = cycles.filter(cycle => {
    if (cycle.result.status === 'dateBoundary') return false
    const nominal = toDayOrdinal(cycle.nominalDate)
    return nominal.ok && cycle.monthOffset <= matching[matching.length - 1].monthOffset &&
      (checked.data.policy === 'none' ? cycle.result.status === 'found' && cycle.result.actualDate === first.actualDate
        : checked.data.policy === 'delay' ? nominal.data + SALARY_SEARCH_DAYS >= todayOrdinal.data : nominal.data >= todayOrdinal.data)
  }).flatMap(cycle => cycle.result.status === 'dateBoundary' ? [] : [cycle.result])
  const quality = mergeQualities(relevant.map(result => result.quality), first.quality.source)
  const warnings = combineWarnings(relevant.flatMap(result => result.warnings))
  const days = first.ordinal - todayOrdinal.data
  if (matching.length > 1) return success({ status: 'ambiguous', actualDate: first.actualDate, days, policy: checked.data.policy,
    isPlanned: true, isTodayPayday: days === 0, quality, matchingCycles: matching.map(candidate => ({ nominalDate: candidate.nominalDate,
      actualDate: candidate.actualDate, policy: candidate.policy, adjustmentReason: candidate.adjustmentReason, shiftDays: candidate.shiftDays,
      quality: candidate.quality, warnings: candidate.warnings, monthOffset: candidate.monthOffset, monthEndApplied: candidate.monthEndApplied })),
    warnings, cycles, skippedMonthOffsets })
  return success({ status: 'found', nominalDate: first.nominalDate, actualDate: first.actualDate, days, policy: checked.data.policy,
    isPlanned: true, isTodayPayday: days === 0, adjustmentReason: first.adjustmentReason, shiftDays: first.shiftDays, monthEndApplied: first.monthEndApplied,
    quality, warnings, cycles, skippedMonthOffsets })
}
