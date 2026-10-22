import type { EditableConfig, JsonObject, JsonValue, SettingsDraftSession, ValidationIssue } from '../../../shared/contracts'
import { validateDraftFields } from '../../../shared/config-schema'

export type EditorSettings = Omit<EditableConfig, 'salary' | 'overtime'> & {
  salary: Omit<EditableConfig['salary'], 'day'> & { day: number | null }
  overtime: { entries: Array<{ shiftDate: string; minutes: number | null }> }
}
// Visible unsaved form values only. Times/salary are intentionally unspecified.
export function initialEditor(): EditorSettings {
  return { employee: { startDate: null }, schedule: { startTime: '', endTime: '', crossMidnight: false, workWeek: [1,2,3,4,5], breaks: [] },
    salary: { day: null, nonWorkingPolicy: 'delay', missingDayPolicy: 'monthEnd', showPaydayAsToday: true }, overtime: { entries: [] },
    calendar: { region: 'CN', enabledYears: [2024,2025,2026], overrides: {} }, appearance: { mode: 'system', accent: 'ocean', reduceMotion: false },
    desktop: { closeAction: 'hideToTray', miniEnabled: false, alwaysOnTop: false, displayMode: 'exclusive', bounds: { main:null,mini:null }, tray: { firstHideNoticeAcknowledged:false } } }
}
export function asDraft(input: EditorSettings): JsonObject { return structuredClone(input) as unknown as JsonObject }
export function editorFrom(session: SettingsDraftSession): EditorSettings {
  const base = initialEditor(), parsed = validateDraftFields(session.draft)
  if (!parsed.ok) return base
  // Traverse a fixed known shape, never spread unchecked objects into settings.
  function merge(shape: JsonValue, value: JsonValue | undefined, field=''): JsonValue {
    if (Array.isArray(shape)) return Array.isArray(value) ? structuredClone(value) : shape
    if (shape !== null && typeof shape === 'object') {
      const result: JsonObject = {}, source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
      // This schema-declared date dictionary has dynamic keys, unlike fixed
      // business objects. validateDraftFields already rejected unsafe JSON keys;
      // Main still validates real dates and work/rest values before saving.
      if(field==='calendar.overrides')return structuredClone(source)
      for (const key of Object.keys(shape)) result[key] = merge(shape[key], source[key],field?`${field}.${key}`:key)
      return result
    }
    return value === undefined ? shape : structuredClone(value)
  }
  return merge(asDraft(base), parsed.data) as unknown as EditorSettings
}
export function fieldIssues(issues: readonly ValidationIssue[], path: string, excludePaths: readonly string[] = []): ValidationIssue[] {
  const matches = (field: string, parent: string) => field === parent || field.startsWith(parent + '.') || field.startsWith(parent + '[')
  return issues.filter(issue => matches(issue.field, path) && !excludePaths.some(excluded => matches(issue.field, excluded)))
}
export function fieldMessage(issue: ValidationIssue): string {
  if(issue.field==='$.expectedEndTime')return issue.message
  if(issue.field==='$.salary.day')return '请填写每月发薪日，使用 1–31 的整数。'
  if(/\.(startTime|endTime)$/.test(issue.field)&&['FORMAT','MISSING_FIELD','TYPE'].includes(issue.reason))return '请输入 24 小时制 HH:MM（00:00–23:59），例如 08:30。'
  return ({ MISSING_FIELD:'请填写此项。', UNKNOWN_FIELD:'包含不支持的设置。', TYPE:'请输入正确类型的值。', RANGE:'数值或时间区间超出允许范围。', ENUM:'请选择有效选项。', FORMAT:'请检查日期、时间格式及区间关系。', DUPLICATE:'存在重复或冲突记录。', DANGEROUS_KEY:'包含不安全字段。', NOT_SERIALIZABLE:'内容无法安全保存。', LIMIT:'超过处理范围，请减少记录或检查设置。' } as const)[issue.reason]
}
