import { randomUUID } from 'node:crypto'
import type { AppConfig, ConfigSnapshot, ContractRequests, EditableConfig, ImportField, ImportPreview, JsonValue, MigrationSource, Result, ValidationIssue } from '../../shared/contracts'
import { IMPORT_FIELDS } from '../../shared/contracts'
import { validateAppConfig, editableValidators } from '../../shared/config-schema'
import { validateContractRequest, checkExpectedRevision } from '../../shared/capabilities'
import { issue, success, v, validateJsonDto, validateStructure, validationFailure, MAX_DTO_BYTES } from '../../shared/validation'
import { normalizeLocalDate } from '../../domain/local-date'
import { parseLocalTime, validateInstant } from '../../domain/local-time'
import { validateDateOverrides } from '../../domain/calendar'
import { validateOvertime } from '../../domain/overtime'
import { validateSchedule } from '../../domain/schedule'
import type { ConfigValidationContext } from './config-validation'
import { editableConfig, validateConfigSettings, validateStoredConfig } from './config-validation'
import type { ConfigStore } from './config-store'
import { contentHash } from './config-store'
import type { ImportSourceHandle, MigrationFiles } from './migration-files'

const TTL_MILLISECONDS = 10 * 60_000
type Mapping = { values: Map<ImportField, JsonValue>; issues: Map<ImportField, ValidationIssue[]>; notes: ValidationIssue[]; undated: number | null }
type Session = { preview: ImportPreview; source: ImportSourceHandle | null; text: string; expires: number; recovery: boolean; baseHash: string; recoveryBase?: AppConfig }
function fieldValue(settings: EditableConfig, field: ImportField): JsonValue {
  let value: unknown = settings
  for (const key of field.split('.')) value = (value as Record<string, unknown>)[key]
  return value as JsonValue // Fixed typed whitelist, on a validated object only.
}
function assignField(settings: EditableConfig, field: ImportField, value: JsonValue): void {
  const keys = field.split('.')
  let parent: unknown = settings
  for (const key of keys.slice(0, -1)) parent = (parent as Record<string, unknown>)[key]
  ;(parent as Record<string, unknown>)[keys[keys.length - 1]] = structuredClone(value)
}
function parseText(text: string): Result<JsonValue> {
  if (Buffer.byteLength(text) > MAX_DTO_BYTES) return validationFailure([issue('$', 'LIMIT', '导入不得超过1 MiB。')])
  try { return validateJsonDto(JSON.parse(text)) }
  catch { return validationFailure([issue('$', 'FORMAT', '导入JSON损坏。')]) }
}
function mapSource(text: string, kind: MigrationSource): Result<Mapping> {
  const parsed = parseText(text)
  if (!parsed.ok) return parsed
  if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) return validationFailure([issue('$', 'TYPE', '来源必须为配置对象。')])
  const source = parsed.data, result: Mapping = { values: new Map(), issues: new Map(), notes: [], undated: null }
  if (kind !== 'v2' && Object.hasOwn(source, 'schemaVersion')) {
    const versioned = validateAppConfig(source)
    if (!versioned.ok && versioned.error.code === 'UNSUPPORTED_SCHEMA') return versioned
    return validationFailure([issue('$.schemaVersion', 'FORMAT', '带版本配置必须选择V2来源，不能伪装为旧源绕过版本保护。')])
  }
  const offer = (field: ImportField, incoming: JsonValue, checked: Result<unknown>): void => {
    result.values.set(field, incoming)
    if (!checked.ok) result.issues.set(field, checked.error.code === 'VALIDATION' ? checked.error.issues : [issue(field, 'FORMAT', checked.error.message)])
  }
  if (kind === 'v2') {
    const full = validateAppConfig(source)
    if (!full.ok) return full
    const editable = editableConfig(full.data)
    if (!editable.ok) return editable
    for (const field of IMPORT_FIELDS) offer(field, fieldValue(editable.data, field), success(null))
    const employee = full.data.employee.startDate === null ? success(null) : normalizeLocalDate(full.data.employee.startDate)
    offer('employee.startDate', full.data.employee.startDate, employee)
    offer('overtime.entries', fieldValue(editable.data, 'overtime.entries'), validateOvertime(full.data.overtime))
    offer('calendar.overrides', fieldValue(editable.data, 'calendar.overrides'), validateDateOverrides(full.data.calendar.overrides))
    const schedule = validateSchedule(full.data.schedule)
    if (!schedule.ok) for (const field of IMPORT_FIELDS.filter(item => item.startsWith('schedule.'))) offer(field, fieldValue(editable.data, field), schedule)
    result.notes.push(issue('$', 'FORMAT', '外部schema只用于版本识别；revision、appVersion、更新时间、核验元数据及迁移账本不导入，均由本机服务管理。'))
    return success(result)
  }
  const allowed = kind === 'python-v1' ? ['start_date', 'work_start_time', 'work_end_time', 'salary_day', 'overtime_minutes'] : ['workStartTime', 'workEndTime']
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) result.notes.push(issue(`$.${key}`, 'UNKNOWN_FIELD', '旧源未知字段不迁移。'))
  }
  const startKey = kind === 'python-v1' ? 'work_start_time' : 'workStartTime'
  const endKey = kind === 'python-v1' ? 'work_end_time' : 'workEndTime'
  for (const [key, field] of [[startKey, 'schedule.startTime'], [endKey, 'schedule.endTime']] as const) {
    if (!Object.hasOwn(source, key)) continue
    const raw = source[key]
    const normalized = typeof raw === 'string' && /^\d{1,2}:\d{1,2}$/.test(raw) ? raw.split(':').map(item => item.padStart(2, '0')).join(':') : raw
    const valid = parseLocalTime(normalized)
    offer(field, normalized, valid)
    if (valid.ok && raw !== normalized) result.notes.push(issue(field, 'FORMAT', `旧时间${String(raw)}规范化为${String(normalized)}，须确认后应用。`))
  }
  if (kind === 'python-v1') {
    if (Object.hasOwn(source, 'start_date')) offer('employee.startDate', source.start_date, normalizeLocalDate(source.start_date))
    if (Object.hasOwn(source, 'salary_day')) offer('salary.day', source.salary_day, validateStructure(source.salary_day, v.number(1, 31)))
    if (Object.hasOwn(source, 'overtime_minutes')) {
      const amount = validateStructure(source.overtime_minutes, v.number(0, 600))
      if (amount.ok) {
        result.undated = amount.data
        offer('overtime.entries', [], amount)
        result.notes.push(issue('overtime.entries', 'FORMAT', '旧加班无班次日期；默认跳过，选中后还须明确提供有效shiftDate。'))
      } else result.notes.push(...(amount.error.code === 'VALIDATION' ? amount.error.issues : []))
    }
  }
  if (!result.values.size) return validationFailure([issue('$', 'MISSING_FIELD', '来源没有可预览的已知字段。')])
  return success(result)
}
export interface MigrationService {
  preview(request: ContractRequests['data.previewImport']): Promise<Result<ImportPreview>>
  previewRecovery(): Promise<Result<ImportPreview>>
  apply(request: ContractRequests['data.applyImport']): Promise<Result<ConfigSnapshot>>
  cancel(previewToken: string): Result<null>
  exportConfig(): Promise<Result<null>>
}
export function createMigrationService(options: ConfigValidationContext & { store: ConfigStore; sources: MigrationFiles }): MigrationService {
  const sessions = new Map<string, Session>()
  function prune(now: number): void { for (const [token, session] of sessions) if (now >= session.expires) sessions.delete(token) }
  async function makePreview(kind: MigrationSource, source: ImportSourceHandle | null, text: string, recovery: boolean): Promise<Result<ImportPreview>> {
    const now = options.clock.read()
    if (!now.ok) return now
    prune(now.data.instant)
    if (sessions.size >= 16) return validationFailure([issue('$', 'LIMIT', '预览会话过多，请先取消旧预览。')])
    const loadState = await options.store.load()
    if (!loadState.ok) return loadState
    if (loadState.data.status === 'future') return { ok: false, error: loadState.data.error }
    if (loadState.data.status === 'recoverable') recovery = true
    let current = await options.store.read()
    let recoveryBase: AppConfig | undefined
    if (!current.ok && kind === 'v2' && !recovery) {
      const state = await options.store.load()
      if (!state.ok) return state
      if (state.data.status === 'future') return { ok: false, error: state.data.error }
      if (state.data.status !== 'missing' && state.data.status !== 'invalid') return current
      const parsed = parseText(text)
      if (!parsed.ok) return parsed
      const full = validateAppConfig(parsed.data)
      if (!full.ok) return full
      const editable = editableConfig(full.data)
      if (!editable.ok) return editable
      current = await options.store.prepareRecoveryBase(editable.data)
      if (current.ok) { recoveryBase = current.data.config; recovery = true }
    }
    if (!current.ok) return current
    const settings = editableConfig(current.data.config)
    if (!settings.ok) return settings
    const mapped = mapSource(text, kind)
    if (!mapped.ok) return mapped
    const hash = contentHash(text), token = randomUUID(), expires = now.data.instant + TTL_MILLISECONDS
    const expiry = validateInstant(expires)
    if (!expiry.ok) return expiry
    const alreadyProcessed = current.data.config.migration.completed.some(item => item.sourceKind === kind && item.sourceHash === hash)
    const preview: ImportPreview = { previewToken: token, sourceKind: kind, sourceHash: hash, expectedRevision: current.data.config.revision,
      choices: [...mapped.data.values].map(([field, incoming]) => ({ field, current: recoveryBase ? null : fieldValue(settings.data, field), incoming, issues: mapped.data.issues.get(field) ?? [] })),
      undatedOvertimeMinutes: mapped.data.undated, alreadyProcessed, notes: mapped.data.notes,
      expiresAt: new Date(expires).toISOString() }
    if (alreadyProcessed) preview.notes!.push(issue('$', 'DUPLICATE', '该来源已处理；再次覆盖必须在新预览后额外明确确认。'))
    preview.notes!.push(...current.data.warnings)
    sessions.set(token, { preview: structuredClone(preview), source, text, expires, recovery, baseHash: contentHash(JSON.stringify(current.data.config)), recoveryBase })
    return success(preview)
  }
  async function reread(session: Session): Promise<Result<null>> {
    const result = session.source ? await options.sources.read(session.source) : session.recovery ? await options.store.readBackup() : { ok: false as const, error: { code: 'FORBIDDEN' as const, message: '来源能力已失效。' } }
    if (!result.ok) return result
    return result.data !== null && contentHash(result.data) === session.preview.sourceHash ? success(null) : { ok: false, error: { code: 'UNAVAILABLE', message: '源内容已改变或缺失，请重新预览。' } }
  }
  const service: MigrationService = {
    async preview(request) {
      const valid = validateContractRequest('main', 'data.previewImport', request)
      if (!valid.ok) return valid
      try {
        const selected = await options.sources.choose(valid.data.sourceKind)
        if (!selected.ok) return selected
        if (!selected.data) return { ok: false, error: { code: 'CANCELLED', message: '已取消来源选择。' } }
        if (selected.data.kind !== valid.data.sourceKind) return { ok: false, error: { code: 'FORBIDDEN', message: '来源类型与选择能力不匹配。' } }
        const text = await options.sources.read(selected.data)
        if (!text.ok) return text
        if (text.data === null) return { ok: false, error: { code: 'UNAVAILABLE', message: '来源文件不存在。' } }
        return makePreview(valid.data.sourceKind, selected.data, text.data, false)
      } catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '无法读取导入来源，正式配置未改变。' } } }
    },
    async previewRecovery() {
      const loaded = await options.store.load()
      if (!loaded.ok) return loaded
      if (loaded.data.status === 'future') return { ok: false, error: loaded.data.error }
      const backup = await options.store.readBackup()
      if (!backup.ok) return backup
      if (backup.data === null) return { ok: false, error: { code: 'UNAVAILABLE', message: '没有可预览的备份。' } }
      // Verify backup fully before exposing a recovery proposal.
      const parsed = parseText(backup.data)
      if (!parsed.ok) return parsed
      const full = validateStoredConfig(parsed.data, options)
      if (!full.ok) return full
      return makePreview('v2', null, backup.data, true)
    },
    async apply(request) {
      const valid = validateContractRequest('main', 'data.applyImport', request)
      if (!valid.ok) return valid
      const now = options.clock.read()
      if (!now.ok) return now
      const session = sessions.get(valid.data.previewToken)
      if (!session || now.data.instant >= session.expires || now.data.instant < session.expires - TTL_MILLISECONDS) {
        sessions.delete(valid.data.previewToken)
        return { ok: false, error: { code: 'UNAVAILABLE', message: '预览已过期或时钟回拨，请重新预览。' } }
      }
      if (session.preview.alreadyProcessed && valid.data.confirmPreviouslyImported !== true) return { ok: false, error: { code: 'FORBIDDEN', message: '重复来源需要额外明确确认，未覆盖现有值。' } }
      const base = session.recoveryBase ? success({ config: structuredClone(session.recoveryBase), warnings: [] }) : await options.store.read()
      if (!base.ok) return base
      const revision = checkExpectedRevision(valid.data.expectedRevision, session.preview.expectedRevision)
      if (!revision.ok) return revision
      const current = checkExpectedRevision(valid.data.expectedRevision, base.data.config.revision)
      if (!current.ok) { sessions.delete(valid.data.previewToken); return current }
      if (contentHash(JSON.stringify(base.data.config)) !== session.baseHash) {
        sessions.delete(valid.data.previewToken)
        return { ok: false, error: { code: 'REVISION_CONFLICT', message: '正式配置基底已改变，请重新预览。', expectedRevision: valid.data.expectedRevision, actualRevision: base.data.config.revision } }
      }
      const source = await reread(session)
      if (!source.ok) { sessions.delete(valid.data.previewToken); return source }
      const editable = editableConfig(base.data.config)
      if (!editable.ok) return editable
      if (session.recoveryBase && valid.data.selectedFields.length !== IMPORT_FIELDS.length) return validationFailure([issue('$.selectedFields', 'MISSING_FIELD', '没有有效基底时必须明确选择完整V2字段；不能猜测未选中的初始值。')])
      for (const field of valid.data.selectedFields) {
        const choice = session.preview.choices.find(item => item.field === field)
        if (!choice || choice.issues.length) return validationFailure(choice?.issues.length ? choice.issues : [issue(field, 'UNKNOWN_FIELD', '所选字段不属于有效预览白名单。')])
        if (field === 'overtime.entries' && session.preview.sourceKind === 'python-v1') {
          if (valid.data.undatedOvertimeShiftDate === null) continue // Explicitly skip, never infer today's date.
          const date = normalizeLocalDate(valid.data.undatedOvertimeShiftDate)
          if (!date.ok) return date
          const amount = session.preview.undatedOvertimeMinutes!
          const entries = editable.data.overtime.entries
          const existing = entries.find(item => item.shiftDate === date.data)
          if (existing) existing.minutes = amount
          else entries.push({ shiftDate: date.data, minutes: amount })
        } else if (field === 'overtime.entries' && session.preview.sourceKind === 'v2') {
          const incoming = validateStructure({ entries: choice.incoming }, editableValidators.overtime)
          if (!incoming.ok) return incoming
          // Explicit incoming entries override same dates; absent dates never purge unrelated history.
          const merged = new Map(editable.data.overtime.entries.map(item => [item.shiftDate, item]))
          for (const entry of incoming.data.entries) merged.set(entry.shiftDate, entry)
          editable.data.overtime.entries = [...merged.values()]
        } else assignField(editable.data, field, choice.incoming)
      }
      if (valid.data.undatedOvertimeShiftDate !== null && (session.preview.sourceKind !== 'python-v1' || !valid.data.selectedFields.includes('overtime.entries'))) {
        return validationFailure([issue('$.undatedOvertimeShiftDate', 'FORMAT', '只有明确选中的Python无日期加班可以指定归属日期。')])
      }
      const semantic = validateConfigSettings(editable.data, base.data.config, options, session.preview.sourceKind === 'v2')
      if (!semantic.ok) return semantic
      const result = await options.store.commitImport({ settings: semantic.data.settings, expectedRevision: valid.data.expectedRevision }, {
        sourceKind: session.preview.sourceKind, sourceHash: session.preview.sourceHash, sourceText: session.text, baseHash: session.baseHash, recoveryBase: session.recoveryBase, sourceIsBackup: session.source === null,
        verifySource: async () => {
          const time = options.clock.read()
          if (!time.ok) return time
          if (sessions.get(valid.data.previewToken) !== session || time.data.instant >= session.expires || time.data.instant < session.expires - TTL_MILLISECONDS) {
            return { ok: false, error: { code: 'CANCELLED', message: '预览已取消或失效，配置没有应用。' } }
          }
          return reread(session)
        }, ...(session.recovery ? { recovery: true as const } : {})
      })
      if (result.ok || (!result.ok && result.error.code === 'REVISION_CONFLICT')) sessions.delete(valid.data.previewToken)
      return result
    },
    cancel(token) { sessions.delete(token); return success(null) },
    async exportConfig() {
      const current = await options.store.read()
      if (!current.ok) return current
      const config: AppConfig = structuredClone(current.data.config)
      config.revision = 0; config.migration.completed = []; config.calendar.datasets = []
      // Exported metadata is descriptive, never a capability or ledger import.
      const valid = validateAppConfig(config)
      if (!valid.ok) return valid
      try { return await options.sources.export(JSON.stringify(valid.data, null, 2) + '\n') }
      catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '导出失败，正式配置未改变。' } } }
    }
  }
  // Even a failing trusted chooser/clock adapter must not reject into a future
  // Vue caller. Success still requires every ordinary validation/IO step.
  async function guarded<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    try { return await work() }
    catch { return { ok: false, error: { code: 'UNAVAILABLE', message: '迁移服务无法完成当前操作，正式配置未确认成功，请重试。' } } }
  }
  return { preview: input => guarded(() => service.preview(input)), previewRecovery: () => guarded(() => service.previewRecovery()),
    apply: input => guarded(() => service.apply(input)), cancel: service.cancel, exportConfig: () => guarded(() => service.exportConfig()) }
}
