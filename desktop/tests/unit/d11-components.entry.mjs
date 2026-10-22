import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DashboardView from '../../src/renderer/src/views/DashboardView.vue'
import SettingsView from '../../src/renderer/src/views/SettingsView.vue'
import { createAppConfig, createDefaultAppConfig } from '../../src/shared/config-schema.ts'
import { createDashboardEngine } from '../../src/domain/dashboard.ts'
import { currentOvertimeShift, expectedEndOvertime, shiftEndLabel } from '../../src/domain/expected-end.ts'
import { createCalendar } from '../../src/domain/calendar.ts'
import { createFixedClock } from '../../src/domain/clock.ts'
import { createIntlTimeZoneAdapter } from '../../src/adapters/intl-time-zone.ts'
import { loadBundledCalendarStore } from '../../src/main/services/calendar-store.ts'
export { createSettingsController } from '../../src/renderer/src/ui/settings-controller.ts'
export { initialEditor, editorFrom, asDraft, fieldIssues, fieldMessage } from '../../src/renderer/src/ui/settings-editor.ts'
export { durationText, wallLabel, qualityText } from '../../src/renderer/src/ui/dashboard-display.ts'
export { createSettingsDraft } from '../../src/shared/settings-draft.ts'
export { createV2Bridge } from '../../src/shared/bridge.ts'
export { validateContractRequest } from '../../src/shared/capabilities.ts'
export { createDefaultAppConfig } from '../../src/shared/config-schema.ts'
export { salaryMonthLabel } from '../../src/renderer/src/ui/dashboard-display.ts'
export {MAIN_WINDOW_DEFAULT_SIZE,MINI_WINDOW_DEFAULT_SIZE,MINI_WINDOW_MINIMUM_SIZE} from '../../src/main/windows/window-bounds.ts'
const value=result=>{if(!result.ok)throw Error(JSON.stringify(result));return result.data}
export function fixtures(){
  const calendars=value(loadBundledCalendarStore()),zones=createIntlTimeZoneAdapter()
  const config=value(createAppConfig({startDate:'2026-10-01',startTime:'09:00',endTime:'18:00',salaryDay:10,themeMode:'system',themeAccent:'ocean',updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'}))
  config.revision=1;config.calendar.enabledYears=[2024,2025,2026];config.calendar.datasets=calendars.listMetadata();config.schedule.breaks=[{startTime:'12:00',endTime:'13:00',startDayOffset:0,endDayOffset:0}]
  const read=(at,change=()=>{})=>{const c=structuredClone(config);change(c);const engine=value(createDashboardEngine(c,calendars,zones,100000));const clock=value(createFixedClock(Date.parse(at),'UTC',zones));return {...value(engine.calculate(value(clock.read()))),sequence:1,configRevision:c.revision,calendarRevision:1}}
  const defaultConfig=value(createDefaultAppConfig({updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'},calendars.listMetadata()))
  const defaultEngine=value(createDashboardEngine(defaultConfig,calendars,zones,100000)),defaultClock=value(createFixedClock(Date.parse('2026-10-15T09:00:00Z'),'Asia/Shanghai',zones))
  const defaultSnapshot={...value(defaultEngine.calculate(value(defaultClock.read()))),sequence:1,configRevision:0,calendarRevision:1}
  const calendar=value(createCalendar({workWeek:config.schedule.workWeek,overrides:{}},[2024,2025,2026].map(year=>value(calendars.readYear(year)))))
  const context={calendar,zones,timeZoneId:'UTC'},now=value(value(createFixedClock(Date.parse('2026-10-15T15:00:00Z'),'UTC',zones)).read()),shift=value(currentOvertimeShift(config,now,context))
  const expectedEnd={available:true,targetKey:'headless-target',shiftDate:shift.shiftDate,normalEnd:value(shiftEndLabel(shift.normalEndsAt,context)),finalEnd:value(shiftEndLabel(shift.finalEndsAt,context)),minutes:0}
  const expectedByTime=Object.fromEntries(['18:00','19:00','20:00','00:30'].map(time=>{const overtime=value(expectedEndOvertime(config,shift,time,context)),minutes=overtime.entries.find(x=>x.shiftDate===shift.shiftDate)?.minutes??0;return [time,{overtime,end:value(shiftEndLabel(shift.normalEndsAt+minutes*60000,context))}]}))
  return { config,defaultConfig,defaultSnapshot,expectedEnd,expectedByTime,metadata:calendars.listMetadata(),snapshots:{
    working:read('2026-10-15T15:00:00Z'),beforeWork:read('2026-10-15T08:30:00Z'),break:read('2026-10-15T12:30:00Z'),finished:read('2026-10-15T18:00:00Z'),rest:read('2026-10-17T12:00:00Z'),
    approved:read('2026-10-22T19:04:24Z',c=>{c.employee.startDate='2025-07-17';c.overtime.entries=[{shiftDate:'2026-10-22',minutes:240}]}),
    overtime:read('2026-10-15T18:15:00Z',c=>{c.overtime.entries=[{shiftDate:'2026-10-15',minutes:60}]}),
    overnight:read('2026-10-16T00:01:00Z',c=>{c.schedule={...c.schedule,startTime:'22:00',endTime:'06:00',crossMidnight:true,breaks:[]}}),
    estimate:read('2027-01-04T12:00:00Z'),
    rollback:read('2026-10-15T15:00:00Z',c=>{c.overtime.entries=[{shiftDate:'2026-10-15',minutes:60}]}),
    ambiguity:read('2026-10-15T12:00:00Z',c=>{c.salary.nonWorkingPolicy='delay';c.salary.day=31;c.schedule.workWeek=[1];c.calendar.overrides=Object.fromEntries(Array.from({length:110},(_,i)=>{const date=new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10);return [date,'rest']}))})
  }}
}
export function renderDashboard(snapshot){return renderToString(createSSRApp({render:()=>h(DashboardView,{snapshot})}))}
export function renderSettings(model,metadata,options={}){return renderToString(createSSRApp({render:()=>h(SettingsView,{model,metadata,issues:[],busy:false,dirty:false,initialized:false,canSave:true,api:{},...options})}))}
