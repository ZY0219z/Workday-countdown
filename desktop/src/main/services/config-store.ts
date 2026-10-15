import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import type { AppConfig, ConfigSnapshot, ContractError, ContractRequests, EditableConfig, InitialConfigInput, MigrationSource, Result } from '../../shared/contracts'
import { CONFIG_SCHEMA_VERSION } from '../../shared/contracts'
import { createAppConfig, sha256Format } from '../../shared/config-schema'
import { validateContractRequest, checkExpectedRevision } from '../../shared/capabilities'
import { issue, success, v, validateStructure, validationFailure, MAX_DTO_BYTES } from '../../shared/validation'
import { editableConfig, datasetMetadata, validateConfigSettingsAsync, validateConfigEnvelope, validateStoredConfig, type ConfigValidation, type ConfigValidationContext } from './config-validation'
import { fileFailure, nodeConfigFiles, configDirectory, type ConfigFiles } from './config-files'

export const contentHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const fingerprint = (text: string | null): string | null => text === null ? null : contentHash(text)
type FileCheck = { kind: 'missing' } | { kind: 'valid'; config: AppConfig } | { kind: 'invalid'; error: ContractError } | { kind: 'future'; error: ContractError }
export type ConfigLoadState =
  | { status: 'missing'; config: null }
  | { status: 'ready'; config: AppConfig }
  | { status: 'recoverable'; config: AppConfig; primaryError: ContractError | null; source: 'backup'; requiresConfirmation: true }
  | { status: 'invalid'; config: null; primaryError: ContractError; backupError: ContractError | null }
  | { status: 'future'; config: null; error: ContractError; readOnly: true }
export interface ConfigStoreOptions extends ConfigValidationContext {
  directory: string // Trusted Main composition only; NEVER a renderer argument.
  appVersion: string
  files?: ConfigFiles
  retry?: { attempts: number; pause(): Promise<void> }
}
export interface MigrationCommit {
  sourceKind: MigrationSource
  sourceHash: string
  sourceText: string
  baseHash: string // Also binds recovery/reload that happens to reuse a revision.
  verifySource(): Promise<Result<null>>
  recovery?: true // Main-only; a previewed valid backup is the candidate base.
  recoveryBase?: AppConfig // Main-created provisional base, only for missing/invalid files.
  sourceIsBackup?: boolean
}
export interface ConfigStore {
  load(): Promise<Result<ConfigLoadState>>
  read(): Promise<Result<ConfigSnapshot>>
  initialize(input: Omit<InitialConfigInput, 'updatedAt' | 'appVersion'>): Promise<Result<ConfigSnapshot>>
  initializeSettings(settings: EditableConfig): Promise<Result<ConfigSnapshot>>
  save(request: ContractRequests['config.save']): Promise<Result<ConfigSnapshot>>
  commitImport(request: ContractRequests['config.save'], proof: MigrationCommit): Promise<Result<ConfigSnapshot>>
  readBackup(): Promise<Result<string | null>>
  prepareRecoveryBase(settings: EditableConfig): Promise<Result<ConfigSnapshot>>
}
// Future Main composition passes app.getPath('appData'), not exe/userData paths.
// This factory is not called by D07's tests or by the existing POC runtime.
export function createUserConfigStore(options: Omit<ConfigStoreOptions, 'directory'> & { appDataRoot: string }): Result<ConfigStore> {
  const directory = configDirectory(options.appDataRoot)
  return directory.ok ? createConfigStore({ ...options, directory: directory.data }) : directory
}
// The instance owns one serialized queue. D08 must enforce a single process;
// there is no claim of transactional CAS with arbitrary external file writers.
export function createConfigStore(options: ConfigStoreOptions): Result<ConfigStore> {
  if (typeof options.directory !== 'string' || !isAbsolute(options.directory)) return validationFailure([issue('$.directory', 'FORMAT', '配置服务目录必须是主进程选定的绝对路径。')])
  const retry = options.retry ?? { attempts: 3, pause: () => new Promise<void>(resolve => setTimeout(resolve, 30)) }
  if (!Number.isInteger(retry.attempts) || retry.attempts < 1 || retry.attempts > 5) return validationFailure([issue('$.retry', 'RANGE', '文件替换只允许1至5次尝试。')])
  const files = options.files ?? nodeConfigFiles
  const primaryPath = join(options.directory, 'settings.json'), backupPath = join(options.directory, 'settings.backup.json')
  let loaded: ConfigLoadState | null = null, primaryText: string | null = null, backupText: string | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<Result<T>>): Promise<Result<T>> => {
    const result = queue.then(work).catch(error => fileFailure(error))
    queue = result.then(() => undefined)
    return result
  }
  function check(text: string | null): FileCheck {
    if (text === null) return { kind: 'missing' }
    if (Buffer.byteLength(text) > MAX_DTO_BYTES) return { kind: 'invalid', error: { code: 'VALIDATION', message: '配置过大。', issues: [issue('$', 'LIMIT', '配置超过1 MiB。')] } }
    try {
      const input: unknown = JSON.parse(text)
      // Future header protects the file even if other fields are damaged or
      // unsafe. JSON.parse does not invoke input accessors.
      const version = input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'schemaVersion') ? (input as { schemaVersion: unknown }).schemaVersion : null
      if (typeof version === 'number' && Number.isSafeInteger(version) && version > CONFIG_SCHEMA_VERSION) return { kind: 'future', error: { code: 'UNSUPPORTED_SCHEMA', message: '检测到未来版本配置，禁止降级覆盖。', received: version, supported: CONFIG_SCHEMA_VERSION, direction: 'future' } }
      const parsed = validateStoredConfig(input, options)
      if (parsed.ok) return { kind: 'valid', config: parsed.data }
      return { kind: parsed.error.code === 'UNSUPPORTED_SCHEMA' && parsed.error.direction === 'future' ? 'future' : 'invalid', error: parsed.error }
    } catch { return { kind: 'invalid', error: { code: 'VALIDATION', message: '配置JSON损坏。', issues: [issue('$', 'FORMAT', '无法解析配置JSON，原文件保留。')] } } }
  }
  async function load(): Promise<Result<ConfigLoadState>> {
    try {
      // Do not ignore a denied read or classify it as a first launch.
      const primary = await files.read(primaryPath), first = check(primary)
      if (first.kind === 'future') { loaded = { status: 'future', config: null, error: first.error, readOnly: true }; primaryText = primary; return success(structuredClone(loaded)) }
      const backup = await files.read(backupPath), second = check(backup)
      primaryText = primary; backupText = backup
      if (second.kind === 'future') loaded = { status: 'future', config: null, error: second.error, readOnly: true }
      else if (first.kind === 'valid') loaded = { status: 'ready', config: first.config }
      else if (second.kind === 'valid') loaded = { status: 'recoverable', config: second.config, source: 'backup', requiresConfirmation: true, primaryError: first.kind === 'invalid' ? first.error : null }
      else if (first.kind === 'missing' && second.kind === 'missing') loaded = { status: 'missing', config: null }
      else loaded = { status: 'invalid', config: null, primaryError: first.kind === 'invalid' ? first.error : { code: 'UNAVAILABLE', message: '正式配置缺失且备份无效。' }, backupError: second.kind === 'invalid' ? second.error : null }
      return success(structuredClone(loaded))
    } catch (error) { loaded = null; return fileFailure(error) }
  }
  async function ready(): Promise<Result<ConfigLoadState>> {
    return loaded ? success(loaded) : load()
  }
  function blocked(state: ConfigLoadState): Result<never> {
    return state.status === 'future' ? { ok: false, error: state.error } : { ok: false, error: { code: 'UNAVAILABLE', message: '尚无可直接保存的正式配置；请完成初始化或预览确认恢复。' } }
  }
  async function unchanged(): Promise<Result<null>> {
    const primary = await files.read(primaryPath), backup = await files.read(backupPath)
    if (fingerprint(primary) !== fingerprint(primaryText) || fingerprint(backup) !== fingerprint(backupText)) {
      const parsed = check(primary)
      if (parsed.kind === 'future') return { ok: false, error: parsed.error }
      return { ok: false, error: { code: 'REVISION_CONFLICT', message: '磁盘配置或备份已被外部修改，请重新读取和预览。', expectedRevision: loaded?.config?.revision ?? 0,
        actualRevision: parsed.kind === 'valid' ? parsed.config.revision : loaded?.config?.revision ?? 0 } }
    }
    return success(null)
  }
  async function replace(from: string, to: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try { await files.replace(from, to); return }
      catch (error) {
        if (!['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= retry.attempts) throw error
        await retry.pause()
      }
    }
  }
  async function write(candidate: AppConfig, validation: ConfigValidation, proof?: MigrationCommit): Promise<Result<ConfigSnapshot>> {
    const temporary: string[] = []
    const cleanWarnings = validation.warnings.slice()
    const checkClock = (): Result<null> => {
      const now = options.clock.read()
      if (!now.ok) return now
      const checked = validation.checkedClock
      return now.data.date === checked.localDate && now.data.timeZoneId === checked.timeZoneId && now.data.instant >= checked.instant
        ? success(null) : { ok: false, error: { code: 'UNAVAILABLE', message: '校验后日期、时区或时钟方向改变，请重新保存；旧配置保留。' } }
    }
    const stage = async (text: string, prefix: string): Promise<string> => {
      const path = join(options.directory, `${prefix}.${randomUUID()}.tmp`)
      temporary.push(path); await files.writeExclusiveFlush(path, text); return path
    }
    try {
      const clockBefore = checkClock()
      if (!clockBefore.ok) return clockBefore
      const unchangedBefore = await unchanged()
      if (!unchangedBefore.ok) return unchangedBefore
      if (proof) { const source = await proof.verifySource(); if (!source.ok) return source }
      await files.mkdir(options.directory)
      const text = JSON.stringify(candidate, null, 2) + '\n'
      if (Buffer.byteLength(text) > MAX_DTO_BYTES) return validationFailure([issue('$', 'LIMIT', '规范化配置超过1 MiB。')])
      const staged = await stage(text, 'settings')
      if (proof) {
        // Content-addressed source copy; no original path in the name or ledger.
        const archive = join(options.directory, `migration.${proof.sourceHash}.json`)
        const existing = await files.read(archive)
        if (existing !== null && contentHash(existing) !== proof.sourceHash) return { ok: false, error: { code: 'FORBIDDEN', message: '迁移来源备份摘要异常，停止保存。' } }
        if (existing === null) await replace(await stage(proof.sourceText, 'migration'), archive)
      }
      if (proof) { const source = await proof.verifySource(); if (!source.ok) return source }
      if (loaded?.status === 'ready' && primaryText !== null) {
        const previous = await stage(primaryText, 'backup')
        const checkBeforeBackup = await unchanged()
        if (!checkBeforeBackup.ok) return checkBeforeBackup
        await replace(previous, backupPath)
        backupText = primaryText // Backup may advance even if the final replace fails; it is still valid old data.
      } else if ((loaded?.status === 'recoverable' || loaded?.status === 'invalid') && primaryText !== null) {
        // Keep damaged bytes; never overwrite the only valid backup with them.
        await files.writeExclusiveFlush(join(options.directory, `settings.corrupt.${randomUUID()}.json`), primaryText)
      }
      if (loaded?.status === 'invalid' && backupText !== null) await files.writeExclusiveFlush(join(options.directory, `settings.backup.corrupt.${randomUUID()}.json`), backupText)
      if (proof && !proof.sourceIsBackup) { const source = await proof.verifySource(); if (!source.ok) return source }
      const clockBeforeReplace = checkClock()
      if (!clockBeforeReplace.ok) return clockBeforeReplace
      const checkBeforeReplace = await unchanged()
      if (!checkBeforeReplace.ok) return checkBeforeReplace
      await replace(staged, primaryPath) // Same-directory/same-volume rename; no unlink of the destination.
      primaryText = text
      loaded = { status: 'ready', config: candidate }
    } catch (error) { return fileFailure(error) }
    finally {
      for (const path of temporary) {
        try { await files.remove(path) }
        catch { cleanWarnings.push(issue('$', 'LIMIT', '临时文件清理失败，正式保存结果不受影响；后续仅清理服务自身临时文件。')) }
      }
    }
    return success({ config: structuredClone(candidate), warnings: cleanWarnings })
  }
  function timestamp(): Result<string> {
    const now = options.clock.read()
    return now.ok ? success(new Date(now.data.instant).toISOString()) : now // Formatting only; no real system clock access.
  }
  async function initializeSettings(input: unknown): Promise<Result<ConfigSnapshot>> {
    const state = await ready()
    if (!state.ok) return state
    if (state.data.status !== 'missing') return blocked(state.data)
    const validated = await validateConfigSettingsAsync(input, null, options)
    if (!validated.ok) return validated
    const time = timestamp()
    if (!time.ok) return time
    const settings = validated.data.settings
    const candidate = { schemaVersion: CONFIG_SCHEMA_VERSION, revision: 1, updatedAt: time.data, appVersion: options.appVersion,
      ...settings, calendar: { ...settings.calendar, datasets: datasetMetadata(settings, options) }, migration: { completed: [] } }
    const valid = validateConfigEnvelope(candidate, options)
    return valid.ok ? write(valid.data, validated.data) : valid
  }
  async function commit(input: unknown, proof?: MigrationCommit): Promise<Result<ConfigSnapshot>> {
    const request = validateContractRequest('main', 'config.save', input)
    if (!request.ok) return request
    const state = await ready()
    if (!state.ok) return state
    const fullRecovery = proof?.recovery && proof.sourceKind === 'v2' && proof.recoveryBase && ['missing', 'invalid'].includes(state.data.status)
    if (state.data.status !== 'ready' && !(proof?.recovery && state.data.status === 'recoverable') && !fullRecovery) return blocked(state.data)
    let base = state.data.config
    if (fullRecovery) {
      const checkedBase = validateStoredConfig(proof!.recoveryBase, options)
      if (!checkedBase.ok) return checkedBase
      if (checkedBase.data.revision !== 0 || checkedBase.data.migration.completed.length !== 0) return validationFailure([issue('$', 'FORMAT', '恢复基底必须由本机重新构造。')])
      base = checkedBase.data
    }
    if (!base) return blocked(state.data)
    const revision = checkExpectedRevision(request.data.expectedRevision, base.revision)
    if (!revision.ok) return revision
    if (base.revision === Number.MAX_SAFE_INTEGER) return validationFailure([issue('$.revision', 'RANGE', '修订号已达上限，禁止溢出覆盖。')])
    if (proof) {
      const checked = validateStructure({ sourceKind: proof.sourceKind, sourceHash: proof.sourceHash }, v.object({ sourceKind: v.enum(['python-v1', 'electron-poc', 'v2'] as const), sourceHash: sha256Format }))
      if (!checked.ok) return checked
      if (contentHash(JSON.stringify(base)) !== proof.baseHash) return { ok: false, error: { code: 'REVISION_CONFLICT', message: '预览基底已变化，即使修订号相同也必须重新预览。', expectedRevision: request.data.expectedRevision, actualRevision: base.revision } }
      if (Buffer.byteLength(proof.sourceText) > MAX_DTO_BYTES || contentHash(proof.sourceText) !== proof.sourceHash) return validationFailure([issue('$', 'FORMAT', '迁移来源内容与摘要不一致。')])
    }
    const validated = await validateConfigSettingsAsync(request.data.settings, fullRecovery ? null : base, options, proof?.sourceKind === 'v2')
    if (!validated.ok) return validated
    const time = timestamp()
    if (!time.ok) return time
    const settings = validated.data.settings
    const records = base.migration.completed.filter(record => !proof || record.sourceKind !== proof.sourceKind || record.sourceHash !== proof.sourceHash)
    if (proof) records.push({ sourceKind: proof.sourceKind, sourceHash: proof.sourceHash, migratedAt: time.data })
    // Only already validated settings are copied. System metadata is host-owned.
    const candidate = { schemaVersion: CONFIG_SCHEMA_VERSION, revision: base.revision + 1, updatedAt: time.data, appVersion: options.appVersion,
      ...settings, calendar: { ...settings.calendar, datasets: datasetMetadata(settings, options) }, migration: { completed: records } }
    const valid = validateConfigEnvelope(candidate, options)
    return valid.ok ? write(valid.data, validated.data, proof) : valid
  }
  return success({
    load: () => serialized(load),
    read: () => serialized(async () => {
      const state = await ready()
      if (!state.ok) return state
      if (!state.data.config) return blocked(state.data)
      return success({ config: structuredClone(state.data.config), warnings: state.data.status === 'recoverable' ? [issue('$', 'FORMAT', '当前读取来自有效备份，恢复尚未确认；损坏正式文件已保留。')] : [] })
    }),
    initialize: input => serialized(async () => {
      const state = await ready()
      if (!state.ok) return state
      if (state.data.status !== 'missing') return blocked(state.data)
      const time = timestamp()
      if (!time.ok) return time
      // Validate the exact initial request before constructing any metadata.
      const initial = validateStructure(input, v.object({ startDate: v.nullable(v.string(/^\d{4}-\d{2}-\d{2}$/)), startTime: v.string(), endTime: v.string(),
        salaryDay: v.number(1, 31), themeMode: v.enum(['system', 'light', 'dark'] as const), themeAccent: v.enum(['ocean', 'coral'] as const) }))
      if (!initial.ok) return initial
      const created = createAppConfig({ ...initial.data, updatedAt: time.data, appVersion: options.appVersion })
      if (!created.ok) return created
      const settings = editableConfig(created.data)
      if (!settings.ok) return settings
      return initializeSettings(settings.data)
    }),
    initializeSettings: settings => {
      const detached = validateContractRequest('main', 'config.save', { settings, expectedRevision: 0 })
      return detached.ok ? serialized(() => initializeSettings(detached.data.settings)) : Promise.resolve(detached)
    },
    save: request => {
      const detached = validateContractRequest('main', 'config.save', request)
      return detached.ok ? serialized(() => commit(detached.data)) : Promise.resolve(detached)
    },
    commitImport: (request, proof) => {
      const detached = validateContractRequest('main', 'config.save', request)
      return detached.ok ? serialized(() => commit(detached.data, proof)) : Promise.resolve(detached)
    },
    // Read-only source checks must also work from inside the serialized commit;
    // enqueueing this read would deadlock a backup recovery's source verifier.
    readBackup: async () => { try { return success(await files.read(backupPath)) } catch (error) { return fileFailure(error) } },
    prepareRecoveryBase: settings => serialized(async () => {
      const state = await ready()
      if (!state.ok) return state
      if (!['missing', 'invalid'].includes(state.data.status)) return blocked(state.data)
      const checked = await validateConfigSettingsAsync(settings, null, options, true)
      if (!checked.ok) return checked
      const time = timestamp()
      if (!time.ok) return time
      const data = checked.data.settings
      const canonical = validateConfigEnvelope({ schemaVersion: CONFIG_SCHEMA_VERSION, revision: 0, updatedAt: time.data, appVersion: options.appVersion, ...data,
        calendar: { ...data.calendar, datasets: datasetMetadata(data, options) }, migration: { completed: [] } }, options)
      if (!canonical.ok) return canonical
      return success({ config: canonical.data,
        warnings: [issue('$', 'FORMAT', '没有有效正式配置；本预览基底仅在内存中，须选择完整V2字段并明确确认恢复。')] })
    })
  })
}
