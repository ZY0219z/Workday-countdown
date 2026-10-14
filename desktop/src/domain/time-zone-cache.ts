import type { TimeZoneAdapter, LocalTimeResolution } from './time-zone'
import type { Result } from '../shared/contracts'
// Memoizes ONLY D03 inverse results, not another time-zone algorithm.
export function createTimeZoneCache(zones:TimeZoneAdapter,limit=4096):TimeZoneAdapter & {clear():void} {
  const cache=new Map<string,Result<LocalTimeResolution>>()
  return {project:zones.project,clear:()=>cache.clear(),resolve(local,zone){
    const key=JSON.stringify([local,zone]);let result=cache.get(key)
    if(!result){result=zones.resolve(local,zone);if(cache.size>=limit)cache.clear();cache.set(key,structuredClone(result))}
    return structuredClone(result)
  }}
}
