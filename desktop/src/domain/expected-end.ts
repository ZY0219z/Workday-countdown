import type { EditableConfig, Result } from '../shared/contracts'
import type { ClockReading } from './clock'
import { issue, success, validationFailure } from '../shared/validation'
import { addDays } from './local-date'
import { minutesSinceMidnight, MILLISECONDS_PER_MINUTE } from './local-time'
import { calculateScheduleAt, validateShiftConflicts, type ResolvedShift, type ScheduleContext } from './schedule'
import { clearOvertimeForShift, setOvertimeForShift, type OvertimeConfig } from './overtime'

const invalid = (message:string):Result<never> => validationFailure([issue('$.expectedEndTime','FORMAT',message)])
export function currentOvertimeShift(settings:EditableConfig, now:ClockReading, context:ScheduleContext):Result<ResolvedShift> {
  const selection=calculateScheduleAt(settings.schedule,settings.overtime,now.instant,context)
  if(!selection.ok)return selection
  // D06 selects an active prior shift first, then today's (even before/after it).
  if(!selection.data.shift||selection.data.state==='incomplete')return {ok:false,error:{code:'UNAVAILABLE',message:'当前没有可明确识别的常规班次，不能设置今天加班。'}}
  return validateShiftConflicts(settings.schedule,settings.overtime,selection.data.shift.shiftDate,context)
}
export function shiftEndLabel(instant:number,context:ScheduleContext):Result<{date:string;time:string}> {
  const wall=context.zones.project(instant,context.timeZoneId)
  if(!wall.ok)return wall
  if(wall.data.time.second||wall.data.time.millisecond)return invalid('当前结束时刻不能用整分钟准确表示，未作自动推算。')
  return success({date:wall.data.date,time:[wall.data.time.hour,wall.data.time.minute].map(x=>String(x).padStart(2,'0')).join(':')})
}
// Only maps one already-resolved shift; no clock, file, renderer or new timer.
export function expectedEndOvertime(settings:EditableConfig,shift:ResolvedShift,input:string|null,context:ScheduleContext):Result<OvertimeConfig> {
  const guard=(candidate:OvertimeConfig)=>validateShiftConflicts(settings.schedule,candidate,shift.shiftDate,context)
  if(input===null){const cleared=clearOvertimeForShift(settings.overtime,shift.shiftDate);if(!cleared.ok)return cleared;const valid=guard(cleared.data);return valid.ok?cleared:valid}
  const minutes=minutesSinceMidnight(input),normal=shiftEndLabel(shift.normalEndsAt,context)
  if(!minutes.ok)return invalid('请输入24小时制HH:MM（00:00–23:59），例如19:00。')
  if(!normal.ok)return normal
  const baseline=minutesSinceMidnight(normal.data.time);if(!baseline.ok)return baseline
  // Numeric wall minutes establish the displayed next-day intent; actual elapsed
  // minutes always come from D03 IANA resolution, never from a string difference.
  const date=minutes.data<baseline.data?addDays(normal.data.date,1):success(normal.data.date)
  if(!date.ok)return date
  const resolved=context.zones.resolve({date:date.data,time:{hour:Math.floor(minutes.data/60),minute:minutes.data%60,second:0,millisecond:0}},context.timeZoneId)
  if(!resolved.ok)return resolved
  if(resolved.data.kind!=='unique')return invalid('预计结束时刻存在DST重复或缺失，不能自动选择。请填写可明确解析的时间。')
  const amount=(resolved.data.instant-shift.normalEndsAt)/MILLISECONDS_PER_MINUTE
  if(!Number.isSafeInteger(amount)||amount<0||amount>600)return invalid('预计下班须在正常下班之后，额外时长为0–600整分钟；较早时刻按次日解释。')
  return setOvertimeForShift(settings.overtime,shift.shiftDate,amount,guard)
}
