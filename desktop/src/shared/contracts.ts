// D02 DTOs only. Calendar validity and business calculations belong to D03–D06.
export const CONFIG_SCHEMA_VERSION = 2 as const
export const CONTRACT_VERSION = 1 as const
export type LocalDate = string // YYYY-MM-DD; not yet calendar-validated
export type LocalTime = string // HH:MM
export type IsoTimestamp = string // UTC YYYY-MM-DDTHH:MM:SS.sssZ
export type WorkWeekDay = 1 | 2 | 3 | 4 | 5 | 6 | 7 // Monday = 1
export type WindowRole = 'main' | 'mini'
export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemeAccent = 'ocean' | 'coral'
export type SalaryPolicy = 'delay' | 'advance' | 'none'
export type MigrationSource = 'python-v1' | 'electron-poc' | 'v2'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export const ERROR_CODES = [
  'VALIDATION', 'UNSUPPORTED_SCHEMA', 'REVISION_CONFLICT', 'FORBIDDEN',
  'IO_BUSY', 'IO_DENIED', 'CALENDAR_INCOMPLETE', 'CANCELLED', 'UNAVAILABLE', 'INTERNAL'
] as const
export type ErrorCode = typeof ERROR_CODES[number]
export type IssueReason = 'MISSING_FIELD' | 'UNKNOWN_FIELD' | 'TYPE' | 'RANGE' |
  'ENUM' | 'FORMAT' | 'DUPLICATE' | 'DANGEROUS_KEY' | 'NOT_SERIALIZABLE' | 'LIMIT'
export interface ValidationIssue { field: string; reason: IssueReason; message: string }
export type ContractError =
  | { code: 'VALIDATION'; message: string; issues: ValidationIssue[] }
  | { code: 'UNSUPPORTED_SCHEMA'; message: string; received: number; supported: typeof CONFIG_SCHEMA_VERSION; direction: 'legacy' | 'future' }
  | { code: 'REVISION_CONFLICT'; message: string; expectedRevision: number; actualRevision: number }
  | { code: Exclude<ErrorCode, 'VALIDATION' | 'UNSUPPORTED_SCHEMA' | 'REVISION_CONFLICT'>; message: string }
export type Result<T> = { ok: true; data: T } | { ok: false; error: ContractError }

export interface BreakInterval {
  startTime: LocalTime
  endTime: LocalTime
  startDayOffset: 0 | 1
  endDayOffset: 0 | 1
}
export interface ScheduleConfig {
  workWeek: WorkWeekDay[]
  startTime: LocalTime
  endTime: LocalTime
  crossMidnight: boolean
  breaks: BreakInterval[] // Empty means lunch is disabled. No overlap calculation in D02.
}
export interface CalendarDatasetMetadata {
  year: number
  version: string
  source: string // Citation text, not an executable URL or file path capability.
  publishedOn: LocalDate
  sha256: string
  verification: 'unverified' | 'verified' // Metadata is not proof of verification.
}
export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface CalendarPreferences { region: 'CN'; enabledYears: number[]; overrides: Record<LocalDate, 'work' | 'rest'> }
export interface AppConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION
  revision: number
  updatedAt: IsoTimestamp
  appVersion: string
  employee: { startDate: LocalDate | null }
  schedule: ScheduleConfig
  salary: { day: number; nonWorkingPolicy: SalaryPolicy; missingDayPolicy: 'monthEnd'; showPaydayAsToday: true }
  overtime: { entries: Array<{ shiftDate: LocalDate; minutes: number }> }
  calendar: CalendarPreferences & { datasets: CalendarDatasetMetadata[] }
  appearance: { mode: ThemeMode; accent: ThemeAccent; reduceMotion: boolean }
  desktop: {
    closeAction: 'hideToTray' | 'quit'
    miniEnabled: boolean
    alwaysOnTop: boolean
    displayMode: 'exclusive'
    bounds: { main: WindowBounds | null; mini: WindowBounds | null }
    tray: { firstHideNoticeAcknowledged: boolean }
  }
  migration: { completed: Array<{ sourceKind: MigrationSource; sourceHash: string; migratedAt: IsoTimestamp }> }
}

// User-specific/unspecified inputs are required; no POC times or salary day defaults.
export interface InitialConfigInput {
  updatedAt: IsoTimestamp
  appVersion: string
  startDate: LocalDate | null
  startTime: LocalTime
  endTime: LocalTime
  salaryDay: number
  themeMode: ThemeMode
  themeAccent: ThemeAccent
}

export type BusinessState = 'rest' | 'beforeWork' | 'working' | 'break' | 'overtime' | 'finished' | 'incomplete'
export interface DataQuality {
  approximate: boolean
  incompleteYears: number[]
  source: 'userOverride' | 'annual' | 'weekRule' | 'currentSchedule' | 'clock'
  annualVerification: 'verified' | 'unverified' | 'missing' | 'notApplicable'
}
export interface SnapshotWarning {
  code: 'CALENDAR_INCOMPLETE' | 'CURRENT_RULE_ESTIMATE' | 'CONFIG_INCOMPLETE' | 'TIME_AMBIGUOUS'
  message: string
  affects: Array<'employment' | 'nextRest' | 'salary' | 'activeShift' | 'countdown' | 'progress'>
  years: number[]
}
export interface ShiftSnapshot {
  shiftDate: LocalDate
  startsAt: number
  normalEndsAt: number
  finalEndsAt: number
  breaks: Array<{ startsAt: number; endsAt: number }>
  overtimeMinutes: number
  quality: DataQuality
}
export interface DashboardSnapshot {
  sequence: number
  computedAt: number // epoch milliseconds, not Date/Electron objects
  localDate: LocalDate
  timeZoneId: string
  configRevision: number
  calendarRevision: number
  state: BusinessState
  activeShift: ShiftSnapshot | null
  employment: {
    status: 'unset' | 'notStarted' | 'employed'
    elapsedNaturalDays: number | null
    plannedWorkDays: number | null
    excludesToday: true
    isActualAttendance: false
    quality: DataQuality
    naturalQuality?: DataQuality // D09: exact Civil difference, independent of calendar estimates.
  }
  nextRest: { date: LocalDate; days: number; quality: DataQuality } | null
  salary: { nominalDate: LocalDate; actualDate: LocalDate; days: number; policy: SalaryPolicy; isPlanned: true; quality: DataQuality } | null
  countdown: { target: 'workStart' | 'finalWorkEnd'; targetAt: number; seconds: number; quality: DataQuality } | null
  progress: { percent: number; elapsedWorkSeconds: number; totalWorkSeconds: number; quality: DataQuality } | null
  warnings: SnapshotWarning[]
  salaryAmbiguity?: JsonObject // D09: lossless original ambiguous D05 DTO; salary stays null.
}

export interface ConfigSnapshot { config: AppConfig; warnings: ValidationIssue[] }
export type EditableConfig = Pick<AppConfig, 'employee' | 'schedule' | 'salary' | 'overtime' | 'appearance' | 'desktop'> & { calendar: CalendarPreferences }
export const EDITABLE_GROUPS = ['employee', 'schedule', 'salary', 'overtime', 'calendar', 'appearance', 'desktop'] as const
export type EditableGroup = typeof EDITABLE_GROUPS[number]
export const IMPORT_FIELDS = [
  'employee.startDate', 'schedule.workWeek', 'schedule.startTime', 'schedule.endTime', 'schedule.crossMidnight', 'schedule.breaks',
  'salary.day', 'salary.nonWorkingPolicy', 'salary.missingDayPolicy', 'salary.showPaydayAsToday', 'overtime.entries',
  'calendar.region', 'calendar.enabledYears', 'calendar.overrides', 'appearance.mode', 'appearance.accent', 'appearance.reduceMotion',
  'desktop.closeAction', 'desktop.miniEnabled', 'desktop.alwaysOnTop', 'desktop.displayMode', 'desktop.bounds', 'desktop.tray.firstHideNoticeAcknowledged'
] as const
export type ImportField = typeof IMPORT_FIELDS[number]
export type DraftSaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; revision: number }
  | { status: 'failed'; error: ContractError }
export interface DraftState {
  saved: AppConfig
  draft: JsonObject // Editable groups only; may contain invalid user-entered values.
  dirty: boolean
  issues: ValidationIssue[]
  expectedRevision: number
  save: DraftSaveState
}
// No invented saved defaults before the user's first explicit save.
export interface UninitializedDraftState {
  saved: null; draft: JsonObject; dirty: boolean; issues: ValidationIssue[]; expectedRevision: 0; save: DraftSaveState
}
export type SettingsDraftSession = (DraftState | UninitializedDraftState) & {
  configurationStatus?: 'unloaded' | 'missing' | 'ready' | 'recoverable' | 'invalid' | 'future'
  defaultPersistence?: {status:'pending'} | {status:'failed';error:ContractError}
  expectedEnd?: ExpectedEndContext
  expectedEndEdit?: {targetKey:string;input:string|null} // Session only; never persisted.
}
export type ExpectedEndContext = {available:false;message:string} | {
  available:true;targetKey:string;shiftDate:LocalDate;normalEnd:{date:LocalDate;time:LocalTime};finalEnd:{date:LocalDate;time:LocalTime};minutes:number
  previewEnd?:{date:LocalDate;time:LocalTime} // Main's valid unsaved projection.
}

export type WindowCommand = { action: 'showMain' } | { action: 'showMini' } | { action: 'hideMini' } | { action: 'setMiniTop'; enabled: boolean }
export type MiniWindowCommand = Exclude<WindowCommand, { action: 'showMini' }>
// Presentation only; own registered window, no native handles or window IDs.
export interface WindowVisibility { visible: boolean; sequence: number }
// Read-only display preferences, never the full editable configuration.
export interface WindowPresentation { appearance: AppConfig['appearance']; miniEnabled:boolean; alwaysOnTop:boolean; sequence:number }
export interface ImportPreview {
  previewToken: string
  sourceKind: MigrationSource
  sourceHash: string
  expectedRevision: number
  choices: Array<{ field: ImportField; current: JsonValue; incoming: JsonValue; issues: ValidationIssue[] }>
  undatedOvertimeMinutes: number | null
  alreadyProcessed?: boolean // Additive D07 DTO; reapply needs another explicit confirmation.
  notes?: ValidationIssue[]
  expiresAt?: IsoTimestamp
}
export interface CalendarImportPreview {
  previewToken: string
  expectedCalendarRevision: number
  metadata: CalendarDatasetMetadata
  restDateCount: number
  makeupDateCount: number
  issues: ValidationIssue[]
}

// Logical method identifiers, not public raw Electron channel names.
export interface ContractRequests {
  'config.read': null
  'config.save': { settings: EditableConfig; expectedRevision: number }
  'settingsDraft.read': null
  'settingsDraft.update': { draft: JsonObject; expectedRevision: number }
  'settingsDraft.discard': null
  'settingsDraft.setExpectedEnd': {expectedRevision:number;targetKey:string;input:string|null}
  'snapshot.read': null
  'snapshot.subscribe': null
  'snapshot.unsubscribe': null
  'window.perform': WindowCommand
  'window.readVisibility': null
  'window.readPresentation': null
  'app.quit': null
  'data.previewImport': { sourceKind: MigrationSource }
  'data.applyImport': { previewToken: string; expectedRevision: number; selectedFields: ImportField[]; undatedOvertimeShiftDate: LocalDate | null; confirmPreviouslyImported?: boolean }
  'data.previewRecovery': null
  'data.cancelImport': { previewToken: string }
  'calendar.readMetadata': null
  'data.export': { kind: 'v2-config' }
  'calendar.previewImport': null
  'calendar.applyImport': { previewToken: string; expectedCalendarRevision: number }
}
export interface ContractResponses {
  'config.read': ConfigSnapshot
  'config.save': ConfigSnapshot
  'settingsDraft.read': SettingsDraftSession
  'settingsDraft.update': SettingsDraftSession
  'settingsDraft.discard': SettingsDraftSession
  'settingsDraft.setExpectedEnd': SettingsDraftSession
  'snapshot.read': DashboardSnapshot
  'snapshot.subscribe': null
  'snapshot.unsubscribe': null
  'window.perform': null
  'window.readVisibility': WindowVisibility
  'window.readPresentation': WindowPresentation
  'app.quit': null
  'data.previewImport': ImportPreview
  'data.applyImport': ConfigSnapshot
  'data.previewRecovery': ImportPreview
  'data.cancelImport': null
  'calendar.readMetadata': CalendarDatasetMetadata[]
  'data.export': null
  'calendar.previewImport': CalendarImportPreview
  'calendar.applyImport': { calendarRevision: number }
}
export type Capability = keyof ContractRequests
type Call<K extends Capability> = (request: ContractRequests[K]) => Promise<Result<ContractResponses[K]>>
export interface SnapshotApi {
  read(): Promise<Result<DashboardSnapshot>>
  // Listener remains local to the bridge; only Result<DashboardSnapshot> is sent.
  subscribe(listener: (result: Result<DashboardSnapshot>) => void): Promise<Result<null>>
  unsubscribe(): Promise<Result<null>>
}
export interface CommonApi {
  readonly contractVersion: typeof CONTRACT_VERSION
  snapshot: SnapshotApi
  app: { quit(): Promise<Result<null>> }
}
export interface WindowVisibilityApi {
  readVisibility(): Promise<Result<WindowVisibility>>
  subscribeVisibility(listener: (result: Result<WindowVisibility>) => void): Promise<Result<null>>
  unsubscribeVisibility(): Promise<Result<null>>
  readPresentation(): Promise<Result<WindowPresentation>>
  subscribePresentation(listener:(result:Result<WindowPresentation>)=>void):Promise<Result<null>>
  unsubscribePresentation():Promise<Result<null>>
}
export interface MainWindowApi extends CommonApi {
  readonly role: 'main'
  window: WindowVisibilityApi & { perform: Call<'window.perform'>; onOpenSettings(listener:()=>void):()=>void }
  config: { read(): Promise<Result<ConfigSnapshot>>; save: Call<'config.save'> }
  settingsDraft: { read(): Promise<Result<SettingsDraftSession>>; update: Call<'settingsDraft.update'>; discard(): Promise<Result<SettingsDraftSession>>; setExpectedEnd:Call<'settingsDraft.setExpectedEnd'> }
  data: { previewRecovery(): Promise<Result<ImportPreview>>; cancelImport: Call<'data.cancelImport'>; previewImport: Call<'data.previewImport'>; applyImport: Call<'data.applyImport'>; export: Call<'data.export'> }
  calendar: { readMetadata(): Promise<Result<CalendarDatasetMetadata[]>>; previewImport(): Promise<Result<CalendarImportPreview>>; applyImport: Call<'calendar.applyImport'> }
}
export interface MiniWindowApi extends CommonApi {
  readonly role: 'mini'
  window: WindowVisibilityApi & { perform(request: MiniWindowCommand): Promise<Result<null>> }
}
export type WorkdayV2Api = MainWindowApi | MiniWindowApi
