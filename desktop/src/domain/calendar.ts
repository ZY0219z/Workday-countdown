import type { DataQuality, LocalDate, Result, WorkWeekDay } from '../shared/contracts'
import { LOCAL_DATE_PATTERN } from '../shared/formats'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { addDays, parseLocalDate, toDayOrdinal } from './local-date'
import { isCheckedCalendarYear, type CalendarYear } from './annual-calendar'

export type DayKind = 'work' | 'rest'
export interface CalendarRules { workWeek: WorkWeekDay[]; overrides: Record<LocalDate, DayKind> }
export interface CalendarWarning { code: 'CALENDAR_INCOMPLETE'; year: number; reason: 'missing' | 'unverified' | 'partial' }
export interface CalendarDay {
  date: LocalDate
  weekday: WorkWeekDay
  kind: DayKind
  isWorkDay: boolean
  isRestDay: boolean
  annual: { year: number; available: boolean; complete: boolean; verification: 'verified' | 'unverified' | 'missing'; version: string | null }
  quality: DataQuality
  warnings: CalendarWarning[]
}
export interface Calendar { getDay(date: LocalDate): Result<CalendarDay> }
const date = v.string(LOCAL_DATE_PATTERN, 10)
const kind = v.enum(['work', 'rest'] as const)
export function validateDateOverrides(input: unknown): Result<Record<LocalDate, DayKind>> {
  const checked = validateStructure(input, v.record(date, kind, 10_000))
  if (!checked.ok) return checked
  for (const key of Object.keys(checked.data)) {
    if (!parseLocalDate(key).ok) return validationFailure([issue(`$.${key}`, 'FORMAT', '覆盖日期不存在或超出范围。')])
  }
  return checked
}
export function overridesFromEntries(input: unknown): Result<Record<LocalDate, DayKind>> {
  const checked = validateStructure(input, v.array(v.object<{ date: LocalDate; kind: DayKind }>({ date, kind }), 0, 10_000, entry => entry.date))
  if (!checked.ok) return checked
  const output: Record<LocalDate, DayKind> = Object.create(null)
  for (const entry of checked.data) output[entry.date] = entry.kind
  return validateDateOverrides(output)
}
export function setDateOverride(input: unknown, dateInput: LocalDate, value: DayKind | null): Result<Record<LocalDate, DayKind>> {
  const checked = validateDateOverrides(input)
  if (!checked.ok) return checked
  const parsed = parseLocalDate(dateInput)
  if (!parsed.ok) return parsed
  const checkedValue = validateStructure(value, v.nullable(kind))
  if (!checkedValue.ok) return checkedValue
  if (checkedValue.data === null) delete checked.data[dateInput]
  else checked.data[dateInput] = checkedValue.data
  return validateDateOverrides(checked.data)
}
export function createCalendar(input: unknown, years: readonly CalendarYear[]): Result<Calendar> {
  const rules = validateStructure(input, v.object<CalendarRules>({ workWeek: v.array(v.enum([1, 2, 3, 4, 5, 6, 7] as const), 1, 7, value => value), overrides: v.record(date, kind, 10_000) }))
  if (!rules.ok) return rules
  const overrides = validateDateOverrides(rules.data.overrides)
  if (!overrides.ok) return overrides
  const annual = new Map<number, { value: CalendarYear; rest: Set<string>; work: Set<string> }>()
  if (!Array.isArray(years)) return validationFailure([issue('$.years', 'TYPE', '年度数据必须为已校验数组。')])
  for (const year of years) {
    if (!isCheckedCalendarYear(year)) return validationFailure([issue('$.years', 'TYPE', '年度包未通过结构、语义与摘要校验。')])
    if (annual.has(year.data.year)) return validationFailure([issue('$.years', 'DUPLICATE', '同年不得加载多个冲突包。')])
    annual.set(year.data.year, { value: year, rest: new Set(year.data.restDates), work: new Set(year.data.workDates) })
  }
  const week = new Set(rules.data.workWeek)
  return success({ getDay(inputDate) {
    const parsed = parseLocalDate(inputDate), ordinal = toDayOrdinal(inputDate)
    if (!parsed.ok) return parsed
    if (!ordinal.ok) return ordinal
    const year = parsed.data.year, weekday = (ordinal.data % 7 + 1) as WorkWeekDay
    const dataset = annual.get(year), custom = overrides.data[inputDate]
    const verification = dataset?.value.verification ?? 'missing'
    const complete = verification === 'verified' && dataset?.value.data.coverage === 'complete'
    // Unreviewed declarations never override the weekly rule as official data.
    const official = verification === 'verified' && dataset
    const special: DayKind | undefined = official ? dataset.rest.has(inputDate) ? 'rest' : dataset.work.has(inputDate) ? 'work' : undefined : undefined
    const selected = custom ?? special ?? (week.has(weekday) ? 'work' : 'rest')
    const source = custom !== undefined ? 'userOverride' : special !== undefined ? 'annual' : 'weekRule'
    const approximate = custom === undefined && (!complete || verification !== 'verified')
    const warnings: CalendarWarning[] = approximate ? [{ code: 'CALENDAR_INCOMPLETE', year,
      reason: !dataset ? 'missing' : verification !== 'verified' ? 'unverified' : 'partial' }] : []
    return success({ date: inputDate, weekday, kind: selected, isWorkDay: selected === 'work', isRestDay: selected === 'rest',
      annual: { year, available: !!dataset, complete, verification, version: dataset?.value.data.version ?? null },
      quality: { approximate, incompleteYears: approximate ? [year] : [], source, annualVerification: verification }, warnings })
  } })
}
export function isWorkDay(calendar: Calendar, date: LocalDate): Result<boolean> {
  const day = calendar.getDay(date)
  return day.ok ? success(day.data.isWorkDay) : day
}
export function isRestDay(calendar: Calendar, date: LocalDate): Result<boolean> {
  const day = calendar.getDay(date)
  return day.ok ? success(day.data.isRestDay) : day
}
export interface CalendarSearchOptions { includeStart: boolean; maxDays: number }
export type CalendarSearchResult = {
  checkedDays: number; quality: DataQuality; warnings: CalendarWarning[]
} & ({ status: 'found'; date: LocalDate; distanceDays: number; day: CalendarDay } |
  { status: 'notFound'; lastDate: LocalDate; maxDays: number })
export function findCalendarDay(calendar: Calendar, start: LocalDate, target: DayKind, options: CalendarSearchOptions): Result<CalendarSearchResult> {
  const parsed = parseLocalDate(start)
  if (!parsed.ok) return parsed
  const checked = validateStructure({ target, options }, v.object<{ target: DayKind; options: CalendarSearchOptions }>({ target: kind,
    options: v.object({ includeStart: v.boolean, maxDays: v.number(1, 366) }) }))
  if (!checked.ok) return checked
  const warnings = new Map<string, CalendarWarning>(), incomplete = new Set<number>()
  let checkedDays = 0, lastDate = start
  let quality: DataQuality = { approximate: false, incompleteYears: [], source: 'weekRule', annualVerification: 'notApplicable' }
  for (let distance = checked.data.options.includeStart ? 0 : 1; distance <= checked.data.options.maxDays; distance++) {
    const date = addDays(start, distance)
    if (!date.ok) return date
    const day = calendar.getDay(date.data)
    if (!day.ok) return day
    lastDate = date.data; checkedDays++
    for (const year of day.data.quality.incompleteYears) incomplete.add(year)
    for (const warning of day.data.warnings) warnings.set(`${warning.year}:${warning.reason}`, warning)
    const rank = { notApplicable: 0, verified: 1, unverified: 2, missing: 3 }
    quality = { approximate: quality.approximate || day.data.quality.approximate, incompleteYears: [...incomplete].sort((a, b) => a - b),
      source: day.data.quality.source, annualVerification: rank[quality.annualVerification] >= rank[day.data.quality.annualVerification]
        ? quality.annualVerification : day.data.quality.annualVerification }
    if (day.data.kind === checked.data.target) return success({ status: 'found', date: date.data, distanceDays: distance, day: day.data,
      checkedDays, quality, warnings: [...warnings.values()] })
  }
  return success({ status: 'notFound', lastDate, maxDays: checked.data.options.maxDays, checkedDays, quality, warnings: [...warnings.values()] })
}
export const findNextWorkDay = (calendar: Calendar, start: LocalDate, options: CalendarSearchOptions): Result<CalendarSearchResult> => findCalendarDay(calendar, start, 'work', options)
export const findNextRestDay = (calendar: Calendar, start: LocalDate, options: CalendarSearchOptions): Result<CalendarSearchResult> => findCalendarDay(calendar, start, 'rest', options)
