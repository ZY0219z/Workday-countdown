import type { BusinessState } from '../../../shared/contracts'

// Presentation geometry only. Never infer work duration or progress from time.
export function progressRatio(percent:number|null|undefined):number|null {
  return typeof percent==='number'&&Number.isFinite(percent)?Math.min(100,Math.max(0,percent))/100:null
}
export function fishPosition(percent:number|null|undefined,trackWidth:number,fishWidth:number):number|null {
  const ratio=progressRatio(percent)
  return ratio===null||!Number.isFinite(trackWidth)||!Number.isFinite(fishWidth)||trackWidth<0||fishWidth<0?null:ratio*Math.max(0,trackWidth-fishWidth)
}
export function fishCanAnimate(state:BusinessState|undefined,percent:number|null|undefined,allowed:boolean):boolean {
  return allowed&&progressRatio(percent)!==null&&(state==='working'||state==='overtime')
}
