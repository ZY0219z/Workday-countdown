type Outcome={ok:boolean;error?:unknown}
export function newResourceRunDirectories(before:string[],after:string[],started:boolean):string[]
export function prepareResourceMain(port:{closeMain():Promise<Outcome>;confirmHide():Promise<unknown>;assertTrayOnly():Promise<unknown>;showMain():Promise<Outcome>;assertMain():Promise<unknown>;record(event:string,data?:unknown):void}):Promise<void>
export function resourceModeIssues(point:{trayAvailable:boolean;windows:Array<{id:number;visible:boolean;minimized:boolean}>;subscribers:number},mode:'main'|'mini'|'tray',expectedId?:number):string[]
export interface ResourceInputActivity {streak:number;startedAt:number|null}
export function classifyResourceInput(current:{at:number;lastInputTick:number;foreground:{pid:number;name?:string|null}},previous:{lastInputTick:number},activity?:ResourceInputActivity):{changed:boolean;activity:ResourceInputActivity;stopReasons:string[];uncertainReasons:string[]}
