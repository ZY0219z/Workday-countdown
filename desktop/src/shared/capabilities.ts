import type { Capability, ContractRequests, WindowRole, WindowCommand, Result, JsonValue, ValidationIssue } from './contracts'
import { IMPORT_FIELDS } from './contracts'
import { editableConfigValidator, dateFormat, revisionFormat, validateDraftFields } from './config-schema'
import { success, v, validateJsonDto, validateStructure } from './validation'
import type { Validator } from './validation'

const mainCapabilities = [
  'config.read', 'config.save', 'settingsDraft.read', 'settingsDraft.update', 'settingsDraft.discard',
  'settingsDraft.setExpectedEnd',
  'snapshot.read', 'snapshot.subscribe', 'snapshot.unsubscribe', 'window.perform', 'app.quit',
  'data.previewImport', 'data.applyImport', 'data.export', 'data.previewRecovery', 'data.cancelImport', 'calendar.readMetadata', 'calendar.previewImport', 'calendar.applyImport'
] as const satisfies readonly Capability[]
const miniCapabilities = ['snapshot.read', 'snapshot.subscribe', 'snapshot.unsubscribe', 'window.perform', 'app.quit'] as const satisfies readonly Capability[]
export const WINDOW_CAPABILITIES = Object.freeze({ main: Object.freeze(mainCapabilities), mini: Object.freeze(miniCapabilities) })
export function isCapabilityAllowed(role: WindowRole, method: Capability): boolean {
  return Object.prototype.hasOwnProperty.call(WINDOW_CAPABILITIES, role) && (WINDOW_CAPABILITIES[role] as readonly string[]).includes(method)
}
const nullRequest = v.enum([null] as const)
const requests = {
  'config.read': nullRequest,
  'config.save': v.object<ContractRequests['config.save']>({ settings: editableConfigValidator, expectedRevision: revisionFormat }),
  'settingsDraft.read': nullRequest,
  'settingsDraft.update': v.object<ContractRequests['settingsDraft.update']>({
    draft: (value: JsonValue | undefined, field: string, issues: ValidationIssue[]) => {
      const result = validateDraftFields(value)
      if (result.ok) return result.data
      if (result.error.code === 'VALIDATION') issues.push(...result.error.issues.map(item => ({ field: field + item.field.slice(1), reason: item.reason, message: item.message })))
      return undefined
    }, expectedRevision: revisionFormat
  }),
  'settingsDraft.discard': nullRequest,
  'settingsDraft.setExpectedEnd': v.object<ContractRequests['settingsDraft.setExpectedEnd']>({expectedRevision:revisionFormat,targetKey:v.string(undefined,128),input:(value,field,issues)=>value===''?'':v.nullable(v.string(undefined,32))(value,field,issues)}),
  'snapshot.read': nullRequest, 'snapshot.subscribe': nullRequest, 'snapshot.unsubscribe': nullRequest,
  'app.quit': nullRequest,
  'data.previewImport': v.object<ContractRequests['data.previewImport']>({ sourceKind: v.enum(['python-v1', 'electron-poc', 'v2'] as const) }),
  'data.applyImport': v.object<ContractRequests['data.applyImport']>({
    previewToken: v.string(undefined, 256), expectedRevision: revisionFormat,
    selectedFields: v.array(v.enum(IMPORT_FIELDS), 1, IMPORT_FIELDS.length, field => field),
    undatedOvertimeShiftDate: v.nullable(dateFormat),
    confirmPreviouslyImported: (value, field, issues) => value === undefined ? undefined : v.boolean(value, field, issues)
  }),
  'data.previewRecovery': nullRequest,
  'data.cancelImport': v.object<ContractRequests['data.cancelImport']>({ previewToken: v.string(undefined, 256) }),
  'calendar.readMetadata': nullRequest,
  'data.export': v.object<ContractRequests['data.export']>({ kind: v.enum(['v2-config'] as const) }),
  'calendar.previewImport': nullRequest,
  'calendar.applyImport': v.object<ContractRequests['calendar.applyImport']>({ previewToken: v.string(undefined, 256), expectedCalendarRevision: revisionFormat })
} satisfies { [K in Exclude<Capability, 'window.perform'>]: Validator<ContractRequests[K]> }

// Caller role must come from main's registered frame; NEVER trust renderer.role.
// This is a pure allow-list validator, not an IPC handler or window operation.
export function validateContractRequest<K extends Capability>(role: WindowRole, method: K, input: unknown): Result<ContractRequests[K]> {
  if (!isCapabilityAllowed(role, method)) return { ok: false, error: { code: 'FORBIDDEN', message: '当前窗口不允许此能力。' } }
  if (method === 'window.perform') {
    const json = validateJsonDto(input)
    if (!json.ok) return json
    const action = json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data.action : undefined
    if (role === 'mini' && action === 'showMini') return { ok: false, error: { code: 'FORBIDDEN', message: '迷你窗口不允许此操作。' } }
    const commandValidator: Validator<WindowCommand> = action === 'setMiniTop'
      ? v.object<{ action: 'setMiniTop'; enabled: boolean }>({ action: v.enum(['setMiniTop'] as const), enabled: v.boolean })
      : v.object<{ action: 'showMain' | 'showMini' | 'hideMini' }>({ action: v.enum(['showMain', 'showMini', 'hideMini'] as const) })
    return validateStructure(input, commandValidator) as Result<ContractRequests[K]>
  }
  const validator = requests[method as keyof typeof requests] as Validator<ContractRequests[K]>
  return validateStructure(input, validator) as Result<ContractRequests[K]>
}

export function checkExpectedRevision(expectedRevision: number, actualRevision: number): Result<null> {
  const numbers = validateStructure({ expectedRevision, actualRevision }, v.object({ expectedRevision: revisionFormat, actualRevision: revisionFormat }))
  if (!numbers.ok) return numbers
  return expectedRevision === actualRevision ? success(null) : { ok: false, error: {
    code: 'REVISION_CONFLICT', message: '配置已更改，请重新加载或预览差异。', expectedRevision, actualRevision
  } }
}
