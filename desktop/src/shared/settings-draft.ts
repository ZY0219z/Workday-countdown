import type { AppConfig, ContractError, ContractRequests, DraftState, JsonObject, JsonValue, Result, ValidationIssue } from './contracts'
import { validateAppConfig, validateDraftFields } from './config-schema'
import { checkExpectedRevision } from './capabilities'
import { success, validateJsonDto } from './validation'

function sameJsonData(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => sameJsonData(item, right[i]))
  }
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, i) => key === rightKeys[i] && sameJsonData(left[key], right[key]))
}

function editableFields(config: AppConfig): JsonObject {
  // Config has already been reconstructed by the whitelist validator.
  return {
    employee: { startDate: config.employee.startDate },
    schedule: { workWeek: config.schedule.workWeek.slice(), startTime: config.schedule.startTime, endTime: config.schedule.endTime,
      crossMidnight: config.schedule.crossMidnight, breaks: config.schedule.breaks.map(b => ({
        startTime: b.startTime, endTime: b.endTime, startDayOffset: b.startDayOffset, endDayOffset: b.endDayOffset
      })) },
    salary: { day: config.salary.day, nonWorkingPolicy: config.salary.nonWorkingPolicy,
      missingDayPolicy: config.salary.missingDayPolicy, showPaydayAsToday: config.salary.showPaydayAsToday },
    overtime: { entries: config.overtime.entries.map(e => ({ shiftDate: e.shiftDate, minutes: e.minutes })) },
    calendar: { region: config.calendar.region, enabledYears: config.calendar.enabledYears.slice(),
      overrides: Object.fromEntries(Object.entries(config.calendar.overrides)) },
    appearance: { mode: config.appearance.mode, accent: config.appearance.accent, reduceMotion: config.appearance.reduceMotion },
    desktop: { closeAction: config.desktop.closeAction, miniEnabled: config.desktop.miniEnabled,
      alwaysOnTop: config.desktop.alwaysOnTop, displayMode: config.desktop.displayMode,
      bounds: { main: config.desktop.bounds.main ? { x: config.desktop.bounds.main.x, y: config.desktop.bounds.main.y, width: config.desktop.bounds.main.width, height: config.desktop.bounds.main.height } : null,
        mini: config.desktop.bounds.mini ? { x: config.desktop.bounds.mini.x, y: config.desktop.bounds.mini.y, width: config.desktop.bounds.mini.width, height: config.desktop.bounds.mini.height } : null },
      tray: { firstHideNoticeAcknowledged: config.desktop.tray.firstHideNoticeAcknowledged } }
  }
}
function candidate(saved: AppConfig, draft: JsonObject): Result<AppConfig> {
  const calendar = draft.calendar
  const calendarFields = calendar !== null && typeof calendar === 'object' && !Array.isArray(calendar) ? calendar : null
  return validateAppConfig({
    schemaVersion: saved.schemaVersion, revision: saved.revision, updatedAt: saved.updatedAt, appVersion: saved.appVersion,
    employee: draft.employee, schedule: draft.schedule, salary: draft.salary, overtime: draft.overtime,
    calendar: calendarFields ? { region: calendarFields.region, enabledYears: calendarFields.enabledYears,
      overrides: calendarFields.overrides, datasets: saved.calendar.datasets } : calendar,
    appearance: draft.appearance, desktop: draft.desktop, migration: saved.migration
  })
}
export function createSettingsDraft(input: unknown): Result<DraftState> {
  const saved = validateAppConfig(input)
  if (!saved.ok) return saved
  return success({ saved: saved.data, draft: editableFields(saved.data), dirty: false, issues: [],
    expectedRevision: saved.data.revision, save: { status: 'idle' } })
}
export function updateSettingsDraft(state: DraftState, input: unknown): Result<DraftState> {
  if (state.save.status === 'saving') return { ok: false, error: { code: 'UNAVAILABLE', message: '保存中，暂不接受新的编辑。' } }
  const saved = validateAppConfig(state.saved)
  if (!saved.ok) return saved
  const draft = validateDraftFields(input)
  if (!draft.ok) return draft
  const checked = candidate(saved.data, draft.data)
  const issues: ValidationIssue[] = !checked.ok && checked.error.code === 'VALIDATION' ? checked.error.issues : []
  const base = editableFields(saved.data)
  // Compare parsed settings when valid; input key ordering is not a modification.
  const current = checked.ok ? editableFields(checked.data) : draft.data
  return success({ saved: saved.data, draft: current,
    dirty: checked.ok ? !sameJsonData(base, current) : true,
    issues, expectedRevision: state.expectedRevision, save: { status: 'idle' } })
}
export function prepareDraftSave(state: DraftState, actualRevision: number): Result<ContractRequests['config.save']> {
  const saved = validateAppConfig(state.saved)
  if (!saved.ok) return saved
  const savedRevision = checkExpectedRevision(state.expectedRevision, saved.data.revision)
  if (!savedRevision.ok) return savedRevision
  const revision = checkExpectedRevision(state.expectedRevision, actualRevision)
  if (!revision.ok) return revision
  const draft = validateDraftFields(state.draft)
  if (!draft.ok) return draft
  const checked = candidate(saved.data, draft.data)
  if (!checked.ok) return checked
  const config = checked.data
  return success({ expectedRevision: state.expectedRevision, settings: {
    employee: config.employee, schedule: config.schedule, salary: config.salary, overtime: config.overtime,
    calendar: { region: config.calendar.region, enabledYears: config.calendar.enabledYears, overrides: config.calendar.overrides },
    appearance: config.appearance, desktop: config.desktop
  } })
}
export function beginDraftSave(state: DraftState, actualRevision: number): Result<DraftState> {
  if (state.save.status === 'saving') return { ok: false, error: { code: 'UNAVAILABLE', message: '已有保存请求。' } }
  const ready = prepareDraftSave(state, actualRevision)
  if (!ready.ok) return ready
  const clone = updateSettingsDraft(state, state.draft)
  if (!clone.ok) return clone
  clone.data.save = { status: 'saving' }
  return clone
}
export function finishDraftSave(state: DraftState, result: Result<AppConfig>): Result<DraftState> {
  if (state.save.status !== 'saving') return { ok: false, error: { code: 'UNAVAILABLE', message: '没有待完成的保存请求。' } }
  if (!result.ok) {
    const errorCopy = validateJsonDto(result.error)
    if (!errorCopy.ok) return errorCopy
    const copy = updateSettingsDraft({ saved: state.saved, draft: state.draft, dirty: state.dirty,
      issues: state.issues, expectedRevision: state.expectedRevision, save: { status: 'idle' } }, state.draft)
    if (!copy.ok) return copy
    copy.data.save = { status: 'failed', error: errorCopy.data as unknown as ContractError }
    return copy
  }
  const next = createSettingsDraft(result.data)
  if (!next.ok) return next
  if (next.data.saved.revision <= state.expectedRevision) return { ok: false, error: {
    code: 'REVISION_CONFLICT', message: '保存响应未提供新的修订号。', expectedRevision: state.expectedRevision, actualRevision: next.data.saved.revision
  } }
  next.data.save = { status: 'saved', revision: next.data.saved.revision }
  return next
}
