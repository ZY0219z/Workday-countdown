import type { Capability, ContractRequests, ContractResponses, Result, WindowRole } from '../../shared/contracts'
import { validateContractRequest } from '../../shared/capabilities'
import { V2_CHANNELS, SNAPSHOT_PUSH, safeResult, ipcFailure } from '../../shared/ipc'
import type { Runtime } from '../services/runtime'
export interface IpcEvent {sender:object;senderFrame:unknown}
export interface RegisteredWindow {
  sender:object;frame:()=>unknown;url:()=>string;destroyed:()=>boolean;visible:()=>boolean;push:(channel:string,result:unknown)=>void
}
export interface IpcPort {handle(channel:string,callback:(event:IpcEvent,input:unknown)=>Promise<unknown>):void;removeHandler(channel:string):void}
export function createIpcRouter(ipc:IpcPort,runtime:Runtime,operations:{window:(request:ContractRequests['window.perform'])=>Result<null>;quit:()=>Promise<Result<null>>}) {
  const windows=new Map<object,{role:WindowRole;port:RegisteredWindow;url:string}>();let disposed=false
  function release(sender:object){runtime.refresh.unsubscribe(sender);windows.delete(sender)}
  function identify(event:IpcEvent){try{const known=windows.get(event.sender);return known&&!known.port.destroyed()&&event.senderFrame&&event.senderFrame===known.port.frame()&&known.port.url()===known.url?known:null}catch{return null}}
  async function invoke<K extends Capability>(method:K,event:IpcEvent,input:unknown):Promise<Result<ContractResponses[K]>>{
    const known=identify(event);if(!known||disposed)return {ok:false,error:{code:'FORBIDDEN',message:'非法窗口或主Frame来源。'}}
    const request=validateContractRequest(known.role,method,input);if(!request.ok)return safeResult(request)
    try{
      let result:Result<unknown>
      switch(method){
        case 'config.read':result=runtime.readConfig();break
        case 'config.save':result=await runtime.save(request.data as ContractRequests['config.save']);break
        case 'settingsDraft.read':result=runtime.readDraft();break
        case 'settingsDraft.update':result=runtime.updateDraft(request.data as ContractRequests['settingsDraft.update']);break
        case 'settingsDraft.discard':result=runtime.discardDraft();break
        case 'settingsDraft.setExpectedEnd':result=runtime.setExpectedEnd(request.data as ContractRequests['settingsDraft.setExpectedEnd']);break
        case 'snapshot.read':result=await runtime.snapshots.read();break
        case 'snapshot.subscribe':runtime.refresh.subscribe(event.sender,{visible:known.port.visible,push:value=>{if(identify(event)===known)known.port.push(SNAPSHOT_PUSH,safeResult(value));else runtime.refresh.unsubscribe(event.sender)}});result={ok:true,data:null};break
        case 'snapshot.unsubscribe':runtime.refresh.unsubscribe(event.sender);result={ok:true,data:null};break
        case 'window.perform':result=operations.window(request.data as ContractRequests['window.perform']);break
        case 'app.quit':result=await operations.quit();break
        case 'data.previewImport':result=await runtime.previewImport(request.data as ContractRequests['data.previewImport']);break
        case 'data.applyImport':result=await runtime.applyImport(request.data as ContractRequests['data.applyImport']);break
        case 'data.previewRecovery':result=await runtime.previewRecovery();break
        case 'data.cancelImport':result=runtime.cancelImport((request.data as ContractRequests['data.cancelImport']).previewToken);break
        case 'calendar.readMetadata':result=runtime.calendarMetadata();break
        case 'data.export':result=await runtime.exportConfig();break
        default:result={ok:false,error:{code:'UNAVAILABLE',message:'年度导入底层尚未实现。'}}
      }
      return safeResult(result) as Result<ContractResponses[K]>
    }catch{return ipcFailure()}
  }
  for(const method of Object.keys(V2_CHANNELS) as Capability[])ipc.handle(V2_CHANNELS[method],(event,input)=>invoke(method,event,input))
  return {register(role:WindowRole,port:RegisteredWindow,exactUrl:string){if(disposed||windows.has(port.sender)||!exactUrl)throw new Error('Window registration invalid');windows.set(port.sender,{role,port,url:exactUrl});return()=>release(port.sender)},
    revokeSubscription(sender:object){runtime.refresh.unsubscribe(sender)},
    visibilityChanged:runtime.refresh.visibilityChanged,
    dispose(){if(disposed)return;disposed=true;for(const sender of windows.keys())release(sender);for(const channel of Object.values(V2_CHANNELS))ipc.removeHandler(channel)} }
}
