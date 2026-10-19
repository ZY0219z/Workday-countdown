export interface ResourceSummary {
  status:'COMPLETE'|'INCOMPLETE';scope:string;logicalCores:number;warmupSeconds:number;sampleSeconds:number;sampleCount:number;validSamples:number;processIdentities:number
  events:Array<{event:string;key:string;pid:number}>;issues:string[];meanCpuPercent:number|null;p95CpuPercent:number|null
  pws:{minMiB:number;meanMiB:number;maxMiB:number;first30MeanMiB:number;last30MeanMiB:number;changePercent:number|null}|null
  completeness:string;environment:unknown;samples:Array<{elapsedSeconds:number;intervalSeconds:number;valid:boolean;cpuPercent:number|null;pwsMiB:number|null}>
}
export function summarizeResourceLog(text:string):ResourceSummary
