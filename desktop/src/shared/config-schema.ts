import { CONFIG_SCHEMA_VERSION } from './contracts'
import type { AppConfig, CalendarDatasetMetadata, CalendarPreferences, EditableConfig, InitialConfigInput, JsonValue, Result, ValidationIssue, EditableGroup } from './contracts'
import { issue, success, v, validateJsonDto, validateStructure, validationFailure } from './validation'
import { LOCAL_DATE_PATTERN, LOCAL_TIME_PATTERN } from './formats'

// Basic notation/range only. For example, 2026-02-31 passes D02; D03 must reject it.
export const dateFormat = v.string(LOCAL_DATE_PATTERN, 10)
export const timeFormat = v.string(LOCAL_TIME_PATTERN, 5)
export const timestampFormat = v.string(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/, 24)
export const revisionFormat = v.number(0, Number.MAX_SAFE_INTEGER)
export const sha256Format = v.string(/^[a-f0-9]{64}$/, 64)
const year = v.number(1, 9999)
const appVersion = v.string(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/, 128)
export const calendarMetadataValidator = v.object<CalendarDatasetMetadata>({
  year, version: v.string(undefined, 128), source: v.string(), publishedOn: dateFormat,
  sha256: sha256Format, verification: v.enum(['unverified', 'verified'] as const)
})
const bounds = v.object<NonNullable<AppConfig['desktop']['bounds']['main']>>({
  x: v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false),
  y: v.number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false),
  width: v.number(1, Number.MAX_SAFE_INTEGER, false), height: v.number(1, Number.MAX_SAFE_INTEGER, false)
})
const calendarPreferencesValidator = v.object<CalendarPreferences>({
  region: v.enum(['CN'] as const), enabledYears: v.array(year, 0, 9999, value => value),
  overrides: v.record(dateFormat, v.enum(['work', 'rest'] as const))
})
export const editableValidators = {
  employee: v.object<AppConfig['employee']>({ startDate: v.nullable(dateFormat) }),
  schedule: v.object<AppConfig['schedule']>({
    workWeek: v.array(v.enum([1, 2, 3, 4, 5, 6, 7] as const), 1, 7, day => day),
    startTime: timeFormat, endTime: timeFormat, crossMidnight: v.boolean,
    breaks: v.array(v.object<AppConfig['schedule']['breaks'][number]>({
      startTime: timeFormat, endTime: timeFormat,
      startDayOffset: v.enum([0, 1] as const), endDayOffset: v.enum([0, 1] as const)
    }))
  }),
  salary: v.object<AppConfig['salary']>({
    day: v.number(1, 31), nonWorkingPolicy: v.enum(['delay', 'advance', 'none'] as const),
    missingDayPolicy: v.enum(['monthEnd'] as const), showPaydayAsToday: v.enum([true] as const)
  }),
  overtime: v.object<AppConfig['overtime']>({
    // Zero remains a valid stored setting. No filtering/purging of history here.
    entries: v.array(v.object<AppConfig['overtime']['entries'][number]>({
      shiftDate: dateFormat, minutes: v.number(0, 600)
    }), 0, 100_000, entry => entry.shiftDate)
  }),
  calendar: v.object<AppConfig['calendar']>({
    region: v.enum(['CN'] as const), enabledYears: v.array(year, 0, 9999, value => value),
    datasets: v.array(calendarMetadataValidator, 0, 9999, item => item.year),
    overrides: v.record(dateFormat, v.enum(['work', 'rest'] as const))
  }),
  appearance: v.object<AppConfig['appearance']>({
    mode: v.enum(['system', 'light', 'dark'] as const), accent: v.enum(['ocean', 'coral'] as const), reduceMotion: v.boolean
  }),
  desktop: v.object<AppConfig['desktop']>({
    closeAction: v.enum(['hideToTray', 'quit'] as const), miniEnabled: v.boolean, alwaysOnTop: v.boolean,
    displayMode: v.enum(['exclusive'] as const),
    bounds: v.object<AppConfig['desktop']['bounds']>({ main: v.nullable(bounds), mini: v.nullable(bounds) }),
    tray: v.object<AppConfig['desktop']['tray']>({ firstHideNoticeAcknowledged: v.boolean })
  })
}
export const editableConfigValidator = v.object<EditableConfig>({
  employee: editableValidators.employee, schedule: editableValidators.schedule,
  salary: editableValidators.salary, overtime: editableValidators.overtime, calendar: calendarPreferencesValidator,
  appearance: editableValidators.appearance, desktop: editableValidators.desktop
})
export const appConfigValidator = v.object<AppConfig>({
  schemaVersion: v.enum([CONFIG_SCHEMA_VERSION] as const), revision: revisionFormat,
  updatedAt: timestampFormat, appVersion,
  employee: editableValidators.employee, schedule: editableValidators.schedule,
  salary: editableValidators.salary, overtime: editableValidators.overtime,
  calendar: editableValidators.calendar, appearance: editableValidators.appearance, desktop: editableValidators.desktop,
  migration: v.object<AppConfig['migration']>({
    completed: v.array(v.object<AppConfig['migration']['completed'][number]>({
      sourceKind: v.enum(['python-v1', 'electron-poc', 'v2'] as const), sourceHash: sha256Format, migratedAt: timestampFormat
    }), 0, 100_000, item => `${item.sourceKind}:${item.sourceHash}`)
  })
})

export function validateAppConfig(input: unknown): Result<AppConfig> {
  const json = validateJsonDto(input)
  if (!json.ok) return json
  if (json.data !== null && typeof json.data === 'object' && !Array.isArray(json.data)) {
    const received = json.data.schemaVersion
    if (typeof received === 'number' && Number.isSafeInteger(received) && received >= 0 && received !== CONFIG_SCHEMA_VERSION) {
      return { ok: false, error: {
        code: 'UNSUPPORTED_SCHEMA', message: '配置版本不受支持，不可覆盖或自动降级。',
        received, supported: CONFIG_SCHEMA_VERSION, direction: received > CONFIG_SCHEMA_VERSION ? 'future' : 'legacy'
      } }
    }
  }
  const issues: ValidationIssue[] = []
  const parsed = appConfigValidator(json.data, '$', issues)
  return parsed === undefined || issues.length ? validationFailure(issues) : success(parsed)
}

// Allow raw editing values but not additional fields, paths, unsafe keys or metadata.
// Invalid types/enums stay in the draft and are reported by validateAppConfig.
const draftShape: Record<EditableGroup, unknown> = {
  employee: { startDate: null },
  schedule: { workWeek: [], startTime: null, endTime: null, crossMidnight: null,
    breaks: [{ startTime: null, endTime: null, startDayOffset: null, endDayOffset: null }] },
  salary: { day: null, nonWorkingPolicy: null, missingDayPolicy: null, showPaydayAsToday: null },
  overtime: { entries: [{ shiftDate: null, minutes: null }] },
  calendar: { region: null, enabledYears: [], overrides: 'record' },
  appearance: { mode: null, accent: null, reduceMotion: null },
  desktop: { closeAction: null, miniEnabled: null, alwaysOnTop: null, displayMode: null,
    bounds: { main: { x: null, y: null, width: null, height: null }, mini: { x: null, y: null, width: null, height: null } },
    tray: { firstHideNoticeAcknowledged: null } }
}
export function validateDraftFields(input: unknown): Result<Record<string, JsonValue>> {
  const json = validateJsonDto(input)
  if (!json.ok) return json
  if (json.data === null || typeof json.data !== 'object' || Array.isArray(json.data)) return validationFailure([issue('$', 'TYPE', '草稿必须为对象。')])
  const issues: ValidationIssue[] = []
  function check(value: JsonValue, shape: unknown, field: string): void {
    if (shape === null || shape === 'record') return
    if (Array.isArray(shape)) { if (Array.isArray(value) && shape.length) value.forEach((item, i) => check(item, shape[0], `${field}[${i}]`)); return }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const keys = shape as Record<string, unknown>
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(keys, key)) issues.push(issue(`${field}.${key}`, 'UNKNOWN_FIELD', '草稿含不允许的字段。'))
      else check(value[key], keys[key], `${field}.${key}`)
    }
  }
  check(json.data, draftShape, '$')
  return issues.length ? validationFailure(issues) : success(json.data)
}

const initialValidator = v.object<InitialConfigInput>({
  updatedAt: timestampFormat, appVersion, startDate: v.nullable(dateFormat), startTime: timeFormat, endTime: timeFormat,
  salaryDay: v.number(1, 31), themeMode: v.enum(['system', 'light', 'dark'] as const), themeAccent: v.enum(['ocean', 'coral'] as const)
})
// User-approved D11 UX defaults (2026-10-15). Existing files are never merged
// with this template; only Main's confirmed missing+no-backup startup uses it.
export function createDefaultAppConfig(metadata:Pick<InitialConfigInput,'updatedAt'|'appVersion'>,datasets:AppConfig['calendar']['datasets']):Result<AppConfig>{
  const created=createAppConfig({startDate:'2025-07-17',startTime:'08:30',endTime:'18:00',salaryDay:10,themeMode:'system',themeAccent:'ocean',...metadata})
  if(!created.ok)return created
  created.data.calendar.enabledYears=[2024,2025,2026]
  created.data.calendar.datasets=datasets.filter(item=>created.data.calendar.enabledYears.includes(item.year))
  return validateAppConfig(created.data)
}
export function createAppConfig(input: InitialConfigInput): Result<AppConfig> {
  const checked = validateStructure(input, initialValidator)
  if (!checked.ok) return checked
  const value = checked.data
  return validateAppConfig({
    schemaVersion: CONFIG_SCHEMA_VERSION, revision: 0, updatedAt: value.updatedAt, appVersion: value.appVersion,
    employee: { startDate: value.startDate },
    schedule: { workWeek: [1, 2, 3, 4, 5], startTime: value.startTime, endTime: value.endTime, crossMidnight: false, breaks: [] },
    salary: { day: value.salaryDay, nonWorkingPolicy: 'delay', missingDayPolicy: 'monthEnd', showPaydayAsToday: true },
    overtime: { entries: [] }, calendar: { region: 'CN', enabledYears: [], datasets: [], overrides: {} },
    appearance: { mode: value.themeMode, accent: value.themeAccent, reduceMotion: false },
    desktop: { closeAction: 'hideToTray', miniEnabled: false, alwaysOnTop: false, displayMode: 'exclusive',
      bounds: { main: null, mini: null }, tray: { firstHideNoticeAcknowledged: false } },
    migration: { completed: [] }
  })
}
