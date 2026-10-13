import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DashboardSnapshot, Result, ScheduleConfig } from '../../src/shared/contracts'
import { validateJsonDto } from '../../src/shared/validation'
import { createCalendar, type Calendar } from '../../src/domain/calendar'
import { createFixedClock } from '../../src/domain/clock'
import { createIntlTimeZoneAdapter } from '../../src/adapters/intl-time-zone'
import { loadBundledCalendarStore } from '../../src/main/services/calendar-store'
import { clearOvertimeForShift, overtimeForDate, setOvertimeForShift, validateOvertime, type OvertimeConfig } from '../../src/domain/overtime'
import { calculateScheduleAt, calculateScheduleWithClock, classifyShift, resolveShift, updateOvertime,
  validateSchedule, validateScheduleForDates, validateShiftConflicts, type ResolvedShift, type ScheduleContext } from '../../src/domain/schedule'
import { calculateProgress } from '../../src/domain/progress'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('Expected success')
  return result.data
}
function rejected(result: Result<unknown>, code = 'VALIDATION'): void {
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.error.code, code); if (result.error.code === 'VALIDATION') assert.ok(result.error.issues.length) }
}
const epoch = (iso: string) => Date.parse(iso) // Fixed fixtures only.
const zones = createIntlTimeZoneAdapter(), store = value(loadBundledCalendarStore())
const years = [2024,2025,2026].map(year => value(store.readYear(year))!)
const regular = (): ScheduleConfig => ({ workWeek:[1,2,3,4,5], startTime:'09:00', endTime:'18:00', crossMidnight:false, breaks:[] })
const lunch = (): ScheduleConfig => ({ ...regular(), breaks:[{startTime:'12:00',endTime:'13:00',startDayOffset:0,endDayOffset:0}] })
const overnight = (): ScheduleConfig => ({ ...regular(), startTime:'22:00',endTime:'06:00',crossMidnight:true })
const none = (): OvertimeConfig => ({entries:[]})
const ot = (minutes: number,shiftDate='2026-10-13'): OvertimeConfig => ({entries:[{shiftDate,minutes}]})
const calendar = (config=regular(), overrides: Record<string,'work'|'rest'>={}, data=years) => value(createCalendar({workWeek:config.workWeek,overrides},data))
const context = (config=regular(), overrides: Record<string,'work'|'rest'>={}, timeZoneId='UTC'): ScheduleContext => ({calendar:calendar(config,overrides),zones,timeZoneId})
function shift(config=regular(),entries=none(),date='2026-10-13',ctx=context(config)): ResolvedShift {
  const built=value(resolveShift(config,entries,date,ctx))
  assert.equal(built.status,'ready');if(built.status!=='ready')throw new Error('Expected resolved shift')
  return built.shift
}
const selected=(iso:string,config=regular(),entries=none(),ctx=context(config))=>value(calculateScheduleAt(config,entries,epoch(iso),ctx))
const progress=(resolved:ResolvedShift,iso:string)=>value(calculateProgress(resolved,epoch(iso),resolved.timeZoneId))!

test('same-day schedule parses explicit endpoints and no default lunch',()=>{
  const result=shift();assert.equal(result.startsAt,epoch('2026-10-13T09:00:00Z'));assert.equal(result.normalEndsAt,epoch('2026-10-13T18:00:00Z'))
  assert.equal(result.totalWorkMilliseconds,9*3600000);assert.deepEqual(result.breaks,[])
})
test('equal/inverted same-day, unpadded and illegal clock inputs rejected',()=>{
  for(const change of [{endTime:'09:00'},{endTime:'08:00'},{startTime:'9:00'},{startTime:'24:00'},{endTime:'08:60'}])rejected(validateSchedule({...regular(),...change}))
})
test('explicit overnight permits 24 hours but rejects more than 24',()=>{
  assert.equal(validateSchedule({...regular(),crossMidnight:true,endTime:'09:00'}).ok,true)
  rejected(validateSchedule({...regular(),crossMidnight:true,endTime:'10:00'}))
  rejected(validateSchedule({...overnight(),crossMidnight:false}))
})
test('half-open same-day state and countdown boundaries T07',()=>{
  for(const [iso,state,seconds,target] of [
    ['2026-10-13T08:59:59.200Z','beforeWork',1,'workStart'],['2026-10-13T09:00:00Z','working',32400,'finalWorkEnd'],
    ['2026-10-13T17:59:59.200Z','working',1,'finalWorkEnd'],['2026-10-13T18:00:00Z','finished',0,'finalWorkEnd']
  ] as const){const result=selected(iso);assert.equal(result.state,state);assert.equal(result.countdown?.seconds,seconds);assert.equal(result.countdown?.target,target)}
})
test('overnight ends on next Civil date and retains start-date ownership',()=>{
  const result=shift(overnight());assert.equal(result.endDate,'2026-10-14');assert.equal(result.shiftDate,'2026-10-13')
  assert.equal(result.normalEndsAt,epoch('2026-10-14T06:00:00Z'))
})
test('midnight does not replace an active prior overnight shift T09',()=>{
  const result=selected('2026-10-14T00:01:00Z',overnight())
  assert.equal(result.state,'working');assert.equal(result.shift?.shiftDate,'2026-10-13');assert.equal(result.countdown?.seconds,5*3600+59*60)
})
test('today rest does not mask active previous shift',()=>{
  const config=overnight(),ctx=context(config,{'2026-10-14':'rest'})
  assert.equal(selected('2026-10-14T00:01:00Z',config,none(),ctx).shift?.shiftDate,'2026-10-13')
  const ended=selected('2026-10-14T06:00:00Z',config,none(),ctx)
  assert.equal(ended.state,'rest');assert.equal(ended.shift,null);assert.equal(ended.countdown,null)
})
test('holiday has no shift and official makeup does',()=>{
  const holiday=value(resolveShift(regular(),none(),'2026-10-01',context()))
  assert.equal(holiday.status,'noShift')
  assert.equal(value(resolveShift(regular(),none(),'2026-10-10',context())).status,'ready')
})
test('user rest/work overrides determine shift existence',()=>{
  assert.equal(value(resolveShift(regular(),none(),'2026-10-13',context(regular(),{'2026-10-13':'rest'}))).status,'noShift')
  assert.equal(value(resolveShift(regular(),none(),'2026-10-18',context(regular(),{'2026-10-18':'work'}))).status,'ready')
})
test('maximum 34-hour shift survives two midnight boundaries',()=>{
  const config={...regular(),startTime:'20:00',endTime:'20:00',crossMidnight:true}
  const ctx=context(config,{'2026-10-14':'rest'}),entries=ot(600)
  const resolved=shift(config,entries,'2026-10-13',ctx)
  assert.equal(resolved.finalEndsAt-resolved.startsAt,34*3600000)
  assert.equal(validateShiftConflicts(config,entries,'2026-10-13',ctx).ok,true)
  const current=selected('2026-10-15T00:01:00Z',config,entries,ctx)
  assert.equal(current.shift?.shiftDate,'2026-10-13');assert.equal(current.state,'overtime');assert.equal(current.countdown?.seconds,5*3600+59*60)
  assert.ok(current.checkedShiftDates.length<=9)
})
test('unexplained two active shifts are rejected rather than picked',()=>{
  const config={...regular(),startTime:'20:00',endTime:'20:00',crossMidnight:true}
  rejected(calculateScheduleAt(config,ot(600),epoch('2026-10-14T21:00:00Z'),context(config)))
})
test('legal lunch freezes progress while wall countdown continues T08',()=>{
  const config=lunch(),resolved=shift(config)
  const result=selected('2026-10-13T12:30:00Z',config)
  assert.equal(result.state,'break');assert.equal(result.countdown?.seconds,5*3600+30*60)
  assert.equal(progress(resolved,'2026-10-13T12:30:00Z').percent,37.5)
  assert.equal(progress(resolved,'2026-10-13T12:59:59.999Z').elapsedWorkMilliseconds,3*3600000)
})
test('lunch exact start is break and end is working',()=>{
  assert.equal(selected('2026-10-13T12:00:00Z',lunch()).state,'break')
  assert.equal(selected('2026-10-13T13:00:00Z',lunch()).state,'working')
})
test('zero/negative/outside/overlapping breaks and zero net rejected',()=>{
  const interval=(startTime:string,endTime:string)=>({startTime,endTime,startDayOffset:0 as const,endDayOffset:0 as const})
  for(const breaks of [[interval('12:00','12:00')],[interval('13:00','12:00')],[interval('08:00','10:00')],[interval('17:00','19:00')],
    [interval('12:00','13:00'),interval('12:30','13:30')],[interval('09:00','18:00')]])rejected(validateSchedule({...regular(),breaks}))
})
test('adjacent breaks are allowed and input order is not mutated',()=>{
  const config={...regular(),breaks:[{startTime:'13:00',endTime:'14:00',startDayOffset:0 as const,endDayOffset:0 as const},
    {startTime:'12:00',endTime:'13:00',startDayOffset:0 as const,endDayOffset:0 as const}]}
  const before=JSON.stringify(config),resolved=shift(config)
  assert.equal(resolved.totalWorkMilliseconds,7*3600000);assert.equal(JSON.stringify(config),before)
})
test('cross-midnight break uses explicit day offsets',()=>{
  const config={...overnight(),breaks:[{startTime:'23:30',endTime:'00:30',startDayOffset:0 as const,endDayOffset:1 as const}]}
  const resolved=shift(config)
  assert.equal(resolved.breaks[0].startsAt,epoch('2026-10-13T23:30:00Z'));assert.equal(resolved.breaks[0].endsAt,epoch('2026-10-14T00:30:00Z'))
  assert.equal(selected('2026-10-14T00:01:00Z',config).state,'break')
  assert.equal(progress(resolved,'2026-10-14T00:01:00Z').elapsedWorkMilliseconds,1.5*3600000)
})
test('break day offset type/range and unknown fields use D02 structure rules',()=>{
  rejected(validateSchedule({...lunch(),breaks:[{...lunch().breaks[0],startDayOffset:2}]}))
  rejected(validateSchedule({...regular(),extra:true}))
  rejected(validateSchedule(JSON.parse('{"workWeek":[1],"startTime":"09:00","endTime":"18:00","crossMidnight":false,"breaks":[],"__proto__":{}}')))
})
test('overtime 0/1/600 keep only their own date and are validated',()=>{
  for(const minutes of [0,1,600]){
    assert.equal(value(overtimeForDate(ot(minutes),'2026-10-13')),minutes)
    assert.equal(value(overtimeForDate(ot(minutes),'2026-10-14')),0)
    assert.equal(shift(regular(),ot(minutes)).finalEndsAt,epoch('2026-10-13T18:00:00Z')+minutes*60000)
  }
})
test('overtime wrong minutes/date/duplicate and dangerous keys rejected',()=>{
  for(const minutes of [-1,601,1.5,'60'])rejected(validateOvertime({entries:[{shiftDate:'2026-10-13',minutes}]}))
  rejected(validateOvertime({entries:[{shiftDate:'2026-02-29',minutes:0}]}))
  rejected(validateOvertime({entries:[{shiftDate:'2026-10-13',minutes:0},{shiftDate:'2026-10-13',minutes:1}]}))
  rejected(validateOvertime(JSON.parse('{"entries":[],"constructor":{}}')))
})
test('normal end is overtime start, final end is finished',()=>{
  const resolved=shift(regular(),ot(60))
  assert.equal(value(classifyShift(resolved,epoch('2026-10-13T18:00:00Z'),'UTC')),'overtime')
  assert.equal(value(classifyShift(resolved,epoch('2026-10-13T19:00:00Z'),'UTC')),'finished')
  assert.equal(progress(resolved,'2026-10-13T19:00:00Z').percent,100)
})
test('T14 600-minute overtime retains previous date and 03:59:00 countdown',()=>{
  const config={...regular(),startTime:'08:30'},entries=ot(600)
  assert.equal(shift(config,entries).finalEndsAt,epoch('2026-10-14T04:00:00Z'))
  const result=selected('2026-10-14T00:01:00Z',config,entries)
  assert.equal(result.state,'overtime');assert.equal(result.shift?.shiftDate,'2026-10-13');assert.equal(result.countdown?.seconds,3*3600+59*60)
})
test('overtime end does not transfer to next shift or delete history',()=>{
  const config={...regular(),startTime:'08:30'},entries={entries:[{shiftDate:'2024-01-02',minutes:0},{shiftDate:'2026-10-13',minutes:600}]},before=JSON.stringify(entries)
  const ended=selected('2026-10-14T04:00:00Z',config,entries)
  assert.equal(ended.state,'beforeWork');assert.equal(ended.shift?.shiftDate,'2026-10-14');assert.equal(ended.shift?.overtimeMinutes,0)
  assert.equal(JSON.stringify(entries),before)
})
test('clear removes only target including zero/history and leaves originals untouched',()=>{
  const original={entries:[{shiftDate:'2024-01-02',minutes:0},{shiftDate:'2026-10-13',minutes:600}]}
  const cleared=value(clearOvertimeForShift(original,'2026-10-13'))
  assert.deepEqual(cleared.entries,[{shiftDate:'2024-01-02',minutes:0}]);assert.equal(original.entries.length,2)
  assert.deepEqual(value(clearOvertimeForShift(original,'2026-10-14')).entries,original.entries)
})
test('valid overtime update requires conflict guard and keeps history/zero',()=>{
  const original={entries:[{shiftDate:'2024-01-02',minutes:0}]}
  const updated=value(updateOvertime(regular(),original,'2026-10-13',60,context()))
  assert.deepEqual(updated.entries,[...original.entries,{shiftDate:'2026-10-13',minutes:60}]);assert.equal(original.entries.length,1)
  assert.equal(value(updateOvertime(regular(),updated,'2026-10-13',0,context())).entries[1].minutes,0)
})
test('overtime overlapping next scheduled start rejected with prior data preserved',()=>{
  const config={...regular(),startTime:'09:00',endTime:'08:30',crossMidnight:true},original=none(),before=JSON.stringify(original)
  rejected(updateOvertime(config,original,'2026-10-13',60,context(config)))
  assert.equal(JSON.stringify(original),before)
})
test('a later existing overtime record cannot overlap a new prior shift',()=>{
  const config={...regular(),startTime:'09:00',endTime:'08:30',crossMidnight:true},entries=ot(60,'2026-10-12')
  rejected(validateShiftConflicts(config,entries,'2026-10-13',context(config)))
})
test('touching final-end/next-start is allowed by half-open intervals',()=>{
  const config={...regular(),startTime:'09:00',endTime:'09:00',crossMidnight:true}
  assert.equal(validateShiftConflicts(config,none(),'2026-10-13',context(config)).ok,true)
})
test('rest-date override prevents subsequent overlap without generating new shift',()=>{
  const config={...regular(),startTime:'09:00',endTime:'08:30',crossMidnight:true}
  assert.equal(updateOvertime(config,none(),'2026-10-13',60,context(config,{'2026-10-14':'rest'})).ok,true)
  rejected(updateOvertime(regular(),none(),'2026-10-18',60,context()))
})
test('historical rest-day records are preserved inactive, clearing remains possible',()=>{
  const entries=ot(60,'2026-10-18'),result=selected('2026-10-18T12:00:00Z',regular(),entries)
  assert.equal(result.state,'rest');assert.equal(entries.entries.length,1)
  assert.equal(value(clearOvertimeForShift(entries,'2026-10-18')).entries.length,0)
})
test('schedule candidate conflict rejected without mutating prior schedule',()=>{
  const original=regular(),before=JSON.stringify(original),candidate={...original,startTime:'09:00',endTime:'08:30',crossMidnight:true}
  rejected(validateScheduleForDates(candidate,ot(60),['2026-10-13'],context(candidate)))
  assert.equal(JSON.stringify(original),before)
})
test('explicit validation scope accepts rest days but rejects malformed dates',()=>{
  assert.equal(validateScheduleForDates(regular(),none(),['2026-10-13','2026-10-18'],context()).ok,true)
  rejected(validateScheduleForDates(regular(),none(),['2026-02-29'],context()))
  rejected(validateScheduleForDates(regular(),none(),[],context()))
})
test('throwing overtime guard cannot mutate input or pretend success',()=>{
  const original=none();rejected(setOvertimeForShift(original,'2026-10-13',60,()=>{throw new Error('private')}),'UNAVAILABLE')
  assert.equal(original.entries.length,0)
})
test('T18 lunch/overtime denominator and completed progress derive real intervals',()=>{
  const plain=shift(lunch()),extended=shift(lunch(),ot(60))
  assert.equal(progress(plain,'2026-10-13T13:00:00Z').percent,37.5)
  assert.ok(Math.abs(progress(extended,'2026-10-13T13:00:00Z').percent-100/3)<1e-9)
  assert.ok(Math.abs(progress(extended,'2026-10-13T18:00:00Z').percent-800/9)<1e-9)
  assert.equal(progress(extended,'2026-10-13T19:00:00Z').percent,100)
})
test('reconfiguration may reduce actual progress, never enforces monotonic fish position',()=>{
  const before=progress(shift(lunch()),'2026-10-13T13:00:00Z').percent
  const after=progress(shift(lunch(),ot(60)),'2026-10-13T13:00:00Z').percent
  assert.ok(after<before)
  assert.ok(progress(shift({...regular(),startTime:'08:00'}),'2026-10-13T13:00:00Z').percent>progress(shift(),'2026-10-13T13:00:00Z').percent)
})
test('progress clamps before/after and null means no effective shift',()=>{
  const resolved=shift();assert.equal(progress(resolved,'2026-10-13T08:00:00Z').percent,0);assert.equal(progress(resolved,'2026-10-14T20:00:00Z').percent,100)
  assert.equal(value(calculateProgress(null,epoch('2026-10-18T12:00:00Z'),'UTC')),null)
})
test('millisecond progress precision and one-second countdown rounding retained',()=>{
  const result=progress(shift(),'2026-10-13T09:00:00.200Z')
  assert.equal(result.elapsedWorkMilliseconds,200);assert.equal(result.elapsedWorkSeconds,0.2)
  assert.equal(selected('2026-10-13T17:59:59.999Z').countdown?.seconds,1)
})
test('missing calendar estimate propagates to shift/countdown/progress, not instant arithmetic',()=>{
  const ctx:ScheduleContext={calendar:calendar(regular(),{},[]),zones,timeZoneId:'UTC'}
  const result=selected('2027-01-04T12:00:00Z',regular(),none(),ctx)
  assert.equal(result.shift?.quality.approximate,true);assert.deepEqual(result.countdown?.quality.incompleteYears,[2027])
  assert.equal(result.timeQuality.approximate,false)
  const amount=value(calculateProgress(result.shift,epoch('2027-01-04T12:00:00Z'),'UTC'))!
  assert.equal(amount.quality.approximate,true);assert.equal(amount.timeQuality.approximate,false)
  assert.ok(result.warnings.some(w=>w.affects.includes('progress')))
})
test('custom missing-year work date is authoritative without invented official coverage',()=>{
  const ctx=context(regular(),{'2027-01-03':'work'})
  const result=shift(regular(),none(),'2027-01-03',ctx)
  assert.equal(result.quality.source,'userOverride');assert.equal(result.quality.approximate,false)
})
test('fixed clock forward/backwards recomputes instead of decrementing accumulated ticks',()=>{
  const clock=value(createFixedClock(epoch('2026-10-13T17:59:59.999Z'),'UTC',zones))
  assert.equal(value(calculateScheduleWithClock(regular(),none(),clock,calendar(),zones)).state,'working')
  value(clock.advanceMilliseconds(1));assert.equal(value(calculateScheduleWithClock(regular(),none(),clock,calendar(),zones)).state,'finished')
  value(clock.setInstant(epoch('2026-10-13T08:00:00Z')));assert.equal(value(calculateScheduleWithClock(regular(),none(),clock,calendar(),zones)).state,'beforeWork')
})
test('old boundaries cannot be reused after timezone changes',()=>{
  const resolved=shift();rejected(classifyShift(resolved,epoch('2026-10-13T12:00:00Z'),'Asia/Shanghai'))
  rejected(calculateProgress(resolved,epoch('2026-10-13T12:00:00Z'),'Asia/Shanghai'))
  const current=selected('2026-10-13T02:00:00Z',regular(),none(),context(regular(),{},'Asia/Shanghai'))
  assert.equal(current.state,'working');assert.equal(current.shift?.startsAt,epoch('2026-10-13T01:00:00Z'))
})
test('DST nonexistent start returns error and never a fabricated progress',()=>{
  const config={...regular(),workWeek:[1,2,3,4,5,6,7] as ScheduleConfig['workWeek'],startTime:'02:30',endTime:'04:00'}
  const ctx=context(config,{},'America/New_York')
  rejected(resolveShift(config,none(),'2026-03-08',ctx))
  rejected(calculateScheduleAt(config,none(),epoch('2026-03-08T08:00:00Z'),ctx))
})
test('DST repeated start returns ambiguity and incomplete without choosing offset',()=>{
  const config={...regular(),workWeek:[1,2,3,4,5,6,7] as ScheduleConfig['workWeek'],startTime:'01:30',endTime:'04:00'},ctx=context(config,{},'America/New_York')
  const result=value(resolveShift(config,none(),'2026-11-01',ctx))
  assert.equal(result.status,'ambiguous');if(result.status==='ambiguous')assert.equal(result.issues[0].candidates.length,2)
  const current=value(calculateScheduleAt(config,none(),epoch('2026-11-01T07:00:00Z'),ctx))
  assert.equal(current.state,'incomplete');assert.equal(current.shift,null);assert.equal(current.countdown,null)
  assert.equal(value(calculateProgress(current.shift,current.instant,current.timeZoneId)),null)
})
test('DST ambiguous break also prevents normal progress construction',()=>{
  const config={...regular(),startTime:'00:00',endTime:'04:00',breaks:[{startTime:'01:15',endTime:'01:45',startDayOffset:0 as const,endDayOffset:0 as const}]},ctx=context(config,{'2026-11-01':'work'},'America/New_York')
  const result=value(resolveShift(config,none(),'2026-11-01',ctx))
  assert.equal(result.status,'ambiguous')
})
test('unique DST endpoints use actual three/five-hour durations, not wall hours',()=>{
  const config={...regular(),startTime:'00:00',endTime:'04:00'},ctx=context(config,{'2026-03-08':'work','2026-11-01':'work'},'America/New_York')
  const spring=shift(config,none(),'2026-03-08',ctx),fall=shift(config,none(),'2026-11-01',ctx)
  assert.equal(spring.totalWorkMilliseconds,3*3600000);assert.equal(fall.totalWorkMilliseconds,5*3600000)
  assert.ok(Math.abs(progress(spring,'2026-03-08T06:00:00Z').percent-100/3)<1e-9)
})
test('resolved base over 24 actual hours is rejected instead of breaking 34-hour bound',()=>{
  const config={...regular(),startTime:'00:00',endTime:'00:00',crossMidnight:true},ctx=context(config,{'2026-11-01':'work'},'America/New_York')
  rejected(resolveShift(config,none(),'2026-11-01',ctx))
})
test('past ambiguous shift does not block a later ordinary day',()=>{
  const config={...regular(),workWeek:[1,2,3,4,5,6,7] as ScheduleConfig['workWeek'],startTime:'01:30',endTime:'04:00'},ctx=context(config,{},'America/New_York')
  const current=value(calculateScheduleAt(config,none(),epoch('2026-11-03T17:00:00Z'),ctx))
  assert.equal(current.state,'finished');assert.equal(current.shift?.shiftDate,'2026-11-03')
})
test('per-call resolution memo reuses repeated break boundary without a runtime cache',()=>{
  const calls=new Map<string,number>(),counting={project:zones.project,resolve(local:Parameters<typeof zones.resolve>[0],zone:string){const key=JSON.stringify([local,zone]);calls.set(key,(calls.get(key)??0)+1);return zones.resolve(local,zone)}}
  const config={...regular(),breaks:[{startTime:'12:00',endTime:'13:00',startDayOffset:0 as const,endDayOffset:0 as const},{startTime:'13:00',endTime:'14:00',startDayOffset:0 as const,endDayOffset:0 as const}]}
  assert.equal(resolveShift(config,none(),'2026-10-13',{...context(config),zones:counting}).ok,true)
  assert.ok([...calls.values()].every(count=>count===1))
})
test('fake/unvalidated or serialized shifts are not accepted as trusted calculation inputs',()=>{
  const resolved=shift(),fake=JSON.parse(JSON.stringify(resolved))
  rejected(calculateProgress(fake,epoch('2026-10-13T12:00:00Z'),'UTC'))
  rejected(classifyShift(fake,epoch('2026-10-13T12:00:00Z'),'UTC'))
  assert.ok(Object.isFrozen(resolved.effectiveIntervals))
})
test('resolved DTOs match Snapshot types and calculations do not mutate records/config',()=>{
  const config=lunch(),entries=ot(60),before=JSON.stringify({config,entries}),resolved=shift(config,entries)
  const dto:ShiftSnapshotCompatibility=resolved
  assert.equal(validateJsonDto(dto).ok,true)
  const result=selected('2026-10-13T13:00:00Z',config,entries),countdown:DashboardSnapshot['countdown']=result.countdown
  const amount=value(calculateProgress(resolved,result.instant,'UTC')),progressDto:DashboardSnapshot['progress']=amount
  assert.equal(validateJsonDto(countdown).ok,true);assert.equal(validateJsonDto(progressDto).ok,true)
  assert.equal(JSON.stringify({config,entries}),before)
})
type ShiftSnapshotCompatibility=NonNullable<DashboardSnapshot['activeShift']>
test('invalid instant/unknown timezone and calendar/provider errors are structured',()=>{
  rejected(calculateScheduleAt(regular(),none(),NaN,context()))
  rejected(resolveShift(regular(),none(),'2026-10-13',context(regular(),{},'Invalid/Zone')))
  const broken:Calendar={getDay(){throw new Error('private path')}}
  rejected(resolveShift(regular(),none(),'2026-10-13',{...context(),calendar:broken}),'UNAVAILABLE')
  rejected(calculateProgress(null,NaN,'UTC'))
})
test('Civil limits reject overnight/year overflow without Date normalization',()=>{
  assert.equal(resolveShift(regular(),none(),'0001-01-01',context()).ok,true)
  rejected(resolveShift(overnight(),none(),'9999-12-31',context()))
  rejected(resolveShift(regular(),none(),'2026-02-29',context()))
})
test('creating immutable shifts never freezes a caller-owned calendar DTO',()=>{
  const day=value(calendar().getDay('2026-10-13')),borrowed:Calendar={getDay(){return {ok:true,data:day}}}
  assert.equal(resolveShift(regular(),none(),'2026-10-13',{...context(),calendar:borrowed}).ok,true)
  assert.equal(Object.isFrozen(day),false);assert.equal(Object.isFrozen(day.quality),false)
  day.quality.incompleteYears.push(2099)
})
test('one multi-date validation call reuses shared endpoint resolutions',()=>{
  const calls=new Map<string,number>(),counting={project:zones.project,resolve(local:Parameters<typeof zones.resolve>[0],zone:string){const key=JSON.stringify([local,zone]);calls.set(key,(calls.get(key)??0)+1);return zones.resolve(local,zone)}}
  const config=regular()
  assert.equal(validateScheduleForDates(config,none(),['2026-10-13','2026-10-14'],{...context(config),zones:counting}).ok,true)
  assert.ok([...calls.values()].every(count=>count===1))
})
test('expired DST gap does not invalidate a later ordinary shift',()=>{
  const config={...regular(),workWeek:[1,2,3,4,5,6,7] as ScheduleConfig['workWeek'],startTime:'02:30',endTime:'04:00'},ctx=context(config,{},'America/New_York')
  const result=value(calculateScheduleAt(config,none(),epoch('2026-03-10T16:00:00Z'),ctx))
  assert.equal(result.state,'finished');assert.equal(result.shift?.shiftDate,'2026-03-10')
})
test('frozen shift quality remains separate from mutable returned progress metadata',()=>{
  const resolved=shift(),amount=progress(resolved,'2026-10-13T13:00:00Z')
  amount.quality.incompleteYears.push(2099)
  assert.deepEqual(resolved.quality.incompleteYears,[])
})
