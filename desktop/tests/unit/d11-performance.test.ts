import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createIntlTimeZoneAdapter} from '../../src/adapters/intl-time-zone'
import {createTimeZoneCache} from '../../src/domain/time-zone-cache'
import {createFixedClock} from '../../src/domain/clock'
import {createDefaultAppConfig} from '../../src/shared/config-schema'
import {createConfigStore} from '../../src/main/services/config-store'
import {loadBundledCalendarStore} from '../../src/main/services/calendar-store'
import {editableConfig} from '../../src/main/services/config-validation'
import {value} from './config-fixtures'

// Explicit performance entry, not a portable/GUI/G05 benchmark. Own temp only.
test('Shanghai cold defaults and ordinary save retain bounded Main event-loop responsiveness',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'workday-d11-performance-')),native=createIntlTimeZoneAdapter()
  let resolveCalls=0,resolveMs=0,largestStall=0,last=performance.now()
  const zones=createTimeZoneCache({project:native.project,resolve(...args){resolveCalls++;const start=performance.now();try{return native.resolve(...args)}finally{resolveMs+=performance.now()-start}}})
  const clock=value(createFixedClock(Date.parse('2026-10-15T01:00:00Z'),'Asia/Shanghai',zones)),calendars=value(loadBundledCalendarStore())
  const store=value(createConfigStore({directory,clock,zones,calendars,maxValidationDates:10000,appVersion:'2.0.0'}))
  const results:Array<{name:string;elapsedMs:number;uncachedResolveCalls:number;resolveMs:number;largestEventLoopStallMs:number}>=[]
  const timer=setInterval(()=>{const now=performance.now();largestStall=Math.max(largestStall,now-last-10);last=now},10)
  async function measure<T>(name:string,work:()=>Promise<import('../../src/shared/contracts').Result<T>>){
    const beforeCalls=resolveCalls,beforeResolve=resolveMs,start=performance.now();last=start;largestStall=0
    const result=value(await work()),elapsedMs=performance.now()-start
    await new Promise<void>(done=>setTimeout(done,20))
    results.push({name,elapsedMs:+elapsedMs.toFixed(2),uncachedResolveCalls:resolveCalls-beforeCalls,resolveMs:+(resolveMs-beforeResolve).toFixed(2),largestEventLoopStallMs:+largestStall.toFixed(2)})
    return result
  }
  try{
    await measure('missing load',()=>store.load())
    const defaults=value(createDefaultAppConfig({updatedAt:'2026-10-15T01:00:00.000Z',appVersion:'2.0.0'},calendars.listMetadata()))
    let saved=await measure('first initializeSettings',()=>store.initializeSettings(value(editableConfig(defaults))))
    const settings=value(editableConfig(saved.config));settings.schedule.endTime='18:30'
    saved=await measure('end time save',()=>store.save({settings,expectedRevision:saved.config.revision}))
    settings.appearance.accent='coral';await measure('appearance save',()=>store.save({settings,expectedRevision:saved.config.revision}))
    await mkdir(resolve('test-results'),{recursive:true});await writeFile(resolve('test-results/d11-ux-performance-final.json'),JSON.stringify(results,null,2))
    console.log(JSON.stringify(results,null,2))
    assert.ok(results.every(row=>row.largestEventLoopStallMs<500),'no long synchronous freeze; this is not a G05 substitute')
    assert.ok(results.find(row=>row.name==='end time save')!.elapsedMs<5000,'ordinary save must not take tens of seconds')
  }finally{clearInterval(timer);assert.ok(directory.startsWith(join(tmpdir(),'workday-d11-performance-')));await rm(directory,{recursive:true,force:true})}
})
