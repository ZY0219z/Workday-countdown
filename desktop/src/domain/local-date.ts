import type { LocalDate, Result } from '../shared/contracts'
import { LOCAL_DATE_PATTERN } from '../shared/formats'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'

export interface CivilDate { year: number; month: number; day: number }
export const MIN_YEAR = 1
export const MAX_YEAR = 9999
// Proleptic Gregorian calendar, zero-based at 0001-01-01. No Date or time zone.
export const MAX_DAY_ORDINAL = 3_652_058
const components = v.object<CivilDate>({ year: v.number(MIN_YEAR, MAX_YEAR), month: v.number(1, 12), day: v.number(1, 31) })
const invalid = (field: string, message: string): Result<never> => validationFailure([issue(field, 'RANGE', message)])
const leap = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
const monthLength = (year: number, month: number): number => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
const beforeYear = (year: number): number => {
  const previous = year - 1
  return 365 * previous + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400)
}
function ordinal(date: CivilDate): number {
  let days = beforeYear(date.year) + date.day - 1
  for (let month = 1; month < date.month; month++) days += monthLength(date.year, month)
  return days
}

export function isLeapYear(year: unknown): Result<boolean> {
  const checked = validateStructure(year, v.number(MIN_YEAR, MAX_YEAR))
  return checked.ok ? success(leap(checked.data)) : checked
}
export function daysInMonth(year: unknown, month: unknown): Result<number> {
  const checked = validateStructure({ year, month }, v.object<{ year: number; month: number }>({ year: v.number(MIN_YEAR, MAX_YEAR), month: v.number(1, 12) }))
  return checked.ok ? success(monthLength(checked.data.year, checked.data.month)) : checked
}
export function validateCivilDate(input: unknown): Result<CivilDate> {
  const checked = validateStructure(input, components)
  if (!checked.ok) return checked
  return checked.data.day <= monthLength(checked.data.year, checked.data.month)
    ? checked : invalid('$.day', '该年月不存在此日期。')
}
export function parseLocalDate(input: unknown): Result<CivilDate> {
  const checked = validateStructure(input, v.string(LOCAL_DATE_PATTERN, 10))
  if (!checked.ok) return checked
  const [year, month, day] = checked.data.split('-').map(Number)
  return validateCivilDate({ year, month, day })
}
export function formatLocalDate(input: CivilDate): Result<LocalDate> {
  const checked = validateCivilDate(input)
  if (!checked.ok) return checked
  const { year, month, day } = checked.data
  return success(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
}
// Canonicalization never repairs invalid dates or silently accepts unpadded input.
export function normalizeLocalDate(input: unknown): Result<LocalDate> {
  const parsed = parseLocalDate(input)
  return parsed.ok ? formatLocalDate(parsed.data) : parsed
}
export function toDayOrdinal(input: LocalDate): Result<number> {
  const parsed = parseLocalDate(input)
  return parsed.ok ? success(ordinal(parsed.data)) : parsed
}
export function fromDayOrdinal(input: unknown): Result<LocalDate> {
  const checked = validateStructure(input, v.number(0, MAX_DAY_ORDINAL))
  if (!checked.ok) return checked
  // Binary search avoids both Date's 0-99 remapping and unchecked overflow.
  let low = MIN_YEAR, high = MAX_YEAR
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (beforeYear(middle) <= checked.data) low = middle
    else high = middle - 1
  }
  let remaining = checked.data - beforeYear(low), month = 1
  while (remaining >= monthLength(low, month)) remaining -= monthLength(low, month++)
  return formatLocalDate({ year: low, month, day: remaining + 1 })
}
export function addDays(date: LocalDate, days: unknown): Result<LocalDate> {
  const base = toDayOrdinal(date)
  if (!base.ok) return base
  const delta = validateStructure(days, v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
  if (!delta.ok) return delta
  const target = base.data + delta.data
  return Number.isSafeInteger(target) && target >= 0 && target <= MAX_DAY_ORDINAL
    ? fromDayOrdinal(target) : invalid('$.days', '日期运算超出0001-01-01至9999-12-31。')
}
// Signed to - from, without business clamping for future employment dates.
export function differenceInDays(from: LocalDate, to: LocalDate): Result<number> {
  const start = toDayOrdinal(from), end = toDayOrdinal(to)
  if (!start.ok) return start
  return end.ok ? success(end.data - start.data) : end
}
export function compareDates(left: LocalDate, right: LocalDate): Result<-1 | 0 | 1> {
  const difference = differenceInDays(left, right)
  return difference.ok ? success(difference.data === 0 ? 0 : difference.data > 0 ? -1 : 1) : difference
}
