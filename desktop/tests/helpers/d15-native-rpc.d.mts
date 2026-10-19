import type {ChildProcess} from 'node:child_process'
import type {NativeExitState} from './d15-exit-verdict.mjs'
export interface NativeRpc {
  ready:Promise<{ready:true;identity:NativeExitState}>
  request(value:unknown):Promise<any>
  close():Promise<unknown>
  state():{phase:string;exitCode:number|null;signalCode:string|null;error:string|null;pending:number}
}
export function createNativeRpc(child:ChildProcess,options?:{timeoutMs?:number;readyTimeoutMs?:number;onRecord?:(event:unknown)=>void}):NativeRpc
export function within<T>(label:string,operation:()=>Promise<T>,milliseconds:number):Promise<T>
export function collectCleanup(steps:Array<{name:string;run:()=>Promise<unknown>;milliseconds:number}>,onFailure?:(name:string,error:unknown)=>void):Promise<Array<{step:string;message:string}>>
