export interface ResourceSummary {
  status:'COMPLETE'|'INCOMPLETE';scope:string;logicalCores:number;warmupSeconds:number;sampleSeconds:number;sampleCount:number;validSamples:number;processIdentities:number
  events:Array<{event:string;key:string;pid:number}>;issues:string[];meanCpuPercent:number|null;p95CpuPercent:number|null
  pws:{minMiB:number;meanMiB:number;maxMiB:number;first30MeanMiB:number;last30MeanMiB:number;changePercent:number|null}|null
  completeness:string;environment:unknown;samples:Array<{elapsedSeconds:number;intervalSeconds:number;valid:boolean;cpuPercent:number|null;pwsMiB:number|null}>
}
export function summarizeResourceLog(text:string):ResourceSummary
// Separate diagnostic completeness; this does not grant resource/G05 PASS.
export function inspectSamplingTiming(text:string):{
  status:'COMPLETE'|'INCOMPLETE'|'NOT_AVAILABLE';issues:string[]
  identities:Array<{key:string;queryId:number;capture:unknown;exit:unknown;pwsQueries:unknown[];note:string}>;queries:unknown[]
}
export interface MetricObservation {at:number;metrics:Array<{pid:number;creationTime:number;type:string}>}
export function verifyMetricCoverage(text:string,observations:MetricObservation[]):{
  status:'COMPLETE'|'INCOMPLETE';observedIdentities:number;scope:string;issues:string[]
  missing:Array<{pid:number;creationTime:number|null;type:string;reason:string;firstSeenAt:number;lastSeenAt:number}>
}
