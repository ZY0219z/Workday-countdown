import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DashboardSnapshot, Result, SalaryPolicy } from '../../src/shared/contracts'
import { validateJsonDto } from '../../src/shared/validation'
import { addDays, fromDayOrdinal, MAX_DAY_ORDINAL, toDayOrdinal } from '../../src/domain/local-date'
import { createCalendar, type Calendar, type CalendarRules } from '../../src/domain/calendar'
import { loadBundledCalendarStore } from '../../src/main/services/calendar-store'
import { calculateElapsedNaturalDays, calculateEmployment } from '../../src/domain/employment'
import { calculateNextRestDay } from '../../src/domain/rest-day'
import { adjustSalaryDate, calculateNextSalary, nominalSalaryDate, type SalaryResult } from '../../src/domain/salary'

function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, JSON.stringify(result))
  if (!result.ok) throw new Error('Expected success')
  return result.data
}
function rejected(result: Result<unknown>, code = 'VALIDATION'): void {
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, code)
    if (result.error.code === 'VALIDATION') assert.ok(result.error.issues.length > 0)
  }
}
const store = value(loadBundledCalendarStore())
const years = [2024,2025,2026].map(year=>value(store.readYear(year))!)
const rules = (): CalendarRules => ({ workWeek:[1,2,3,4,5], overrides:{} })
const calendar = (input: CalendarRules=rules(), data=years): Calendar => value(createCalendar(input,data))
const baseline = calendar()
const budget = { maxDays: MAX_DAY_ORDINAL }
const employment = (startDate: string|null, today: string, cal=baseline) => value(calculateEmployment({startDate,today},cal,budget))
const rest = (today: string, cal=baseline, includeStart=true) => value(calculateNextRestDay(cal,today,{includeStart,maxDays:366}))
function salary(today: string, day=10, policy: SalaryPolicy='delay', cal=baseline) {
  const result = value(calculateNextSalary(cal,today,day,policy))
  assert.equal(result.status,'found')
  if(result.status !== 'found') throw new Error('Expected a unique salary cycle')
  return result
}
function rangeOverrides(start: string, end: string, kind: 'work'|'rest'): CalendarRules['overrides'] {
  const first=value(toDayOrdinal(start)),last=value(toDayOrdinal(end)),output: CalendarRules['overrides']={}
  for(let ordinal=first;ordinal<=last;ordinal++) output[value(fromDayOrdinal(ordinal))]=kind
  return output
}

test('employment day is 0 and next day is 1, excluding today',()=>{
  assert.equal(employment('2026-10-16','2026-10-16').elapsedNaturalDays,0)
  assert.equal(employment('2026-10-16','2026-10-17').elapsedNaturalDays,1)
  assert.equal(employment('2026-10-16','2026-10-17').plannedWorkDays,1)
})
test('T01/T02 weekend natural days increase while planned work excludes Monday',()=>{
  const result=employment('2026-10-16','2026-10-19')
  assert.equal(result.elapsedNaturalDays,3);assert.equal(result.plannedWorkDays,1);assert.equal(result.checkedDays,3)
  assert.equal(result.excludesToday,true);assert.equal(result.isActualAttendance,false)
})
test('future employment is explicit and never negative or traversed',()=>{
  const unused: Calendar={getDay(){throw new Error('must not query')}}
  const result=employment('2026-10-20','2026-10-19',unused)
  assert.equal(result.status,'notStarted');assert.equal(result.elapsedNaturalDays,0);assert.equal(result.plannedWorkDays,0)
  assert.equal(result.checkedDays,0)
})
test('unset employment has nullable counts, no fake date and no calendar access',()=>{
  const result=employment(null,'2026-10-13',{getDay(){throw new Error('must not query')}})
  assert.equal(result.status,'unset');assert.equal(result.elapsedNaturalDays,null);assert.equal(result.plannedWorkDays,null)
  assert.equal(result.checkedDays,0)
})
test('workday override changes planned 1 to 2 without affecting natural 3',()=>{
  const result=employment('2026-10-16','2026-10-19',calendar({...rules(),overrides:{'2026-10-17':'work'}}))
  assert.equal(result.plannedWorkDays,2);assert.equal(result.elapsedNaturalDays,3)
})
test('current work-week changes retrospectively recalculate history',()=>{
  assert.equal(employment('2026-10-16','2026-10-19',calendar({workWeek:[6,7],overrides:{}})).plannedWorkDays,2)
  assert.equal(employment('2026-10-16','2026-10-19',calendar({workWeek:[1],overrides:{}})).plannedWorkDays,0)
})
test('annual exceptions and custom overrides determine planned work',()=>{
  assert.equal(employment('2026-10-01','2026-10-11').plannedWorkDays,3) // 8,9,10; today 11 excluded.
  assert.equal(employment('2026-10-01','2026-10-11',calendar({...rules(),overrides:{'2026-10-01':'work'}})).plannedWorkDays,4)
})
test('planned counts always identify current-rule estimate, not actual attendance',()=>{
  const result=employment('2026-10-16','2026-10-19')
  assert.equal(result.quality.source,'currentSchedule');assert.equal(result.quality.approximate,true)
  assert.deepEqual(result.quality.incompleteYears,[])
  assert.equal(result.warnings[0].code,'CURRENT_RULE_ESTIMATE')
})
test('missing-year warning affects planned count but never natural day quality',()=>{
  const result=employment('2026-12-31','2027-01-05')
  assert.equal(result.elapsedNaturalDays,5);assert.equal(result.plannedWorkDays,3)
  assert.deepEqual(result.quality.incompleteYears,[2027])
  assert.deepEqual(result.naturalQuality,{approximate:false,incompleteYears:[],source:'clock',annualVerification:'notApplicable'})
  assert.deepEqual(result.warnings.find(w=>w.code==='CALENDAR_INCOMPLETE')?.years,[2027])
})
test('explicit overrides in missing years do not invent calendar uncertainty',()=>{
  const result=employment('2027-01-01','2027-01-03',calendar({...rules(),overrides:{'2027-01-01':'rest','2027-01-02':'work'}}))
  assert.equal(result.plannedWorkDays,1);assert.deepEqual(result.quality.incompleteYears,[])
  assert.ok(result.warnings.every(w=>w.code!=='CALENDAR_INCOMPLETE'))
})
test('natural day calculation works when the calendar is unavailable',()=>{
  assert.equal(value(calculateElapsedNaturalDays({startDate:'2024-02-28',today:'2024-03-01'})).elapsedNaturalDays,2)
  rejected(calculateEmployment({startDate:'2024-02-28',today:'2024-03-01'},{getDay(){return {ok:false,error:{code:'UNAVAILABLE',message:'calendar error'}}}},budget),'UNAVAILABLE')
})
test('invalid employment date/type and unknown unsafe fields are structured',()=>{
  for(const input of [{startDate:'2026-02-29',today:'2026-03-01'},{startDate:null,today:'2026-04-31'},
    {startDate:'0000-01-01',today:'2026-10-13'},{startDate:123,today:'2026-10-13'}, {today:'2026-10-13'},
    {startDate:null,today:'2026-10-13',extra:true},JSON.parse('{"startDate":null,"today":"2026-10-13","__proto__":{}}')]) rejected(calculateElapsedNaturalDays(input))
})
test('explicit history budget rejects before any traversal, no partial count',()=>{
  let calls=0;const counting: Calendar={getDay(date){calls++;return baseline.getDay(date)}}
  rejected(calculateEmployment({startDate:'2026-10-16',today:'2026-10-19'},counting,{maxDays:2}))
  assert.equal(calls,0)
  assert.equal(value(calculateEmployment({startDate:'2026-10-16',today:'2026-10-19'},counting,{maxDays:3})).plannedWorkDays,1)
})
test('history budget rejects unsafe/zero/excessive values without new product limits',()=>{
  for(const maxDays of [0,-1,1.5,MAX_DAY_ORDINAL+1,'30']) rejected(calculateEmployment({startDate:null,today:'2026-10-13'},baseline,{maxDays} as never))
  assert.equal(value(calculateElapsedNaturalDays({startDate:'0001-01-01',today:'9999-12-31'})).elapsedNaturalDays,MAX_DAY_ORDINAL)
})
test('repeated years/reasons produce deduplicated warnings, no per-day diagnostics',()=>{
  const result=employment('2022-12-30','2024-01-03',calendar(rules(),[]))
  assert.deepEqual(result.quality.incompleteYears,[2022,2023,2024]);assert.equal(result.warnings.length,2)
  assert.deepEqual(result.warnings[1].years,[2022,2023,2024])
})
test('a throwing calendar cannot leak exceptions or return partial employment',()=>{
  rejected(calculateEmployment({startDate:'2026-10-16',today:'2026-10-19'},{getDay(){throw new Error('private path')}},budget),'UNAVAILABLE')
})
test('today rest includes today and returns weekday/zero',()=>{
  const result=rest('2026-10-18');assert.equal(result.status,'found')
  if(result.status==='found'){assert.equal(result.date,'2026-10-18');assert.equal(result.days,0);assert.equal(result.weekday,7);assert.equal(result.isTodayRest,true)}
})
test('ordinary Monday finds next weekend with explicit exclusion option',()=>{
  const result=rest('2026-10-19');assert.equal(result.status,'found')
  if(result.status==='found'){assert.equal(result.date,'2026-10-24');assert.equal(result.days,5)}
  const later=rest('2026-10-18',baseline,false);assert.equal(later.status,'found')
  if(later.status==='found') assert.equal(later.date,'2026-10-24')
})
test('makeup Saturday is work and National Day itself is rest',()=>{
  const makeup=rest('2026-10-10');assert.equal(makeup.status,'found')
  if(makeup.status==='found'){assert.equal(makeup.date,'2026-10-11');assert.equal(makeup.days,1)}
  const holiday=rest('2026-10-01');assert.equal(holiday.status,'found')
  if(holiday.status==='found'){assert.equal(holiday.date,'2026-10-01');assert.equal(holiday.days,0)}
})
test('user rest override changes next rest and preserves custom source',()=>{
  const result=rest('2026-10-19',calendar({...rules(),overrides:{'2026-10-20':'rest'}}))
  assert.equal(result.status,'found');if(result.status==='found'){assert.equal(result.days,1);assert.equal(result.quality.source,'userOverride')}
})
test('next rest across missing 2027 keeps structured estimate',()=>{
  const result=rest('2026-12-31');assert.equal(result.status,'found')
  if(result.status==='found') assert.equal(result.date,'2027-01-02')
  assert.deepEqual(result.quality.incompleteYears,[2027]);assert.equal(result.warnings[0].affects[0],'nextRest')
})
test('continuous work returns notFound with no date or zero countdown',()=>{
  const result=rest('2026-10-13',calendar({workWeek:[1,2,3,4,5,6,7],overrides:{}},[]))
  assert.equal(result.status,'notFound');assert.equal('days' in result,false);assert.equal('date' in result,false)
})
test('next rest includes distance 366 and clearly fails above Civil upper bound',()=>{
  const date=value(addDays('2026-10-13',366))
  const result=rest('2026-10-13',calendar({workWeek:[1,2,3,4,5,6,7],overrides:{[date]:'rest'}},[]))
  assert.equal(result.status,'found');if(result.status==='found')assert.equal(result.days,366)
  rejected(calculateNextRestDay(baseline,'9999-12-31',{includeStart:true,maxDays:366}))
})
test('next-rest illegal options and provider failures remain structured',()=>{
  rejected(calculateNextRestDay(baseline,'2026-10-13',{includeStart:true,maxDays:367}))
  rejected(calculateNextRestDay({getDay(){throw new Error('private')}},'2026-10-13',{includeStart:true,maxDays:366}),'UNAVAILABLE')
})
test('short month nominal mapping uses real month length, never Date overflow',()=>{
  assert.equal(value(nominalSalaryDate(2024,2,31)),'2024-02-29')
  assert.equal(value(nominalSalaryDate(2026,2,31)),'2026-02-28')
  assert.equal(value(nominalSalaryDate(2026,4,31)),'2026-04-30')
  assert.equal(value(nominalSalaryDate(2026,1,31)),'2026-01-31')
})
test('nominal salary rejects invalid pay day, month/year and unsafe types',()=>{
  for(const day of [0,32,-1,1.5,'10'])rejected(nominalSalaryDate(2026,5,day as never))
  rejected(nominalSalaryDate(0,1,10));rejected(nominalSalaryDate(10000,1,10));rejected(nominalSalaryDate(2026,13,10))
})
test('T10 delay fixes old jump-month and actual payday today is zero',()=>{
  const before=salary('2026-05-10'),today=salary('2026-05-11'),after=salary('2026-05-12')
  assert.equal(before.nominalDate,'2026-05-10');assert.equal(before.actualDate,'2026-05-11');assert.equal(before.days,1)
  assert.equal(today.actualDate,'2026-05-11');assert.equal(today.days,0);assert.equal(today.isTodayPayday,true)
  assert.equal(after.nominalDate,'2026-06-10');assert.equal(after.actualDate,'2026-06-10')
})
test('T13 advance uses May 9 official makeup, none keeps Sunday May 10',()=>{
  const advanced=value(adjustSalaryDate(baseline,'2026-05-10','advance'))
  assert.equal(advanced.status,'found')
  if(advanced.status==='found'){assert.equal(advanced.actualDate,'2026-05-09');assert.equal(advanced.shiftDays,-1);assert.equal(advanced.quality.source,'annual')}
  const unadjusted=salary('2026-05-10',10,'none')
  assert.equal(unadjusted.actualDate,'2026-05-10');assert.equal(unadjusted.days,0);assert.equal(unadjusted.adjustmentReason,'policyNone')
  assert.equal(salary('2026-05-08',10,'advance').actualDate,'2026-05-09')
})
test('T12 previous January period survives February query',()=>{
  const result=salary('2026-02-01',31)
  assert.equal(result.nominalDate,'2026-01-31');assert.equal(result.actualDate,'2026-02-02');assert.equal(result.days,1)
})
test('short month next salary retains nominal monthEnd marker',()=>{
  const result=salary('2024-02-28',31,'none')
  assert.equal(result.nominalDate,'2024-02-29');assert.equal(result.monthEndApplied,true)
  assert.equal(salary('2026-04-01',31,'none').actualDate,'2026-04-30')
  assert.equal(salary('2026-02-01',31,'none').actualDate,'2026-02-28')
})
test('December delay moves into next year and retains previous nominal date',()=>{
  const cal=calendar({...rules(),overrides:{'2026-12-31':'rest','2027-01-01':'rest'}})
  const result=salary('2027-01-01',31,'delay',cal)
  assert.equal(result.nominalDate,'2026-12-31');assert.equal(result.actualDate,'2027-01-04')
  // Explicit company coverage keeps this boundary deterministic.
})
test('future nominal month can advance into today current month',()=>{
  const cal=calendar({...rules(),overrides:{'2026-06-01':'rest'}})
  const result=salary('2026-05-29',1,'advance',cal)
  assert.equal(result.nominalDate,'2026-06-01');assert.equal(result.actualDate,'2026-05-29');assert.equal(result.days,0)
})
test('earliest future actual is selected independently of current month',()=>{
  const result=salary('2026-02-01',31)
  const eligible=result.cycles.flatMap(cycle=>cycle.result.status==='found'&&cycle.result.actualDate>='2026-02-01'?[cycle.result.actualDate]:[]).sort()
  assert.equal(result.actualDate,eligible[0]);assert.equal(result.cycles.length,25)
  assert.deepEqual(result.cycles.map(cycle=>cycle.monthOffset),Array.from({length:25},(_,i)=>i-12))
})
test('coincident monthly candidates remain explicit ambiguous origins',()=>{
  const cal=calendar({...rules(),overrides:rangeOverrides('2026-05-01','2026-06-30','rest')})
  const result=value(calculateNextSalary(cal,'2026-06-01',10,'delay'))
  assert.equal(result.status,'ambiguous')
  if(result.status==='ambiguous'){
    assert.equal(result.actualDate,'2026-07-01')
    assert.deepEqual(result.matchingCycles.map(cycle=>cycle.nominalDate),['2026-05-10','2026-06-10'])
    assert.equal('nominalDate' in result,false)
  }
})
test('long holiday searches include periods older than preceding month',()=>{
  const cal=calendar({...rules(),overrides:rangeOverrides('2026-01-01','2026-05-31','rest')})
  const result=value(calculateNextSalary(cal,'2026-05-31',10,'delay'))
  assert.equal(result.status,'ambiguous')
  if(result.status==='ambiguous')assert.deepEqual(result.matchingCycles.map(cycle=>cycle.nominalDate),['2026-01-10','2026-02-10','2026-03-10','2026-04-10','2026-05-10'])
})
test('actual coincident payday today still reports zero without choosing a cycle',()=>{
  const cal=calendar({...rules(),overrides:rangeOverrides('2026-05-01','2026-06-30','rest')})
  const result=value(calculateNextSalary(cal,'2026-07-01',10,'delay'))
  assert.equal(result.status,'ambiguous')
  if(result.status==='ambiguous'){assert.equal(result.days,0);assert.equal(result.isTodayPayday,true)}
})
test('unknown future candidate year does not taint a known nearest payday',()=>{
  const result=salary('2026-05-10')
  assert.equal(result.quality.approximate,false);assert.deepEqual(result.quality.incompleteYears,[])
  assert.equal(result.quality.source,'weekRule')
})
test('missing 2027 adjustment carries estimated years and is only planned',()=>{
  const result=salary('2026-12-31',1)
  assert.equal(result.actualDate,'2027-01-01');assert.equal(result.isPlanned,true)
  assert.equal(result.quality.approximate,true);assert.deepEqual(result.quality.incompleteYears,[2027])
  assert.ok(result.warnings.some(w=>w.code==='CALENDAR_INCOMPLETE'&&w.affects[0]==='salary'))
})
test('none strategy never queries a calendar or manufactures calendar estimation',()=>{
  const result=salary('2027-01-01',1,'none',{getDay(){throw new Error('must not query')}})
  assert.equal(result.quality.annualVerification,'notApplicable');assert.equal(result.quality.approximate,false)
  assert.deepEqual(result.warnings,[])
})
test('company override changes actual payday and source',()=>{
  assert.equal(salary('2026-05-10',10,'delay',calendar({...rules(),overrides:{'2026-05-11':'rest'}})).actualDate,'2026-05-12')
  const same=salary('2026-05-10',10,'delay',calendar({...rules(),overrides:{'2026-05-10':'work'}}))
  assert.equal(same.actualDate,'2026-05-10');assert.equal(same.quality.source,'userOverride')
})
test('default salary adjustment strategy is approved delay',()=>{
  const result=value(calculateNextSalary(baseline,'2026-05-10',10))
  assert.equal(result.status,'found');if(result.status==='found')assert.equal(result.actualDate,'2026-05-11')
})
test('forward adjustment includes the 366th distance and rejects 367th',()=>{
  const start='2026-10-13',target=value(addDays(start,366))
  const cal=calendar({workWeek:[1,2,3,4,5,6,7],overrides:rangeOverrides(start,value(addDays(target,-1)),'rest')},[])
  const result=value(adjustSalaryDate(cal,start,'delay'))
  assert.equal(result.status,'found');if(result.status==='found')assert.equal(result.shiftDays,366)
  const tooLate=calendar({workWeek:[1,2,3,4,5,6,7],overrides:rangeOverrides(start,target,'rest')},[])
  assert.equal(value(adjustSalaryDate(tooLate,start,'delay')).status,'notFound')
})
test('backward adjustment uses the same inclusive 366-distance bound',()=>{
  const nominal='2026-10-13',target=value(addDays(nominal,-366))
  const cal=calendar({workWeek:[1,2,3,4,5,6,7],overrides:rangeOverrides(value(addDays(target,1)),nominal,'rest')},[])
  const result=value(adjustSalaryDate(cal,nominal,'advance'))
  assert.equal(result.status,'found');if(result.status==='found'){assert.equal(result.actualDate,target);assert.equal(result.shiftDays,-366)}
})
test('no workday in any candidate adjustment returns explicit noWorkingDay',()=>{
  const cal=calendar({...rules(),overrides:rangeOverrides('2024-01-01','2029-12-31','rest')},[])
  const result=value(calculateNextSalary(cal,'2026-05-10',10,'delay'))
  assert.equal(result.status,'notFound');if(result.status==='notFound')assert.equal(result.reason,'noWorkingDay')
  assert.equal('actualDate' in result,false)
})
test('actual dates only beyond future horizon do not become valid near paydays',()=>{
  const today='2026-10-13',target=value(addDays(today,367))
  const cal=calendar({...rules(),overrides:rangeOverrides(value(addDays(today,-400)),value(addDays(target,-1)),'rest')},[])
  const result=value(calculateNextSalary(cal,today,13,'delay'))
  assert.equal(result.status,'notFound');if(result.status==='notFound')assert.equal(result.reason,'outsideHorizon')
})
test('calendar query failures and throws cannot fabricate an actual payday',()=>{
  const error: Calendar={getDay(){return {ok:false,error:{code:'UNAVAILABLE',message:'calendar unavailable'}}}}
  rejected(calculateNextSalary(error,'2026-05-10',10),'UNAVAILABLE')
  rejected(adjustSalaryDate({getDay(){throw new Error('private')}},'2026-05-10','delay'),'UNAVAILABLE')
})
test('input illegal policy/date/day differ from search no-result',()=>{
  rejected(calculateNextSalary(baseline,'2026-02-29',10))
  rejected(calculateNextSalary(baseline,'2026-05-10',32))
  rejected(calculateNextSalary(baseline,'2026-05-10',10,'unknown' as never))
  rejected(adjustSalaryDate(baseline,'2026-05-10','unknown' as never))
})
test('Civil month-window clipping is explicit, without year zero/10000 normalization',()=>{
  const first=salary('0001-01-01',1,'none'),last=salary('9999-12-31',31,'none')
  assert.equal(first.actualDate,'0001-01-01');assert.equal(first.cycles.length,13)
  assert.deepEqual(first.skippedMonthOffsets,Array.from({length:12},(_,i)=>i-12))
  assert.equal(last.actualDate,'9999-12-31');assert.equal(last.cycles.length,13)
  assert.deepEqual(last.skippedMonthOffsets,Array.from({length:12},(_,i)=>i+1))
  rejected(calculateNextSalary(baseline,'9999-12-31',30,'none'))
})
test('adjustment overflow is a structured error, not no-working-day or a valid date',()=>{
  const restEveryDay=calendar({...rules(),overrides:{'0001-01-01':'rest','9999-12-31':'rest'}},[])
  rejected(adjustSalaryDate(restEveryDay,'0001-01-01','advance'))
  rejected(adjustSalaryDate(restEveryDay,'9999-12-31','delay'))
})
test('unresolvable boundary cycles are preserved when a later valid cycle exists',()=>{
  const cal=calendar({workWeek:[2],overrides:{}},[])
  const result=value(calculateNextSalary(cal,'0001-01-01',1,'advance'))
  assert.equal(result.status,'found')
  assert.equal(result.cycles[0].result.status,'dateBoundary')
})
test('business results are detached serializable DTOs compatible with snapshot fields',()=>{
  const employed=employment('2026-10-16','2026-10-19')
  const employmentDto: DashboardSnapshot['employment']=employed
  assert.equal(validateJsonDto(employmentDto).ok,true)
  const next=rest('2026-10-19');if(next.status==='found'){const dto: DashboardSnapshot['nextRest']=next;assert.equal(validateJsonDto(dto).ok,true)}
  const pay=salary('2026-05-10');const salaryDto: DashboardSnapshot['salary']=pay
  assert.equal(validateJsonDto(salaryDto).ok,true)
  pay.quality.incompleteYears.push(2099);assert.deepEqual(salary('2026-05-10').quality.incompleteYears,[])
})
test('ambiguous and notFound cannot be cast into a singular snapshot salary',()=>{
  function compileOnly(result: SalaryResult): void {
    if(result.status==='ambiguous') {
      // @ts-expect-error Multiple origins require an explicit downstream policy.
      const singular: NonNullable<DashboardSnapshot['salary']>=result
      void singular
    }
  }
  void compileOnly
})
test('advance collisions preserve future nominal cycles without selecting one',()=>{
  const cal=calendar({...rules(),overrides:rangeOverrides('2026-05-10','2026-06-10','rest')})
  const result=value(calculateNextSalary(cal,'2026-05-09',10,'advance'))
  assert.equal(result.status,'ambiguous')
  if(result.status==='ambiguous'){
    assert.equal(result.actualDate,'2026-05-09');assert.equal(result.days,0)
    assert.deepEqual(result.matchingCycles.map(cycle=>cycle.nominalDate),['2026-05-10','2026-06-10'])
  }
})
test('global salary selection includes actual distance 366',()=>{
  const today='2026-10-13',target=value(addDays(today,366))
  const cal=calendar({workWeek:[1,2,3,4,5,6,7],overrides:rangeOverrides(value(addDays(today,-400)),value(addDays(target,-1)),'rest')},[])
  const result=value(calculateNextSalary(cal,today,13,'delay'))
  assert.notEqual(result.status,'notFound')
  if(result.status!=='notFound'){assert.equal(result.actualDate,target);assert.equal(result.days,366)}
})
test('unchanged advance salary date has canonical zero displacement',()=>{
  const result=value(adjustSalaryDate(baseline,'2026-06-10','advance'))
  assert.equal(result.status,'found');if(result.status==='found'){assert.equal(result.shiftDays,0);assert.equal(Object.is(result.shiftDays,-0),false)}
})
