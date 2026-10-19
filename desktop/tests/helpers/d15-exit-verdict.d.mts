export interface NativeExitState {pid:number;createdFileTime:string;exited:boolean;exitCode:number|null}
export function verifyOwnedExit(launcher:{exitCode:number|null;signalCode:string|null}|undefined,main:NativeExitState|null,expected:NativeExitState|undefined):{status:'PASS'|'FAIL';issues:string[]}
