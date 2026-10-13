import type { BusinessState, ContractError, DashboardSnapshot, LocalDate, LocalTime, Result, ScheduleConfig, ShiftSnapshot, SnapshotWarning } from '../shared/contracts'
import { editableValidators, dateFormat } from '../shared/config-schema'
import { issue, success, v, validateStructure, validationFailure } from '../shared/validation'
import { addDays, fromDayOrdinal, MAX_DAY_ORDINAL, normalizeLocalDate, toDayOrdinal } from './local-date'
import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_MINUTE, minutesSinceMidnight, parseLocalTime, validateInstant, type Instant } from './local-time'
import type { Clock } from './clock'
import type { Calendar, CalendarDay } from './calendar'
import type { LocalTimeResolution, TimeZoneAdapter } from './time-zone'
import { calendarWarnings, exactDateQuality } from './calculation-quality'
import { setOvertimeForShift, validateOvertime, type OvertimeConfig } from './overtime'

export const MAX_SHIFT_MILLISECONDS = 34 * 60 * MILLISECONDS_PER_MINUTE
// With D03 offsets <24h, 34 elapsed hours can cross at most four Civil labels.
export const NEIGHBOUR_RADIUS = 4
export interface ScheduleContext { calendar: Calendar; timeZoneId: string; zones: TimeZoneAdapter }
export interface TimeInterval { startsAt: Instant; endsAt: Instant }
export interface ResolvedShift extends ShiftSnapshot {
  timeZoneId: string
  startDate: LocalDate
  endDate: LocalDate
  effectiveIntervals: TimeInterval[]
  totalWorkMilliseconds: number
  calendarDay: CalendarDay
  warnings: SnapshotWarning[]
}
export interface TimeAmbiguity { field: string; date: LocalDate; time: LocalTime; candidates: Instant[] }
type PendingShift = {
  shiftDate: LocalDate; possibleStarts: Instant[]; possibleEnds: Instant[]; overtimeMinutes: number
} & ({ status: 'ambiguous'; issues: TimeAmbiguity[]; warnings: SnapshotWarning[] } |
  { status: 'invalid'; error: ContractError })
type BuiltShift = { status: 'ready'; shift: ResolvedShift } | { status: 'noShift'; day: CalendarDay } | { status: 'irrelevant' } | PendingShift
export type ShiftResolution = Exclude<BuiltShift, { status: 'invalid' } | { status: 'irrelevant' }>
export interface ScheduleSelection {
  state: BusinessState
  instant: Instant
  localDate: LocalDate
  timeZoneId: string
  shift: ResolvedShift | null
  countdown: DashboardSnapshot['countdown']
  timeQuality: ReturnType<typeof exactDateQuality>
  warnings: SnapshotWarning[]
  ambiguities: TimeAmbiguity[]
  checkedShiftDates: LocalDate[]
}
const resolved = new WeakSet<object>()
export const isResolvedShift = (input: unknown): input is ResolvedShift => typeof input === 'object' && input !== null && resolved.has(input)
function freeze(value: object): void {
  Object.values(value).forEach(child => { if (child !== null && typeof child === 'object') freeze(child) })
  Object.freeze(value)
}
const invalid = (field: string, message: string, reason: 'RANGE' | 'FORMAT' | 'DUPLICATE' = 'RANGE'): Result<never> => validationFailure([issue(field, reason, message)])
export function validateSchedule(input: unknown): Result<ScheduleConfig> {
  const checked = validateStructure(input, editableValidators.schedule)
  if (!checked.ok) return checked
  const start = minutesSinceMidnight(checked.data.startTime), end = minutesSinceMidnight(checked.data.endTime)
  if (!start.ok) return start
  if (!end.ok) return end
  const finish = end.data + (checked.data.crossMidnight ? 1440 : 0)
  if (finish <= start.data || finish - start.data > 1440) return invalid('$.schedule', '常规班次须为正时长且不超过24小时，跨夜必须显式设置。')
  const breaks: Array<{ start: number; end: number }> = []
  for (const interval of checked.data.breaks) {
    const first = minutesSinceMidnight(interval.startTime), last = minutesSinceMidnight(interval.endTime)
    if (!first.ok) return first
    if (!last.ok) return last
    const a = first.data + interval.startDayOffset * 1440, b = last.data + interval.endDayOffset * 1440
    if (b <= a || a < start.data || b > finish) return invalid('$.schedule.breaks', '休息须为正时长且完全位于常规班次内。')
    breaks.push({ start: a, end: b })
  }
  breaks.sort((a, b) => a.start - b.start)
  if (breaks.some((interval, i) => i > 0 && interval.start < breaks[i - 1].end)) return invalid('$.schedule.breaks', '休息区间不能重叠。', 'DUPLICATE')
  if (finish - start.data - breaks.reduce((sum, interval) => sum + interval.end - interval.start, 0) <= 0) return invalid('$.schedule.breaks', '扣除休息后的常规净工作时长必须大于0。')
  return checked
}
function datesAround(anchor: LocalDate): Result<LocalDate[]> {
  const ordinal = toDayOrdinal(anchor)
  if (!ordinal.ok) return ordinal
  const output: LocalDate[] = []
  for (let index = Math.max(0, ordinal.data - NEIGHBOUR_RADIUS); index <= Math.min(MAX_DAY_ORDINAL, ordinal.data + NEIGHBOUR_RADIUS); index++) {
    const date = fromDayOrdinal(index)
    if (!date.ok) return date
    output.push(date.data)
  }
  return success(output)
}
function session(scheduleInput: unknown, overtimeInput: unknown, context: ScheduleContext) {
  const schedule = validateSchedule(scheduleInput), overtime = validateOvertime(overtimeInput)
  if (!schedule.ok) return schedule
  if (!overtime.ok) return overtime
  const config = schedule.data
  const records = new Map(overtime.data.entries.map(entry => [entry.shiftDate, entry.minutes]))
  const boundaries = new Map<string, Result<LocalTimeResolution>>()
  function boundary(date: LocalDate, time: LocalTime): Result<LocalTimeResolution> {
    const key = JSON.stringify([context.timeZoneId, date, time])
    const cached = boundaries.get(key)
    if (cached) return cached
    const parsed = parseLocalTime(time)
    const result = parsed.ok ? context.zones.resolve({ date, time: parsed.data }, context.timeZoneId) : parsed
    boundaries.set(key, result)
    return result
  }
  function build(shiftDate: LocalDate, filter?: { start: number; end: number; keepDate?: LocalDate }): Result<BuiltShift> {
    const date = normalizeLocalDate(shiftDate)
    if (!date.ok) return date
    const day = context.calendar.getDay(date.data)
    if (!day.ok) return day
    if (!day.data.isWorkDay) return success({ status: 'noShift', day: day.data })
    if (filter && date.data !== filter.keepDate) {
      const first = boundary(date.data, config.startTime)
      if (!first.ok) return first
      const starts = first.data.kind === 'unique' ? [first.data.instant] : first.data.candidates
      if (starts.length && (Math.min(...starts) >= filter.end || Math.max(...starts) + MAX_SHIFT_MILLISECONDS <= filter.start)) return success({ status: 'irrelevant' })
    }
    const endDate = addDays(date.data, config.crossMidnight ? 1 : 0)
    if (!endDate.ok) return endDate
    const inputs: Array<{ field: string; date: LocalDate; time: LocalTime }> = [
      { field: '$.startsAt', date: date.data, time: config.startTime }, { field: '$.normalEndsAt', date: endDate.data, time: config.endTime }
    ]
    for (const [i, interval] of config.breaks.entries()) {
      const startDate = addDays(date.data, interval.startDayOffset), lastDate = addDays(date.data, interval.endDayOffset)
      if (!startDate.ok) return startDate
      if (!lastDate.ok) return lastDate
      inputs.push({ field: `$.breaks[${i}].startsAt`, date: startDate.data, time: interval.startTime }, { field: `$.breaks[${i}].endsAt`, date: lastDate.data, time: interval.endTime })
    }
    const values: Instant[][] = [], issues: TimeAmbiguity[] = []
    let gap: ContractError | undefined
    for (const input of inputs) {
      const value = boundary(input.date, input.time)
      if (!value.ok) return value
      if (value.data.kind === 'nonexistent') {
        const failure = invalid(input.field, `${input.date} ${input.time}在当前时区不存在。`, 'FORMAT')
        if (!failure.ok) gap = failure.error
        values.push([])
      } else if (value.data.kind === 'ambiguous') {
        issues.push({ field: input.field, date: input.date, time: input.time, candidates: [...value.data.candidates] })
        values.push([...value.data.candidates])
      } else {
        const instant = validateInstant(value.data.instant)
        if (!instant.ok) return instant
        values.push([instant.data])
      }
    }
    const overtimeMinutes = records.get(date.data) ?? 0
    const pending = { shiftDate: date.data, possibleStarts: values[0], possibleEnds: values[1].map(end => end + overtimeMinutes * MILLISECONDS_PER_MINUTE), overtimeMinutes }
    if (gap) return success({ status: 'invalid', ...pending, error: gap })
    if (issues.length) return success({ status: 'ambiguous', ...pending, issues, warnings: [{ code: 'TIME_AMBIGUOUS', message: '班次端点在当前时区重复，未自动选择偏移。', affects: ['activeShift', 'countdown', 'progress'], years: [] }] })
    const startsAt = values[0][0], normalEndsAt = values[1][0]
    const final = validateInstant(normalEndsAt + overtimeMinutes * MILLISECONDS_PER_MINUTE)
    if (!final.ok) return final
    if (normalEndsAt <= startsAt || normalEndsAt - startsAt > MILLISECONDS_PER_DAY) return invalid('$.schedule', '解析后的实际常规班次须为正时长且不超过24小时。')
    const breaks: TimeInterval[] = []
    for (let index = 2; index < values.length; index += 2) breaks.push({ startsAt: values[index][0], endsAt: values[index + 1][0] })
    breaks.sort((a, b) => a.startsAt - b.startsAt)
    if (breaks.some((interval, i) => interval.endsAt <= interval.startsAt || interval.startsAt < startsAt || interval.endsAt > normalEndsAt ||
      (i > 0 && interval.startsAt < breaks[i - 1].endsAt))) return invalid('$.breaks', '实际休息区间越界、无效或重叠。')
    const breakDuration = breaks.reduce((sum, interval) => sum + interval.endsAt - interval.startsAt, 0)
    if (normalEndsAt - startsAt - breakDuration <= 0) return invalid('$.breaks', '实际常规净工作时长必须大于0。')
    const effectiveIntervals: TimeInterval[] = []
    let cursor = startsAt
    for (const interval of breaks) { if (cursor < interval.startsAt) effectiveIntervals.push({ startsAt: cursor, endsAt: interval.startsAt }); cursor = interval.endsAt }
    if (cursor < final.data) effectiveIntervals.push({ startsAt: cursor, endsAt: final.data })
    const calendarDay: CalendarDay = { date: day.data.date, weekday: day.data.weekday, kind: day.data.kind,
      isWorkDay: day.data.isWorkDay, isRestDay: day.data.isRestDay,
      annual: { year: day.data.annual.year, available: day.data.annual.available, complete: day.data.annual.complete,
        verification: day.data.annual.verification, version: day.data.annual.version },
      quality: { ...day.data.quality, incompleteYears: [...day.data.quality.incompleteYears] },
      warnings: day.data.warnings.map(warning => ({ code: warning.code, year: warning.year, reason: warning.reason })) }
    const shift: ResolvedShift = { shiftDate: date.data, startDate: date.data, endDate: endDate.data, timeZoneId: context.timeZoneId,
      startsAt, normalEndsAt, finalEndsAt: final.data, breaks, overtimeMinutes, effectiveIntervals,
      totalWorkMilliseconds: final.data - startsAt - breakDuration, calendarDay, quality: { ...day.data.quality, incompleteYears: [...day.data.quality.incompleteYears] },
      warnings: ['activeShift', 'countdown', 'progress'].flatMap(affects => calendarWarnings(day.data.warnings, affects === 'activeShift' ? 'activeShift' : affects === 'countdown' ? 'countdown' : 'progress')) }
    freeze(shift); resolved.add(shift)
    return success({ status: 'ready', shift })
  }
  return success({ build, schedule: schedule.data, overtime: overtime.data })
}
export function resolveShift(schedule: unknown, overtime: unknown, shiftDate: LocalDate, context: ScheduleContext): Result<ShiftResolution> {
  try {
    const created = session(schedule, overtime, context)
    if (!created.ok) return created
    const built = created.data.build(shiftDate)
    if (!built.ok) return built
    if (built.data.status === 'invalid') return { ok: false, error: built.data.error }
    if (built.data.status === 'irrelevant') return { ok: false, error: { code: 'INTERNAL', message: '班次解析范围不匹配。' } }
    return success(built.data)
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法解析班次，未生成有效边界。' } } }
}
export function classifyShift(shift: ResolvedShift, instant: Instant, timeZoneId: string): Result<BusinessState> {
  if (!isResolvedShift(shift)) return invalid('$.shift', '班次未经过解析校验。', 'FORMAT')
  const now = validateInstant(instant)
  if (!now.ok) return now
  if (shift.timeZoneId !== timeZoneId) return invalid('$.timeZoneId', '时区已变化，必须重新解析班次。', 'FORMAT')
  if (now.data < shift.startsAt) return success('beforeWork')
  if (now.data >= shift.finalEndsAt) return success('finished')
  if (now.data >= shift.normalEndsAt) return success('overtime')
  if (shift.breaks.some(interval => now.data >= interval.startsAt && now.data < interval.endsAt)) return success('break')
  return success('working')
}
function mayAffect(pending: PendingShift, start: number, end: number): boolean {
  if (pending.possibleEnds.length && Math.max(...pending.possibleEnds) <= start) return false
  if (pending.possibleStarts.length && Math.min(...pending.possibleStarts) >= end) return false
  if (!pending.possibleEnds.length && pending.possibleStarts.length && Math.max(...pending.possibleStarts) + MAX_SHIFT_MILLISECONDS <= start) return false
  return true
}
export function calculateScheduleAt(schedule: unknown, overtime: unknown, instant: Instant, context: ScheduleContext): Result<ScheduleSelection> {
  try {
    const now = validateInstant(instant)
    if (!now.ok) return now
    const local = context.zones.project(now.data, context.timeZoneId)
    if (!local.ok) return local
    const created = session(schedule, overtime, context)
    if (!created.ok) return created
    const dates = datesAround(local.data.date)
    if (!dates.ok) return dates
    const ready: ResolvedShift[] = [], pending: PendingShift[] = []
    let today: BuiltShift | undefined
    for (const date of dates.data) {
      const built = created.data.build(date, { start: now.data, end: now.data + 1, keepDate: local.data.date })
      if (!built.ok) return built
      if (date === local.data.date) today = built.data
      if (built.data.status === 'ready') ready.push(built.data.shift)
      else if (built.data.status === 'ambiguous' || built.data.status === 'invalid') pending.push(built.data)
    }
    const active = ready.filter(shift => shift.startsAt <= now.data && now.data < shift.finalEndsAt)
    if (active.length > 1) return invalid('$.shiftDate', '同时存在重叠活动班次，不能选择归属。', 'DUPLICATE')
    const unresolved = pending.find(item => item.shiftDate === local.data.date || mayAffect(item, now.data, now.data + 1))
    if (unresolved?.status === 'invalid') return { ok: false, error: unresolved.error }
    if (unresolved?.status === 'ambiguous') return success({ state: 'incomplete', instant: now.data, localDate: local.data.date, timeZoneId: context.timeZoneId,
      shift: null, countdown: null, timeQuality: exactDateQuality(), warnings: unresolved.warnings, ambiguities: unresolved.issues, checkedShiftDates: dates.data })
    const selected = active[0] ?? (today?.status === 'ready' ? today.shift : null)
    if (!selected) return success({ state: 'rest', instant: now.data, localDate: local.data.date, timeZoneId: context.timeZoneId, shift: null, countdown: null,
      timeQuality: exactDateQuality(), warnings: today?.status === 'noShift' ? ['activeShift', 'countdown', 'progress'].flatMap(affects => calendarWarnings(today.day.warnings, affects === 'activeShift' ? 'activeShift' : affects === 'countdown' ? 'countdown' : 'progress')) : [], ambiguities: [], checkedShiftDates: dates.data })
    const state = classifyShift(selected, now.data, context.timeZoneId)
    if (!state.ok) return state
    const targetAt = state.data === 'beforeWork' ? selected.startsAt : selected.finalEndsAt
    return success({ state: state.data, instant: now.data, localDate: local.data.date, timeZoneId: context.timeZoneId, shift: selected,
      countdown: { target: state.data === 'beforeWork' ? 'workStart' : 'finalWorkEnd', targetAt, seconds: Math.ceil(Math.max(0, targetAt - now.data) / 1000), quality: selected.quality },
      timeQuality: exactDateQuality(), warnings: selected.warnings, ambiguities: [], checkedShiftDates: dates.data })
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法计算班次状态，未返回伪造倒计时。' } } }
}
export function calculateScheduleWithClock(schedule: unknown, overtime: unknown, clock: Clock, calendar: Calendar, zones: TimeZoneAdapter): Result<ScheduleSelection> {
  try {
    const now = clock.read()
    return now.ok ? calculateScheduleAt(schedule, overtime, now.data.instant, { calendar, zones, timeZoneId: now.data.timeZoneId }) : now
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取注入时钟。' } } }
}
type ScheduleSession = Extract<ReturnType<typeof session>, { ok: true }>['data']
function checkConflicts(created: ScheduleSession, shiftDate: LocalDate): Result<ResolvedShift> {
    const target = created.build(shiftDate)
    if (!target.ok) return target
    if (target.data.status === 'noShift') return invalid('$.shiftDate', '休息日无有效排班，不能创建常规加班班次。')
    if (target.data.status === 'invalid') return { ok: false, error: target.data.error }
    if (target.data.status === 'ambiguous') return invalid('$.shiftDate', '班次存在DST歧义，候选修改未获应用。', 'FORMAT')
    if (target.data.status === 'irrelevant') return invalid('$.shiftDate', '班次解析范围不匹配。')
    const around = datesAround(shiftDate)
    if (!around.ok) return around
    for (const date of around.data) {
      if (date === shiftDate) continue
      const neighbour = created.build(date, { start: target.data.shift.startsAt, end: target.data.shift.finalEndsAt })
      if (!neighbour.ok) return neighbour
      if (neighbour.data.status === 'ready') {
        if (target.data.shift.startsAt < neighbour.data.shift.finalEndsAt && neighbour.data.shift.startsAt < target.data.shift.finalEndsAt) return invalid('$.shiftDate', `候选班次与${date}班次重叠，原数据保留。`, 'DUPLICATE')
      } else if ((neighbour.data.status === 'ambiguous' || neighbour.data.status === 'invalid') && mayAffect(neighbour.data, target.data.shift.startsAt, target.data.shift.finalEndsAt)) {
        return neighbour.data.status === 'invalid' ? { ok: false, error: neighbour.data.error } : invalid('$.shiftDate', '邻班边界存在DST歧义，无法确认无冲突。', 'FORMAT')
      }
    }
    return success(target.data.shift)
}
export function validateShiftConflicts(schedule: unknown, overtime: unknown, shiftDate: LocalDate, context: ScheduleContext): Result<ResolvedShift> {
  try {
    const created = session(schedule, overtime, context)
    return created.ok ? checkConflicts(created.data, shiftDate) : created
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法校验班次冲突，原数据未修改。' } } }
}
export function updateOvertime(schedule: unknown, overtime: unknown, shiftDate: LocalDate, minutes: number, context: ScheduleContext): Result<OvertimeConfig> {
  return setOvertimeForShift(overtime, shiftDate, minutes, candidate => validateShiftConflicts(schedule, candidate, shiftDate, context))
}
export function validateScheduleForDates(schedule: unknown, overtime: unknown, dates: readonly LocalDate[], context: ScheduleContext): Result<{ schedule: ScheduleConfig; overtime: OvertimeConfig; checkedShiftDates: LocalDate[] }> {
  const checked = validateStructure(dates, v.array(dateFormat, 1, 10_000, date => date))
  if (!checked.ok) return checked
  const config = validateSchedule(schedule), entries = validateOvertime(overtime)
  if (!config.ok) return config
  if (!entries.ok) return entries
  const created = session(config.data, entries.data, context)
  if (!created.ok) return created
  for (const date of checked.data) {
    const parsed = normalizeLocalDate(date)
    if (!parsed.ok) return parsed
    let day: Result<CalendarDay>
    try { day = context.calendar.getDay(date) } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取候选排班日历。' } } }
    if (!day.ok) return day
    if (!day.data.isWorkDay) continue // Inactive stored history does not create a rest-day shift.
    let validated: Result<ResolvedShift>
    try { validated = checkConflicts(created.data, date) } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法校验候选排班，原数据未修改。' } } }
    if (!validated.ok) return validated
  }
  return success({ schedule: config.data, overtime: entries.data, checkedShiftDates: checked.data })
}
