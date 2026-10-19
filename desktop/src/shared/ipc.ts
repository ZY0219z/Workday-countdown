import type { Capability, ContractError, Result } from './contracts'
import { ERROR_CODES } from './contracts'
import { validateJsonDto, validateStructure, v } from './validation'
export const V2_CHANNELS=Object.freeze({
  'config.read':'workday-v2:config-read','config.save':'workday-v2:config-save',
  'settingsDraft.read':'workday-v2:draft-read','settingsDraft.update':'workday-v2:draft-update','settingsDraft.discard':'workday-v2:draft-discard',
  'settingsDraft.setExpectedEnd':'workday-v2:draft-expected-end',
  'snapshot.read':'workday-v2:snapshot-read','snapshot.subscribe':'workday-v2:snapshot-subscribe','snapshot.unsubscribe':'workday-v2:snapshot-unsubscribe',
  'window.perform':'workday-v2:window-perform','app.quit':'workday-v2:quit',
  'window.readVisibility':'workday-v2:window-visibility-read',
  'window.readPresentation':'workday-v2:window-presentation-read',
  'data.previewImport':'workday-v2:import-preview','data.applyImport':'workday-v2:import-apply','data.export':'workday-v2:export',
  'data.previewRecovery':'workday-v2:recovery-preview','data.cancelImport':'workday-v2:import-cancel','calendar.readMetadata':'workday-v2:calendar-metadata',
  'calendar.previewImport':'workday-v2:calendar-preview','calendar.applyImport':'workday-v2:calendar-apply'
} as const satisfies Record<Capability,string>)
export const SNAPSHOT_PUSH='workday-v2:snapshot-changed'
export const WINDOW_VISIBILITY_PUSH='workday-v2:window-visibility-changed'
export const WINDOW_PRESENTATION_PUSH='workday-v2:window-presentation-changed'
export const OPEN_SETTINGS_PUSH='workday-v2:open-settings'
export function ipcFailure():Result<never>{return {ok:false,error:{code:'INTERNAL',message:'调用失败，未执行不安全操作。'}}}
// Validate the envelope as well as JSON transferability. Payload fields still
// belong to the fixed method's DTO, not a generic Electron transport surface.
export function readIpcResult<T>(input:unknown):Result<T>{
  const parsed=validateJsonDto(input)
  if(!parsed.ok||parsed.data===null||typeof parsed.data!=='object'||Array.isArray(parsed.data))return ipcFailure()
  const dto=parsed.data
  if(dto.ok===true&&Object.keys(dto).length===2&&Object.hasOwn(dto,'data'))return {ok:true,data:dto.data as T}
  if(dto.ok!==false||Object.keys(dto).length!==2||!Object.hasOwn(dto,'error'))return ipcFailure()
  const e=dto.error
  if(e===null||typeof e!=='object'||Array.isArray(e)||!ERROR_CODES.includes(e.code as ContractError['code']))return ipcFailure()
  const base={message:v.string(undefined,1024)}
  let error:Result<ContractError>
  if(e.code==='REVISION_CONFLICT')error=validateStructure(e,v.object({code:v.enum(['REVISION_CONFLICT'] as const),...base,expectedRevision:v.number(0,Number.MAX_SAFE_INTEGER),actualRevision:v.number(0,Number.MAX_SAFE_INTEGER)}))
  else if(e.code==='UNSUPPORTED_SCHEMA')error=validateStructure(e,v.object({code:v.enum(['UNSUPPORTED_SCHEMA'] as const),...base,received:v.number(0,Number.MAX_SAFE_INTEGER),supported:v.enum([2] as const),direction:v.enum(['legacy','future'] as const)}))
  else if(e.code==='VALIDATION')error=validateStructure(e,v.object({code:v.enum(['VALIDATION'] as const),...base,issues:v.array(v.object({field:v.string(undefined,512),reason:v.enum(['MISSING_FIELD','UNKNOWN_FIELD','TYPE','RANGE','ENUM','FORMAT','DUPLICATE','DANGEROUS_KEY','NOT_SERIALIZABLE','LIMIT'] as const),message:v.string(undefined,1024)}),0,50)}))
  else error=validateStructure(e,v.object({code:v.enum(['FORBIDDEN','IO_BUSY','IO_DENIED','CALENDAR_INCOMPLETE','CANCELLED','UNAVAILABLE','INTERNAL'] as const),...base}))
  return error.ok?{ok:false,error:error.data}:ipcFailure()
}
export function safeResult<T>(input:Result<T>):Result<T>{
  if(!input.ok){const e=input.error
    const message=e.code==='UNAVAILABLE'?'该能力尚未就绪、正式配置未初始化或状态不可用。':e.code==='CANCELLED'?'操作取消或任务失效。':e.code==='REVISION_CONFLICT'?'配置修订已改变，请重新读取。':e.code==='VALIDATION'?'请求或设置校验失败。':'操作失败，原有数据保留。'
    if(e.code==='REVISION_CONFLICT')return {ok:false,error:{code:e.code,message,expectedRevision:e.expectedRevision,actualRevision:e.actualRevision}}
    if(e.code==='UNSUPPORTED_SCHEMA')return {ok:false,error:{code:e.code,message,received:e.received,supported:e.supported,direction:e.direction}}
    if(e.code==='VALIDATION')return {ok:false,error:{code:e.code,message,issues:e.issues.map(i=>({field:i.field.startsWith('$')?i.field:'$',reason:i.reason,message:'字段校验失败。'}))}}
    return {ok:false,error:{code:ERROR_CODES.includes(e.code)?e.code:'INTERNAL',message}} as Result<T>
  }
  const json=validateJsonDto(input.data)
  return json.ok?{ok:true,data:json.data as T}:ipcFailure()
}
