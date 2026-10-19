import { createHash } from 'node:crypto'
import type { AppConfig, ConfigSnapshot, ContractRequests, JsonObject, Result, SettingsDraftSession, SnapshotWarning } from '../../shared/contracts'
import { success, validateStructure, v } from '../../shared/validation'
import { validateDraftFields, editableConfigValidator } from '../../shared/config-schema'
import { checkExpectedRevision, validateContractRequest } from '../../shared/capabilities'
import { createSettingsDraft, updateSettingsDraft, beginDraftSave, finishDraftSave, prepareDraftSave } from '../../shared/settings-draft'
import { createDashboardEngine } from '../../domain/dashboard'
import type { ConfigValidationContext } from './config-validation'
import type { ConfigStore, ConfigLoadState } from './config-store'
import type { MigrationService } from './migration-service'
import { createSnapshotService } from './snapshot-service'
import { createRefreshCoordinator, type TimerPort } from './clock'
import type { ExitDraftAdapter, ExitChoice } from '../lifecycle/quit-coordinator'
import type { createOperationBarrier } from '../lifecycle/operation-barrier'
import type { SnapshotService } from './snapshot-service'
import type { RefreshCoordinator } from './clock'
import { createDefaultAppConfig } from '../../shared/config-schema'
import { editableConfig } from './config-validation'
import { createCalendar } from '../../domain/calendar'
import { currentOvertimeShift, expectedEndOvertime, shiftEndLabel } from '../../domain/expected-end'
import type { EditableConfig, ExpectedEndContext, WindowBounds } from '../../shared/contracts'
export interface Runtime {
  snapshots:SnapshotService;refresh:RefreshCoordinator
  start():Promise<Result<null>>;readConfig():Result<ConfigSnapshot>;readDraft():Result<SettingsDraftSession>
  updateDraft(request:ContractRequests['settingsDraft.update']):Result<SettingsDraftSession>
  setExpectedEnd(request:ContractRequests['settingsDraft.setExpectedEnd']):Result<SettingsDraftSession>
  discardDraft():Result<SettingsDraftSession>;save(request:ContractRequests['config.save']):Promise<Result<ConfigSnapshot>>
  acknowledgeTrayNotice():void
  stageMiniBounds(bounds:WindowBounds):Result<null>
  onConfigSaved(listener:()=>void):()=>void
  applyImport(request:ContractRequests['data.applyImport']):Promise<Result<ConfigSnapshot>>
  previewImport(request:ContractRequests['data.previewImport']):Promise<Result<import('../../shared/contracts').ImportPreview>>
  previewRecovery():Promise<Result<import('../../shared/contracts').ImportPreview>>
  cancelImport(token:string):Result<null>
  calendarMetadata():Result<import('../../shared/contracts').CalendarDatasetMetadata[]>
  exportConfig():Promise<Result<null>>;exitAdapter:ExitDraftAdapter;dispose():void
}

const unavailable=<T>(message='正式配置尚未初始化或不可用。'):Result<T>=>({ok:false,error:{code:'UNAVAILABLE',message}})
const empty=():SettingsDraftSession=>({saved:null,draft:{},dirty:false,issues:[],expectedRevision:0,save:{status:'idle'}})
const clone=<T>(value:T):T=>structuredClone(value)
export function createRuntime(options:ConfigValidationContext & {store:ConfigStore;migration?:MigrationService;writes:ReturnType<typeof createOperationBarrier>;timers?:TimerPort;confirm:()=>Promise<Result<ExitChoice>>;maxHistoryDays:number;initializeDefaults?:{appVersion:string}}) {
  let config:ConfigSnapshot|null=null,state:ConfigLoadState|null=null,draft:SettingsDraftSession=empty(),busy=false,disposed=false,calendarRevision=0,calendarKey=''
  let defaultSettings:import('../../shared/contracts').EditableConfig|null=null,defaultPersistence:SettingsDraftSession['defaultPersistence']|null=null
  let defaultTask:ReturnType<typeof setImmediate>|null=null
  let expectedEndEdit:SettingsDraftSession['expectedEndEdit']|null=null
  // Main-only acknowledgement. Persist with the next normal, revision-checked
  // save, never issue an independent write over a renderer's unsynced draft.
  let trayNoticePending=false
  let pendingMiniBounds:WindowBounds|null=null
  const savedListeners=new Set<()=>void>()
  const snapshots=createSnapshotService(options.clock,c=>{
    const engine=createDashboardEngine(c,options.calendars,options.zones,options.maxHistoryDays)
    if(!engine.ok)return engine
    return success({invalidate:engine.data.invalidate,calculate(now){
      const result=engine.data.calculate(now)
      if(result.ok&&state?.status==='recoverable')return success({...result.data,state:'incomplete' as const,warnings:[...result.data.warnings,{code:'CONFIG_INCOMPLETE' as const,message:'正在只读使用有效备份，恢复仍须确认。',affects:['employment','nextRest','salary','activeShift','countdown','progress'] as SnapshotWarning['affects'],years:[]}]})
      return result
    }})
  })
  const refresh=createRefreshCoordinator(snapshots,options.timers)
  const identity=()=>createHash('sha256').update(JSON.stringify([draft.saved?.revision??0,draft.draft,draft.save.status,expectedEndEdit])).digest('hex')
  const dirty=()=>draft.dirty||expectedEndEdit!==null
  function overtimeTarget(settings:EditableConfig){
    const now=options.clock.read();if(!now.ok)return now
    const years=[]
    for(const year of settings.calendar.enabledYears){const loaded=options.calendars.readYear(year);if(!loaded.ok)return loaded;if(loaded.data)years.push(loaded.data)}
    const calendar=createCalendar({workWeek:settings.schedule.workWeek,overrides:settings.calendar.overrides},years);if(!calendar.ok)return calendar
    const context={calendar:calendar.data,zones:options.zones,timeZoneId:now.data.timeZoneId}
    const shift=currentOvertimeShift(settings,now.data,context);if(!shift.ok)return shift
    const normalEnd=shiftEndLabel(shift.data.normalEndsAt,context),finalEnd=shiftEndLabel(shift.data.finalEndsAt,context)
    if(!normalEnd.ok)return normalEnd;if(!finalEnd.ok)return finalEnd
    const targetKey=createHash('sha256').update(JSON.stringify([config?.config.revision??0,shift.data.shiftDate,now.data.timeZoneId])).digest('hex')
    return success({shift:shift.data,context,view:{available:true as const,targetKey,shiftDate:shift.data.shiftDate,normalEnd:normalEnd.data,finalEnd:finalEnd.data,minutes:shift.data.overtimeMinutes}})
  }
  function expectedEndContext():ExpectedEndContext{
    const settings=validateStructure(draft.draft,editableConfigValidator)
    if(!settings.ok)return {available:false,message:'请先填写有效的工作时间和日期设置，再调整今天预计下班。'}
    const target=overtimeTarget(settings.data)
    if(!target.ok)return {available:false,message:target.error.message}
    const view:Extract<ExpectedEndContext,{available:true}>=target.data.view
    if(expectedEndEdit&&expectedEndEdit.targetKey!==view.targetKey)return {available:false,message:'班次或时区已变化，保留了旧班次未保存输入；请通过取消/返回明确放弃后重新填写。'}
    if(expectedEndEdit?.targetKey===view.targetKey){
      const preview=expectedEndOvertime(settings.data,target.data.shift,expectedEndEdit.input,target.data.context)
      if(preview.ok){const minutes=preview.data.entries.find(entry=>entry.shiftDate===view.shiftDate)?.minutes??0
        const label=shiftEndLabel(target.data.shift.normalEndsAt+minutes*60_000,target.data.context);if(label.ok)view.previewEnd=label.data}
    }
    return view
  }
  function setSnapshot(value:AppConfig):Result<null>{
    const key=JSON.stringify([value.calendar,value.schedule.workWeek])
    if(key!==calendarKey){calendarRevision++;calendarKey=key}
    return snapshots.setConfig(value,calendarRevision)
  }
  function initialDraft():SettingsDraftSession{return defaultSettings?{...empty(),draft:clone(defaultSettings) as unknown as JsonObject}:empty()}
  function accept(value:ConfigSnapshot):Result<null>{
    const next=createSettingsDraft(value.config);if(!next.ok)return next
    const changed=setSnapshot(value.config)
    config=clone(value);draft=next.data
    if(value.config.desktop.tray.firstHideNoticeAcknowledged)trayNoticePending=false
    defaultSettings=null;defaultPersistence=null
    expectedEndEdit=null
    if(!changed.ok)config.warnings.push({field:'$.snapshot',reason:'FORMAT',message:'配置已保存，但快照准备不可用；没有保留旧有效快照。'})
    for(const listener of savedListeners)try{listener()}catch{/* A window cannot invalidate a completed safe save. */}
    return success(null)
  }
  const methods:Runtime={
    snapshots,refresh,
    acknowledgeTrayNotice(){if(!disposed)trayNoticePending=true},
    onConfigSaved(listener){if(!disposed)savedListeners.add(listener);return()=>{savedListeners.delete(listener)}},
    stageMiniBounds(bounds){if(disposed)return unavailable();const valid=validateStructure(bounds,v.object<WindowBounds>({x:v.number(-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),y:v.number(-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),width:v.number(1,10000),height:v.number(1,10000)}));if(!valid.ok)return valid;pendingMiniBounds=valid.data;return success(null)},
    async start():Promise<Result<null>>{
      const loaded=await options.store.load();if(!loaded.ok)return loaded;state=loaded.data
      if(state.config){const read=await options.store.read();if(!read.ok)return read;const applied=accept(read.data);if(!applied.ok)return applied}
      else if(state.status==='missing'&&options.initializeDefaults){
        const now=options.clock.read();if(!now.ok)return now
        const defaults=createDefaultAppConfig({updatedAt:new Date(now.data.instant).toISOString(),appVersion:options.initializeDefaults.appVersion},options.calendars.listMetadata())
        if(!defaults.ok)return defaults
        const settings=editableConfig(defaults.data);if(!settings.ok)return settings
        defaultSettings=settings.data;draft=initialDraft();defaultPersistence={status:'pending'}
        const prepared=setSnapshot(defaults.data);if(!prepared.ok)return prepared
        busy=true
        defaultTask=setImmediate(async()=>{
          defaultTask=null;if(disposed)return
          try{
            const saved=await options.writes.run(()=>options.store.initializeSettings(settings.data))
            if(saved.ok){state={status:'ready',config:saved.data.config};const applied=accept(saved.data);if(!applied.ok)defaultPersistence={status:'failed',error:applied.error}}
            else defaultPersistence={status:'failed',error:saved.error}
          }catch{defaultPersistence={status:'failed',error:{code:'INTERNAL',message:'默认设置未保存，本次仍可使用；请到设置中重试。'}}}
          finally{busy=false;refresh.wake(true)}
        })
      }
      refresh.start();return success(null)
    },
    readConfig():Result<ConfigSnapshot>{return config?success(clone(config)):state?.status==='future'?{ok:false,error:state.error}:unavailable(state?.status==='missing'?'正式配置尚未初始化；必须显式提供完整设置并保存。':'正式配置无效或未加载，未自动覆盖。')},
    readDraft():Result<SettingsDraftSession>{return disposed?unavailable():success(clone({...draft,dirty:dirty(),expectedEnd:expectedEndContext(),...(expectedEndEdit?{expectedEndEdit}:{}),configurationStatus:state?.status??'unloaded',...(defaultPersistence?{defaultPersistence}:{})}))},
    setExpectedEnd(request:ContractRequests['settingsDraft.setExpectedEnd']):Result<SettingsDraftSession>{
      const checked=validateContractRequest('main','settingsDraft.setExpectedEnd',request);if(!checked.ok)return checked
      if(busy||disposed)return unavailable('设置正在保存或服务已退出。')
      const revision=checkExpectedRevision(checked.data.expectedRevision,config?.config.revision??0);if(!revision.ok)return revision
      const context=expectedEndContext()
      if(!context.available)return unavailable(context.message)
      if(checked.data.targetKey!==context.targetKey)return unavailable('当前班次或时区已变化，未应用旧输入；请放弃旧草稿后重新填写。')
      expectedEndEdit={targetKey:context.targetKey,input:checked.data.input}
      return methods.readDraft()
    },
    updateDraft(request:ContractRequests['settingsDraft.update']):Result<SettingsDraftSession>{
      if(busy||disposed)return unavailable('设置正在保存或服务已退出。')
      const revision=checkExpectedRevision(request.expectedRevision,config?.config.revision??0);if(!revision.ok)return revision
      const parsed=validateDraftFields(request.draft);if(!parsed.ok)return parsed
      if(draft.saved){const updated=updateSettingsDraft(draft as import('../../shared/contracts').DraftState,parsed.data);if(!updated.ok)return updated;draft=updated.data}
      else {
        const fields=validateContractRequest('main','config.save',{settings:parsed.data,expectedRevision:0})
        draft={...empty(),draft:parsed.data,dirty:Object.keys(parsed.data).length>0,issues:!fields.ok&&fields.error.code==='VALIDATION'?fields.error.issues:[]}
      }
      return methods.readDraft()
    },
    discardDraft():Result<SettingsDraftSession>{
      if(busy||disposed)return unavailable('保存未结束，不能放弃。')
      const next=config?createSettingsDraft(config.config):success(initialDraft());if(!next.ok)return next;draft=next.data;expectedEndEdit=null;return methods.readDraft()
    },
    async save(request:ContractRequests['config.save']):Promise<Result<ConfigSnapshot>>{
      const valid=validateContractRequest('main','config.save',request);if(!valid.ok)return valid
      if(busy||disposed)return unavailable('设置正在保存或服务已退出。')
      const revision=checkExpectedRevision(valid.data.expectedRevision,config?.config.revision??0);if(!revision.ok)return revision
      if(trayNoticePending)valid.data.settings.desktop.tray.firstHideNoticeAcknowledged=true
      const geometry=pendingMiniBounds
      if(geometry)valid.data.settings.desktop.bounds.mini=clone(geometry)
      if(expectedEndEdit){
        const target=overtimeTarget(valid.data.settings);if(!target.ok)return target
        if(target.data.view.targetKey!==expectedEndEdit.targetKey)return unavailable('当前班次或时区已变化，未应用旧输入；请放弃旧草稿后重新填写。')
        const converted=expectedEndOvertime(valid.data.settings,target.data.shift,expectedEndEdit.input,target.data.context)
        if(!converted.ok)return converted
        valid.data.settings.overtime=converted.data
      }
      const edit=methods.updateDraft({draft:valid.data.settings as unknown as JsonObject,expectedRevision:valid.data.expectedRevision});if(!edit.ok)return edit
      if(draft.saved){const begin=beginDraftSave(draft as import('../../shared/contracts').DraftState,config!.config.revision);if(!begin.ok)return begin;draft=begin.data}else draft.save={status:'saving'}
      busy=true
      try{
        const result=await options.writes.run(()=>config?options.store.save(valid.data):options.store.initializeSettings(valid.data.settings))
        if(result.ok){state={status:'ready',config:result.data.config};if(pendingMiniBounds===geometry)pendingMiniBounds=null;const applied=accept(result.data);if(!applied.ok)return applied;draft.save={status:'saved',revision:result.data.config.revision};refresh.wake();return methods.readConfig()}
        if(draft.saved){const finished=finishDraftSave(draft as import('../../shared/contracts').DraftState,result);if(finished.ok)draft=finished.data}
        else {draft.save={status:'failed',error:result.error};if(result.error.code==='VALIDATION')draft.issues=result.error.issues}
        return result
      }catch{
        const failure:Result<never>={ok:false,error:{code:'INTERNAL',message:'保存服务异常，草稿保留；请重新读取确认文件状态。'}}
        if(draft.saved){const finished=finishDraftSave(draft as import('../../shared/contracts').DraftState,failure);if(finished.ok)draft=finished.data}
        else draft.save={status:'failed',error:failure.error}
        return failure
      }finally{busy=false}
    },
    async applyImport(request:ContractRequests['data.applyImport']):Promise<Result<ConfigSnapshot>>{
      if(!options.migration)return unavailable('可信文件选择与导入来源尚未接入。')
      if(busy||dirty()||disposed)return unavailable('请先保存或明确放弃当前草稿。')
      busy=true;try{const result=await options.writes.run(()=>options.migration!.apply(request));if(result.ok){if(request.selectedFields.includes('desktop.bounds'))pendingMiniBounds=null;state={status:'ready',config:result.data.config};const applied=accept(result.data);if(!applied.ok)return applied;refresh.wake(true);return methods.readConfig()}return result}finally{busy=false}
    },
    previewImport:(request:ContractRequests['data.previewImport'])=>options.migration?options.migration.preview(request):Promise.resolve(unavailable<import('../../shared/contracts').ImportPreview>('可信文件选择尚未接入；未读取或导入任何来源。')),
    previewRecovery:()=>options.migration?options.migration.previewRecovery():Promise.resolve(unavailable('备份恢复服务未接入。')),
    cancelImport:token=>options.migration?options.migration.cancel(token):unavailable(),
    calendarMetadata:()=>success(options.calendars.listMetadata()),
    exportConfig:()=>options.migration?options.migration.exportConfig():Promise.resolve(unavailable<null>('可信导出目标选择尚未接入。')),
    exitAdapter: {
      async read(){return success({dirty:dirty(),saving:busy||draft.save.status==='saving',identity:identity()})},
      confirm:options.confirm,
      async save(expected:string):Promise<Result<null>>{
        if(identity()!==expected)return unavailable('草稿已改变，请重新确认。')
        let request:ContractRequests['config.save']
        if(draft.saved){const ready=prepareDraftSave(draft as import('../../shared/contracts').DraftState,config!.config.revision);if(!ready.ok)return ready;request=ready.data}
        else {const ready=validateContractRequest('main','config.save',{settings:draft.draft,expectedRevision:0});if(!ready.ok)return ready;request=ready.data}
        const saved=await methods.save(request);return saved.ok?success(null):saved
      },
      async discard(expected:string){if(identity()!==expected)return unavailable<null>('草稿已改变，未放弃。');const discarded=methods.discardDraft();return discarded.ok?success(null):discarded}
    } satisfies ExitDraftAdapter,
    dispose(){disposed=true;savedListeners.clear();if(defaultTask)clearImmediate(defaultTask);refresh.dispose();snapshots.dispose()}
  }
  return methods
}

// One D08 coordinator, two isolated data domains. No forged clean POC state.
export function combineExitDrafts(formal:ExitDraftAdapter,poc:ExitDraftAdapter):ExitDraftAdapter {
  let last:{formal:import('../lifecycle/quit-coordinator').ExitDraft;poc:import('../lifecycle/quit-coordinator').ExitDraft}|null=null
  const key=()=>JSON.stringify([last?.formal.identity,last?.poc.identity])
  return {async read(){const a=await formal.read(),b=await poc.read();if(!a.ok)return a;if(!b.ok)return b;last={formal:a.data,poc:b.data};return success({dirty:a.data.dirty||b.data.dirty,saving:a.data.saving||b.data.saving,identity:key()})},
    confirm:formal.confirm,
    async save(expected){if(!last||key()!==expected)return unavailable('退出草稿已变化。');const p=last.poc.dirty?await poc.save(last.poc.identity):success(null);if(!p.ok)return p;return last.formal.dirty?formal.save(last.formal.identity):success(null)},
    async discard(expected){if(!last||key()!==expected)return unavailable('退出草稿已变化。');const p=last.poc.dirty?await poc.discard(last.poc.identity):success(null);if(!p.ok)return p;return last.formal.dirty?formal.discard(last.formal.identity):success(null)} }
}
