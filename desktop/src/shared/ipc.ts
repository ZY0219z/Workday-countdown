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
// Only these static business messages may cross the IPC boundary. Unrecognized
// validation text, exception details and paths retain the default redaction.
const overtimeMessages = new Set([
  '请输入24小时制HH:MM（00:00–23:59），例如19:00。',
  '当前结束时刻不能用整分钟准确表示，未作自动推算。',
  '预计结束时刻存在DST重复或缺失，不能自动选择。请填写可明确解析的时间。',
  '加班结束时间无法在当前时区按整分钟保存，请重新选择。',
  '加班时间与相邻工作班次重叠，请重新选择。',
  '休息日无有效排班，不能创建常规加班班次。',
  '班次存在DST歧义，候选修改未获应用。',
  '邻班边界存在DST歧义，无法确认无冲突。'
])
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
    if(e.code==='VALIDATION') {
      const issues=e.issues.map(i=>{
        const overtimeRange=i.reason==='RANGE'&&/^\$\.(?:settings\.)?(?:overtime\.)?entries\[\d+\]\.minutes$/.test(i.field)
        const known=(i.field==='$.expectedEndTime'||i.field==='$.shiftDate')&&overtimeMessages.has(i.message)
        return {field:i.field.startsWith('$')?i.field:'$',reason:i.reason,
          message:overtimeRange?'加班时长超出可保存范围，请重新选择。':known?i.message:'字段校验失败。'}
      })
      return {ok:false,error:{code:e.code,message:issues.find(i=>i.message!=='字段校验失败。')?.message??message,issues}}
    }
    if(e.code==='UNAVAILABLE'&&e.message==='当前班次或时区已变化，未应用旧输入；请放弃旧草稿后重新填写。') {
      return {ok:false,error:{code:e.code,message:'当前班次已变化，请重新设置加班时间。'}}
    }
    return {ok:false,error:{code:ERROR_CODES.includes(e.code)?e.code:'INTERNAL',message}} as Result<T>
  }
  const json=validateJsonDto(input.data)
  return json.ok?{ok:true,data:json.data as T}:ipcFailure()
}
