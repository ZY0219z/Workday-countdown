import type { DashboardSnapshot, DataQuality } from '../../../shared/contracts'

export function durationText(seconds: number | null | undefined): string | null {
  if(typeof seconds!=='number'||!Number.isSafeInteger(seconds)||seconds<0)return null
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':')
}
export function wallLabel(instant: number, timeZone: string): { date: string; time: string } | null {
  try {const parts=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant)
    const part=(key:string)=>parts.find(item=>item.type===key)?.value??''
    return {date:`${part('year')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}`}
  } catch{return null}
}
export function qualityText(quality: DataQuality | undefined): string {
  if(!quality)return ''
  const source={userOverride:'自定义日期',annual:'官方年度安排',weekRule:'每周工作规则',currentSchedule:'当前工作制推算',clock:'本地日期/时钟'}[quality.source]
  return quality.approximate?(quality.incompleteYears.length?`${source} · ${quality.incompleteYears.join('、')}年度数据不完整，估算`:`${source} · 估算`):`${source}${quality.annualVerification==='verified'?' · 已核验年度':''}`
}
export function affectedWarnings(snapshot: DashboardSnapshot, field: DashboardSnapshot['warnings'][number]['affects'][number]): string {
  return snapshot.warnings.filter(warning=>warning.affects.includes(field)&&warning.code!=='CURRENT_RULE_ESTIMATE').map(warning=>warning.message).join('；')
}
