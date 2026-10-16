import type { Capability, ContractRequests, ContractResponses, MainWindowApi, MiniWindowApi, Result, DashboardSnapshot, WindowVisibility } from './contracts'
import { CONTRACT_VERSION } from './contracts'
import { V2_CHANNELS, SNAPSHOT_PUSH, WINDOW_VISIBILITY_PUSH, OPEN_SETTINGS_PUSH, ipcFailure,readIpcResult } from './ipc'
import { validateStructure, v } from './validation'
export interface BridgeTransport {invoke(channel:string,input:unknown):Promise<unknown>;listen(channel:string,listener:(payload:unknown)=>void):()=>void}
export function createV2Bridge(role:'main',transport:BridgeTransport):MainWindowApi
export function createV2Bridge(role:'mini',transport:BridgeTransport):MiniWindowApi
export function createV2Bridge(role:'main'|'mini',transport:BridgeTransport):MainWindowApi|MiniWindowApi {
  async function call<K extends Capability>(method:K,input:ContractRequests[K]):Promise<Result<ContractResponses[K]>>{
    try{return readIpcResult<ContractResponses[K]>(await transport.invoke(V2_CHANNELS[method],input))}catch{return ipcFailure()}
  }
  const listeners=new Set<(result:Result<DashboardSnapshot>)=>void>();let unlisten:(()=>void)|null=null,queue:Promise<unknown>=Promise.resolve()
  const serial=<T>(fn:()=>Promise<T>):Promise<T>=>{const job=queue.then(fn);queue=job.catch(()=>{});return job}
  function detach(){const release=unlisten;unlisten=null;try{release?.();return true}catch{return false}}
  const visibilityListeners=new Set<(result:Result<WindowVisibility>)=>void>();let stopVisibility:(()=>void)|null=null,visibilitySequence=-1
  function visibilityResult(payload:unknown):Result<WindowVisibility>{const result=readIpcResult<unknown>(payload);return result.ok?validateStructure(result.data,v.object<WindowVisibility>({visible:v.boolean,sequence:v.number(1,Number.MAX_SAFE_INTEGER)})):result}
  function emitVisibility(result:Result<WindowVisibility>){if(result.ok){if(result.data.sequence<=visibilitySequence)return;visibilitySequence=result.data.sequence}for(const listener of visibilityListeners)try{listener(result)}catch{/* Consumer isolation. */}}
  const common={contractVersion:CONTRACT_VERSION,role,
    snapshot:Object.freeze({read:()=>call('snapshot.read',null),subscribe:(listener:(result:Result<DashboardSnapshot>)=>void)=>serial(async()=>{
      if(typeof listener!=='function')return ipcFailure()
      if(listeners.has(listener))return {ok:true as const,data:null}
      listeners.add(listener)
      if(!unlisten){
        try{unlisten=transport.listen(SNAPSHOT_PUSH,payload=>{const dto=readIpcResult<DashboardSnapshot>(payload);for(const current of listeners)try{current(dto)}catch{/* Consumer isolation. */}})}catch{listeners.clear();return ipcFailure()}
        const result=await call('snapshot.subscribe',null);if(!result.ok){listeners.clear();detach()}return result}
      return {ok:true as const,data:null}
    }),unsubscribe:()=>serial(async()=>{listeners.clear();const removed=detach(),result=await call('snapshot.unsubscribe',null);return removed?result:ipcFailure()})}),
    app:Object.freeze({quit:()=>call('app.quit',null)}),window:Object.freeze({perform:(request:ContractRequests['window.perform'])=>call('window.perform',request),
      readVisibility:async()=>visibilityResult(await call('window.readVisibility',null)),
      subscribeVisibility:(listener:(result:Result<WindowVisibility>)=>void)=>serial(async()=>{
        if(typeof listener!=='function')return ipcFailure();visibilityListeners.add(listener)
        try{if(!stopVisibility)stopVisibility=transport.listen(WINDOW_VISIBILITY_PUSH,payload=>emitVisibility(visibilityResult(payload)))
          const result=visibilityResult(await call('window.readVisibility',null));emitVisibility(result);if(!result.ok){visibilityListeners.clear();const stop=stopVisibility;stopVisibility=null;stop?.();return result}return {ok:true as const,data:null}
        }catch{visibilityListeners.clear();const stop=stopVisibility;stopVisibility=null;try{stop?.()}catch{}return ipcFailure()}
      }),
      unsubscribeVisibility:()=>serial(async()=>{visibilityListeners.clear();visibilitySequence=-1;const stop=stopVisibility;stopVisibility=null;try{stop?.();return {ok:true as const,data:null}}catch{return ipcFailure()}})
    })}
  if(role==='mini')return Object.freeze({...common,role:'mini'})
  return Object.freeze({...common,role:'main',
    window:Object.freeze({...common.window,onOpenSettings(listener:()=>void){
      if(typeof listener!=='function')return()=>{}
      return transport.listen(OPEN_SETTINGS_PUSH,payload=>{const result=readIpcResult<unknown>(payload);if(result.ok&&validateStructure(result.data,v.object({action:v.enum(['openSettings'] as const)})).ok)try{listener()}catch{/* Consumer isolation. */}})
    }}),
    config:Object.freeze({read:()=>call('config.read',null),save:(request:ContractRequests['config.save'])=>call('config.save',request)}),
    settingsDraft:Object.freeze({read:()=>call('settingsDraft.read',null),update:(request:ContractRequests['settingsDraft.update'])=>call('settingsDraft.update',request),discard:()=>call('settingsDraft.discard',null),setExpectedEnd:(request:ContractRequests['settingsDraft.setExpectedEnd'])=>call('settingsDraft.setExpectedEnd',request)}),
    data:Object.freeze({previewRecovery:()=>call('data.previewRecovery',null),cancelImport:(request:ContractRequests['data.cancelImport'])=>call('data.cancelImport',request),previewImport:(request:ContractRequests['data.previewImport'])=>call('data.previewImport',request),applyImport:(request:ContractRequests['data.applyImport'])=>call('data.applyImport',request),export:(request:ContractRequests['data.export'])=>call('data.export',request)}),
    calendar:Object.freeze({readMetadata:()=>call('calendar.readMetadata',null),previewImport:()=>call('calendar.previewImport',null),applyImport:(request:ContractRequests['calendar.applyImport'])=>call('calendar.applyImport',request)})})
}
