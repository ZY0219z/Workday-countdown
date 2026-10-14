import type { AppConfig, DashboardSnapshot, JsonObject, Result, SnapshotWarning } from '../shared/contracts'
import { success, validateJsonDto } from '../shared/validation'
import type { ClockReading } from './clock'
import type { CalendarYear } from './annual-calendar'
import { createCalendar } from './calendar'
import { calculateEmployment, calculateElapsedNaturalDays } from './employment'
import { calculateNextRestDay } from './rest-day'
import { calculateNextSalary } from './salary'
import { calculateScheduleAt, summarizeResolvedShift, type ScheduleSelection } from './schedule'
import { calculateProgress } from './progress'
import { exactDateQuality } from './calculation-quality'
import type { TimeZoneAdapter, LocalTimeResolution } from './time-zone'

export interface CalendarProvider { readYear(year: number): Result<CalendarYear | null> }
export type DashboardData = Omit<DashboardSnapshot, 'sequence' | 'calendarRevision'>
export interface DashboardEngine { calculate(now: ClockReading): Result<DashboardData>; invalidate(): void }
// Pure composition only. The host selects the finite history work budget.
export function createDashboardEngine(config: AppConfig, provider: CalendarProvider, zones: TimeZoneAdapter, maxHistoryDays: number): Result<DashboardEngine> {
  const years: CalendarYear[] = []
  for (const year of config.calendar.enabledYears) { const item=provider.readYear(year); if(!item.ok)return item; if(item.data)years.push(item.data) }
  const calendar=createCalendar({workWeek:config.schedule.workWeek,overrides:config.calendar.overrides},years)
  if(!calendar.ok)return calendar
  let dailyKey='', daily: Pick<DashboardData,'employment'|'nextRest'|'salary'|'warnings'|'salaryAmbiguity'> | null=null
  const endpoints=new Map<string,Result<LocalTimeResolution>>()
  let selection:ScheduleSelection|null=null,lastInstant:number|null=null
  const cachedZones:TimeZoneAdapter={project:zones.project,resolve(local,zone){
    const key=JSON.stringify([local,zone]);let value=endpoints.get(key)
    if(!value){value=zones.resolve(local,zone);if(endpoints.size>=256)endpoints.clear();endpoints.set(key,value)}return value
  }}
  return success({ invalidate(){daily=null;dailyKey='';endpoints.clear();selection=null;lastInstant=null}, calculate(now){
    try {
      const key=JSON.stringify([now.date,now.timeZoneId,now.offsetMilliseconds])
      if(key!==dailyKey||!daily){
        endpoints.clear();selection=null
        const warnings:SnapshotWarning[]=[], failed=(affects:SnapshotWarning['affects'])=>warnings.push({code:'CONFIG_INCOMPLETE',message:'部分业务计算未完成，请检查配置或计算预算。',affects,years:[]})
        const natural=calculateElapsedNaturalDays({startDate:config.employee.startDate,today:now.date})
        if(!natural.ok)return natural
        const employed=calculateEmployment({startDate:config.employee.startDate,today:now.date},calendar.data,{maxDays:maxHistoryDays})
        const employment:DashboardData['employment']=employed.ok?{status:employed.data.status,elapsedNaturalDays:employed.data.elapsedNaturalDays,
          plannedWorkDays:employed.data.plannedWorkDays,excludesToday:true,isActualAttendance:false,quality:employed.data.quality,naturalQuality:employed.data.naturalQuality}:
          {status:natural.data.status,elapsedNaturalDays:natural.data.elapsedNaturalDays,plannedWorkDays:null,excludesToday:true,isActualAttendance:false,quality:exactDateQuality(),naturalQuality:natural.data.quality}
        if(employed.ok)warnings.push(...employed.data.warnings);else failed(['employment'])
        const rest=calculateNextRestDay(calendar.data,now.date,{includeStart:true,maxDays:366})
        let nextRest:DashboardData['nextRest']=null
        if(rest.ok){warnings.push(...rest.data.warnings);if(rest.data.status==='found')nextRest={date:rest.data.date,days:rest.data.days,quality:rest.data.quality};else failed(['nextRest'])}else failed(['nextRest'])
        const pay=calculateNextSalary(calendar.data,now.date,config.salary.day,config.salary.nonWorkingPolicy)
        let salary:DashboardData['salary']=null,salaryAmbiguity:JsonObject|undefined
        if(pay.ok){warnings.push(...pay.data.warnings)
          if(pay.data.status==='found')salary={nominalDate:pay.data.nominalDate,actualDate:pay.data.actualDate,days:pay.data.days,policy:pay.data.policy,isPlanned:true,quality:pay.data.quality}
          else {failed(['salary']);if(pay.data.status==='ambiguous'){const dto=validateJsonDto(pay.data);if(!dto.ok)return dto;salaryAmbiguity=dto.data as JsonObject}}
        }else failed(['salary'])
        daily={employment,nextRest,salary,warnings,...(salaryAmbiguity?{salaryAmbiguity}:{})};dailyKey=key
      }
      if(lastInstant!==null&&now.instant<lastInstant){selection=null;endpoints.clear()}
      let selected:Result<ScheduleSelection>
      const shift=selection?.shift
      if(selection&&selection.state!=='incomplete'&&(!shift||now.instant<shift.finalEndsAt||(shift.shiftDate===now.date&&lastInstant!==null&&lastInstant>=shift.finalEndsAt))){
        const summarized=shift?summarizeResolvedShift(shift,now.instant,now.timeZoneId):success({state:'rest' as const,countdown:null})
        selected=summarized.ok?success({...selection,...summarized.data,instant:now.instant}):summarized
      }else selected=calculateScheduleAt(config.schedule,config.overtime,now.instant,{calendar:calendar.data,zones:cachedZones,timeZoneId:now.timeZoneId})
      selection=selected.ok?selected.data:null;lastInstant=now.instant
      const warnings=daily.warnings.slice();let state:DashboardData['state']='incomplete',activeShift:DashboardData['activeShift']=null,countdown:DashboardData['countdown']=null,progress:DashboardData['progress']=null
      if(selected.ok){state=selected.data.state;warnings.push(...selected.data.warnings)
        const shift=selected.data.shift
        if(shift){activeShift={shiftDate:shift.shiftDate,startsAt:shift.startsAt,normalEndsAt:shift.normalEndsAt,finalEndsAt:shift.finalEndsAt,breaks:shift.breaks,overtimeMinutes:shift.overtimeMinutes,quality:shift.quality}}
        countdown=selected.data.countdown
        const calculated=calculateProgress(shift,now.instant,now.timeZoneId)
        if(calculated.ok&&calculated.data)progress={percent:calculated.data.percent,elapsedWorkSeconds:calculated.data.elapsedWorkSeconds,totalWorkSeconds:calculated.data.totalWorkSeconds,quality:calculated.data.quality}
        else if(!calculated.ok){state='incomplete';warnings.push({code:'CONFIG_INCOMPLETE',message:'工作进度不可计算。',affects:['progress'],years:[]})}
      }else warnings.push({code:'CONFIG_INCOMPLETE',message:'当前班次无法解析，未生成倒计时或进度。',affects:['activeShift','countdown','progress'],years:[]})
      if(warnings.some(w=>w.code==='CONFIG_INCOMPLETE'||w.code==='TIME_AMBIGUOUS'))state='incomplete'
      const unique=[...new Map(warnings.map(w=>[JSON.stringify(w),w])).values()]
      return success({computedAt:now.instant,localDate:now.date,timeZoneId:now.timeZoneId,configRevision:config.revision,state,activeShift,
        employment:daily.employment,nextRest:daily.nextRest,salary:daily.salary,countdown,progress,warnings:unique,...(daily.salaryAmbiguity?{salaryAmbiguity:daily.salaryAmbiguity}:{})})
    }catch{return {ok:false,error:{code:'UNAVAILABLE',message:'无法完成统一快照计算。'}}}
  }})
}
