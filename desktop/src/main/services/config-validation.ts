import type { AppConfig, EditableConfig, Result, ValidationIssue } from '../../shared/contracts'
import { editableConfigValidator, validateAppConfig } from '../../shared/config-schema'
import { issue, success, validateStructure, validationFailure } from '../../shared/validation'
import { createSettingsDraft, prepareDraftSave } from '../../shared/settings-draft'
import { createCalendar, validateDateOverrides } from '../../domain/calendar'
import { MAX_DAY_ORDINAL, fromDayOrdinal, normalizeLocalDate, toDayOrdinal } from '../../domain/local-date'
import { nominalSalaryDate } from '../../domain/salary'
import { validateOvertime } from '../../domain/overtime'
import { calculateScheduleAt, resolveShift, validateSchedule, validateScheduleForDates, validateShiftConflicts } from '../../domain/schedule'
import type { Clock } from '../../domain/clock'
import type { TimeZoneAdapter } from '../../domain/time-zone'
import type { CalendarStore } from './calendar-store'
import type { CalendarYear } from '../../domain/annual-calendar'

export interface ConfigValidationContext {
  clock: Clock
  zones: TimeZoneAdapter
  calendars: CalendarStore
  maxValidationDates: number // Host's explicit resource budget, not a user date limit.
}
export interface ConfigValidation {
  settings: EditableConfig
  checkedShiftDates: string[]
  warnings: ValidationIssue[]
  checkedClock: { instant: number; localDate: string; timeZoneId: string }
}
export function editableConfig(config: AppConfig): Result<EditableConfig> {
  const draft = createSettingsDraft(config)
  if (!draft.ok) return draft
  const request = prepareDraftSave(draft.data, config.revision)
  return request.ok ? success(request.data.settings) : request
}
export function datasetMetadata(settings: EditableConfig, context: ConfigValidationContext): AppConfig['calendar']['datasets'] {
  return context.calendars.listMetadata().filter(item => settings.calendar.enabledYears.includes(item.year))
}
// No time-zone policy is inferred. Ambiguous or missing relevant endpoints fail
// the save; the finite inspection scope is returned and never means all future.
function* validationSteps(input: unknown, previous: AppConfig | null, context: ConfigValidationContext,
  allowImportedHistory = false): Generator<void,Result<ConfigValidation>> {
  try {
    const parsed = validateStructure(input, editableConfigValidator)
    if (!parsed.ok) return parsed
    const settings = parsed.data
    if (settings.employee.startDate !== null) {
      const date = normalizeLocalDate(settings.employee.startDate)
      if (!date.ok) return date
    }
    const schedule = validateSchedule(settings.schedule), overtime = validateOvertime(settings.overtime)
    const overrides = validateDateOverrides(settings.calendar.overrides)
    if (!schedule.ok) return schedule
    if (!overtime.ok) return overtime
    if (!overrides.ok) return overrides
    const now = context.clock.read()
    if (!now.ok) return now
    const today = toDayOrdinal(now.data.date)
    if (!today.ok) return today
    const salary = nominalSalaryDate(Number(now.data.date.slice(0, 4)), Number(now.data.date.slice(5, 7)), settings.salary.day)
    if (!salary.ok) return salary
    const years: CalendarYear[] = []
    for (const year of settings.calendar.enabledYears) {
      const loaded = context.calendars.readYear(year)
      if (!loaded.ok) return loaded
      if (loaded.data) years.push(loaded.data) // Missing years stay approximate, never self-verified.
    }
    const calendar = createCalendar({ workWeek: settings.schedule.workWeek, overrides: overrides.data }, years)
    if (!calendar.ok) return calendar
    const shiftContext = { calendar: calendar.data, zones: context.zones, timeZoneId: now.data.timeZoneId }
    const active = calculateScheduleAt(settings.schedule, settings.overtime, now.data.instant, shiftContext)
    if (!active.ok) return active
    if (active.data.state === 'incomplete') return validationFailure([issue('$.schedule', 'FORMAT', '当前可能活动班次存在DST歧义，候选配置未保存。')])
    const scope = new Set<number>()
    const addAround = (ordinal: number) => {
      // Expired history must not be reinterpreted as currently active. D06's
      // instant-aware selection above checks all possible prior active dates.
      for (let date = Math.max(today.data, ordinal - 4); date <= Math.min(MAX_DAY_ORDINAL, ordinal + 4); date++) scope.add(date)
    }
    addAround(today.data)
    if (active.data.shift && active.data.shift.startsAt <= now.data.instant && active.data.shift.finalEndsAt > now.data.instant) {
      const ordinal = toDayOrdinal(active.data.shift.shiftDate)
      if (!ordinal.ok) return ordinal
      scope.add(ordinal.data)
    }
    const globalChange = !previous || JSON.stringify(previous.schedule) !== JSON.stringify(settings.schedule) ||
      JSON.stringify({ region: previous.calendar.region, enabledYears: previous.calendar.enabledYears }) !== JSON.stringify({ region: settings.calendar.region, enabledYears: settings.calendar.enabledYears })
    if (globalChange) {
      // Inspect a complete next-year cycle, plus every explicit future exception.
      // This budget is a validation horizon, not a promise about unknown future DST.
      for (let date = today.data; date <= Math.min(MAX_DAY_ORDINAL, today.data + 366); date++) scope.add(date)
    }
    const previousOvertime = new Map(previous?.overtime.entries.map(item => [item.shiftDate, item.minutes]) ?? [])
    for (const entry of settings.overtime.entries) {
      const ordinal = toDayOrdinal(entry.shiftDate)
      if (!ordinal.ok) return ordinal
      const changed = previousOvertime.get(entry.shiftDate) !== entry.minutes
      if (ordinal.data >= today.data) addAround(ordinal.data)
      if (changed && !allowImportedHistory && ordinal.data < today.data) scope.add(ordinal.data)
    }
    const overrideDates = new Set([...Object.keys(settings.calendar.overrides), ...Object.keys(previous?.calendar.overrides ?? {})])
    for (const date of overrideDates) {
      const ordinal = toDayOrdinal(date)
      if (!ordinal.ok) return ordinal
      if (ordinal.data >= today.data && (globalChange || settings.calendar.overrides[date] !== previous?.calendar.overrides[date])) addAround(ordinal.data)
    }
    if (!Number.isSafeInteger(context.maxValidationDates) || context.maxValidationDates < 1 || context.maxValidationDates > 10_000 || scope.size > context.maxValidationDates) {
      return validationFailure([issue('$.schedule', 'LIMIT', '受影响日期超过主进程校验预算；原配置保留，不能省略冲突校验。')])
    }
    const dates: string[] = []
    for (const ordinal of [...scope].sort((a, b) => a - b)) {
      const date = fromDayOrdinal(ordinal)
      if (!date.ok) return date
      dates.push(date.data)
    }
    for (const entry of settings.overtime.entries) {
      if (previousOvertime.get(entry.shiftDate) === entry.minutes) continue
      const ordinal = toDayOrdinal(entry.shiftDate)
      if (!ordinal.ok) return ordinal
      if (allowImportedHistory && ordinal.data < today.data) {
        if (ordinal.data < today.data - 4) continue
        const shift = resolveShift(settings.schedule, settings.overtime, entry.shiftDate, shiftContext)
        if (shift.ok && (shift.data.status === 'noShift' || (shift.data.status === 'ready' && shift.data.shift.finalEndsAt <= now.data.instant))) continue
      }
      const valid = validateShiftConflicts(settings.schedule, settings.overtime, entry.shiftDate, shiftContext)
      if (!valid.ok) return valid
    }
    for(let index=0;index<dates.length;index+=8){
      yield // Async storage caller lets Main process IPC/window events here.
      const checked=validateScheduleForDates(settings.schedule,settings.overtime,dates.slice(index,index+8),shiftContext)
      if(!checked.ok)return checked
    }
    const warnings: ValidationIssue[] = []
    if (globalChange) warnings.push(issue('$.schedule', 'LIMIT', `已检查当前邻班、未来366天及明确未来记录/覆盖；未证明无限未来（时区${now.data.timeZoneId}）。运行接入必须在新日期/时区重新校验，失败停止生成班次。`))
    const missing = settings.calendar.enabledYears.filter(year => !years.some(item => item.data.year === year))
    if (missing.length) warnings.push(issue('$.calendar.enabledYears', 'FORMAT', `缺少年度包：${missing.join('、')}；相关计算按周规则估算。`))
    return success({ settings, checkedShiftDates: dates, warnings, checkedClock: { instant: now.data.instant, localDate: now.data.date, timeZoneId: now.data.timeZoneId } })
  } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法完成配置语义校验，原配置保留。' } } }
}
export function validateConfigSettings(input:unknown,previous:AppConfig|null,context:ConfigValidationContext,allowImportedHistory=false):Result<ConfigValidation>{
  const steps=validationSteps(input,previous,context,allowImportedHistory)
  let step=steps.next();while(!step.done)step=steps.next();return step.value
}
export async function validateConfigSettingsAsync(input:unknown,previous:AppConfig|null,context:ConfigValidationContext,allowImportedHistory=false):Promise<Result<ConfigValidation>>{
  const steps=validationSteps(input,previous,context,allowImportedHistory)
  let step=steps.next()
  while(!step.done){await new Promise<void>(resolve=>setImmediate(resolve));step=steps.next()}
  return step.value
}
// Candidate metadata still receives full structural/trusted-source checks.
// Only freshly semantically validated candidates may omit a redundant pass.
export function validateConfigEnvelope(input: unknown, context: ConfigValidationContext): Result<AppConfig> {
  const parsed = validateAppConfig(input)
  if (!parsed.ok) return parsed
  const config = parsed.data
  for (const timestamp of [config.updatedAt, ...config.migration.completed.map(item => item.migratedAt)]) {
    const valid = normalizeLocalDate(timestamp.slice(0, 10))
    if (!valid.ok) return valid
  }
  const editable = editableConfig(config)
  if (!editable.ok) return editable
  const approved = datasetMetadata(editable.data, context)
  if (JSON.stringify(config.calendar.datasets) !== JSON.stringify(approved)) {
    return { ok: false, error: { code: 'FORBIDDEN', message: '年度元数据不匹配主进程可信资源，不能采信用户核验声明。' } }
  }
  return success(config)
}
export function validateStoredConfig(input: unknown, context: ConfigValidationContext): Result<AppConfig> {
  const record=validateConfigEnvelope(input,context)
  if(!record.ok)return record
  const config=record.data,editable=editableConfig(config)
  if(!editable.ok)return editable
  // Untrusted disk loads always retain their semantic checks.
  const semantic = validateConfigSettings(editable.data, config, context, true)
  return semantic.ok ? success(config) : semantic
}
