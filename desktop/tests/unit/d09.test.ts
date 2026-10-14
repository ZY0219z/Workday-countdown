import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { value,rejected,context,initial,zones } from './config-fixtures'
import { createAppConfig } from '../../src/shared/config-schema'
import type { AppConfig, Result, DashboardSnapshot, ContractRequests } from '../../src/shared/contracts'
import { success,validateJsonDto } from '../../src/shared/validation'
import { createDashboardEngine } from '../../src/domain/dashboard'
import { createFixedClock } from '../../src/domain/clock'
import { createSnapshotService } from '../../src/main/services/snapshot-service'
import { createRefreshCoordinator, type TimerPort } from '../../src/main/services/clock'
import { createRuntime,combineExitDrafts } from '../../src/main/services/runtime'
import { nodeConfigFiles } from '../../src/main/services/config-files'
import { createTimeZoneCache } from '../../src/domain/time-zone-cache'
import { createConfigStore } from '../../src/main/services/config-store'
import { editableConfig } from '../../src/main/services/config-validation'
import { createMigrationService } from '../../src/main/services/migration-service'
import { createMigrationFiles } from '../../src/main/services/migration-files'
import { createOperationBarrier } from '../../src/main/lifecycle/operation-barrier'
import { createQuitCoordinator } from '../../src/main/lifecycle/quit-coordinator'
import { createIpcRouter,type IpcEvent } from '../../src/main/ipc/router'
import { createV2Bridge } from '../../src/shared/bridge'
import { V2_CHANNELS, SNAPSHOT_PUSH } from '../../src/shared/ipc'

const roots:string[]=[]
after(async()=>{for(const path of roots){assert.ok(path.startsWith(join(tmpdir(),'workday-d09-')));await rm(path,{recursive:true,force:true})}})
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
class Timers implements TimerPort {
  jobs=new Map<object,{callback:()=>void;delay:number}>()
  set(callback:()=>void,delay:number){const handle={};this.jobs.set(handle,{callback,delay});return handle}
  clear(handle:unknown){this.jobs.delete(handle as object)}
  tick(){const next=this.jobs.entries().next().value!;this.jobs.delete(next[0]);next[1].callback()}
  delay(){assert.equal(this.jobs.size,1);return [...this.jobs.values()][0].delay}
}
function config():AppConfig{const c=value(createAppConfig({...initial,startDate:'2026-10-14',updatedAt:'2026-10-14T10:00:00.000Z',appVersion:'2.0.0'}));c.calendar.enabledYears=[2024,2025,2026];c.calendar.datasets=context().calendars.listMetadata();return c}
function dashboard(c=config(),at='2026-10-14T10:00:00Z',zone='UTC'){
  const ctx=context(),clock=value(createFixedClock(Date.parse(at),zone,zones)),engine=value(createDashboardEngine(c,ctx.calendars,zones,100000))
  return {engine,clock,read:()=>value(engine.calculate(value(clock.read())))}
}
async function runtimeFixture(options:{source?:AppConfig;broken?:string;files?:import('../../src/main/services/config-files').ConfigFiles}={}){
  const directory=await mkdtemp(join(tmpdir(),'workday-d09-'));roots.push(directory)
  if(options.source)await writeFile(join(directory,'settings.json'),JSON.stringify(options.source))
  if(options.broken)await writeFile(join(directory,'settings.json'),options.broken)
  const ctx=context(),store=value(createConfigStore({...ctx,directory,appVersion:'2.0.0',files:options.files})),timers=new Timers(),writes=createOperationBarrier()
  const runtime=createRuntime({...ctx,store,timers,writes,maxHistoryDays:100000,confirm:async()=>success('continueEditing')})
  value(await runtime.start());await flush();after(()=>runtime.dispose())
  return {directory,ctx,store,timers,writes,runtime}
}

for(const [time,state,target] of [['08:00','beforeWork','workStart'],['10:00','working','finalWorkEnd'],['12:30','break','finalWorkEnd'],['18:30','overtime','finalWorkEnd'],['20:00','finished','finalWorkEnd']] as const){
  test(`snapshot ${state} preserves shared shift/target and lunch progress`,()=>{
    const c=config();c.schedule.breaks=[{startTime:'12:00',endTime:'13:00',startDayOffset:0,endDayOffset:0}];c.overtime.entries=[{shiftDate:'2026-10-14',minutes:60}]
    const app=dashboard(c,`2026-10-14T${time}:00Z`),s=app.read();assert.equal(s.state,state);assert.equal(s.countdown?.target,target);assert.equal(s.activeShift?.shiftDate,'2026-10-14');assert.equal(s.progress?.totalWorkSeconds,9*3600)
    if(state==='break'){const before=s.progress!.elapsedWorkSeconds;value(app.clock.advanceMilliseconds(10*60000));assert.equal(app.read().progress!.elapsedWorkSeconds,before)}
  })
}
test('rest has no fabricated progress or current shift',()=>{const app=dashboard(config(),'2026-10-18T10:00:00Z');assert.equal(app.read().state,'rest');assert.equal(app.read().progress,null)})
test('cross midnight keeps prior shift; another date boundary is supported',()=>{
  const c=config();c.schedule={...c.schedule,startTime:'23:30',endTime:'23:30',crossMidnight:true};c.overtime.entries=[{shiftDate:'2026-10-14',minutes:60}];c.calendar.overrides={'2026-10-15':'rest'}
  const app=dashboard(c,'2026-10-15T00:10:00Z');assert.equal(app.read().activeShift?.shiftDate,'2026-10-14');value(app.clock.setInstant(Date.parse('2026-10-16T00:10:00Z')));assert.equal(app.read().state,'overtime');assert.equal(app.read().activeShift?.shiftDate,'2026-10-14')
})
test('overtime change regresses progress, histories unchanged and clear affects only requested shift',()=>{
  const c=config();c.overtime.entries=[{shiftDate:'2020-01-01',minutes:80},{shiftDate:'2026-10-14',minutes:0}];const old=dashboard(c).read()
  c.overtime.entries[1].minutes=120;const next=dashboard(c).read();assert.ok(next.progress!.percent<old.progress!.percent);assert.equal(c.overtime.entries[0].minutes,80)
  c.overtime.entries[1].minutes=0;assert.equal(dashboard(c).read().activeShift?.overtimeMinutes,0)
})
test('missing annual package propagates estimate while natural days retain exact quality',()=>{
  const c=config();c.employee.startDate='2026-12-31';const s=dashboard(c,'2027-01-02T12:00:00Z').read();assert.equal(s.employment.elapsedNaturalDays,2);assert.equal(s.employment.naturalQuality!.approximate,false);assert.ok(s.warnings.some(w=>w.code==='CALENDAR_INCOMPLETE'))
})
test('future and unset employment distinguish zero from missing',()=>{const c=config();c.employee.startDate='2027-01-01';assert.equal(dashboard(c).read().employment.status,'notStarted');c.employee.startDate=null;assert.equal(dashboard(c).read().employment.elapsedNaturalDays,null)})
test('history work budget failure preserves independent natural count and controlled incompleteness',()=>{const c=config();c.employee.startDate='2020-01-01';const ctx=context();const engine=value(createDashboardEngine(c,ctx.calendars,zones,1));const s=value(engine.calculate(value(ctx.clock.read())));assert.ok(s.employment.elapsedNaturalDays!>1);assert.equal(s.employment.plannedWorkDays,null);assert.equal(s.state,'incomplete')})
test('salary coalescing preserves ALL original ambiguity, no invented nominal period',()=>{
  const c=config();c.salary.day=1;c.salary.nonWorkingPolicy='delay';c.schedule.workWeek=[1];
  // Force more than one monthly nominal cycle to the next actual working date.
  c.calendar.enabledYears=[];for(let d=1;d<=31;d++)c.calendar.overrides[`2026-01-${String(d).padStart(2,'0')}`]='rest'
  c.calendar.overrides['2026-02-01']='rest';c.calendar.overrides['2026-02-02']='work'
  const s=dashboard(c,'2026-01-01T10:00:00Z').read();assert.equal(s.salary,null);assert.equal(s.state,'incomplete');assert.equal(s.salaryAmbiguity!.status,'ambiguous');assert.ok((s.salaryAmbiguity!.matchingCycles as unknown[]).length>=2);assert.ok(Array.isArray(s.salaryAmbiguity!.cycles))
})
for(const [date,start,end] of [['2026-03-08','02:30','04:30'],['2026-11-01','01:30','04:30']] as const){test(`DST gap/fold ${date} gives no fake countdown`,()=>{const c=config();c.schedule.workWeek=[7];c.schedule.startTime=start;c.schedule.endTime=end;const s=dashboard(c,`${date}T08:00:00Z`,'America/New_York').read();assert.equal(s.state,'incomplete');assert.equal(s.countdown,null);assert.equal(s.progress,null)})}
test('same-day seconds reuse historical traversal and resolved boundaries; date/tz/rollback invalidate',()=>{
  const c=config();c.employee.startDate='2026-10-01';const ctx=context();let years=0,inverses=0
  const engine=value(createDashboardEngine(c,{readYear(y){years++;return ctx.calendars.readYear(y)}},{project:zones.project,resolve(l,z){inverses++;return zones.resolve(l,z)}},100000)),clock=ctx.clock
  const first=value(engine.calculate(value(clock.read()))),count=inverses
  for(let i=0;i<60;i++){value(clock.advanceMilliseconds(1000));const s=value(engine.calculate(value(clock.read())));assert.equal(s.employment.plannedWorkDays,first.employment.plannedWorkDays)}
  assert.equal(inverses,count);assert.equal(years,3)
  value(clock.advanceMilliseconds(-60000));value(engine.calculate(value(clock.read())));assert.ok(inverses>count)
  value(clock.setInstant(Date.parse('2026-10-15T10:00:00Z')));assert.equal(value(engine.calculate(value(clock.read()))).localDate,'2026-10-15')
  value(clock.setTimeZone('America/New_York'));assert.equal(value(engine.calculate(value(clock.read()))).timeZoneId,'America/New_York')
})
test('prior shift ending within same day releases selection and finds today shift',()=>{const c=config();c.schedule={...c.schedule,startTime:'22:00',endTime:'06:00',crossMidnight:true};const app=dashboard(c,'2026-10-15T05:00:00Z');assert.equal(app.read().activeShift!.shiftDate,'2026-10-14');value(app.clock.setInstant(Date.parse('2026-10-15T07:00:00Z')));assert.equal(app.read().activeShift!.shiftDate,'2026-10-15');assert.equal(app.read().state,'beforeWork')})
test('snapshot sequence shared on identical clock state; rollback still monotonic',async()=>{
  const ctx=context(),service=createSnapshotService(ctx.clock,c=>createDashboardEngine(c,ctx.calendars,zones,100000));value(service.setConfig(config(),4));const a=value(await service.read()),b=value(await service.read());assert.equal(a.sequence,b.sequence);assert.equal(a.calendarRevision,4);value(ctx.clock.advanceMilliseconds(-60000));assert.ok(value(await service.read()).sequence>a.sequence);service.dispose()
})
test('clock failure sends error, never returns prior valid countdown',async()=>{const ctx=context();let fail=false;const service=createSnapshotService({read:()=>fail?{ok:false,error:{code:'UNAVAILABLE',message:'fixture'}}:ctx.clock.read()},c=>createDashboardEngine(c,ctx.calendars,zones,100000));value(service.setConfig(config(),1));value(await service.read());fail=true;rejected(await service.read(),'UNAVAILABLE');assert.equal(service.peek(),null);service.dispose()})
test('older async computation cannot publish over new config generation',async()=>{
  const ctx=context();let resolve!:(v:Result<import('../../src/domain/dashboard').DashboardData>)=>void;const data=dashboard().read();let calls=0
  const service=createSnapshotService(ctx.clock,c=>success({invalidate(){},calculate(){calls++;return calls===1?new Promise(r=>resolve=r):success({...data,configRevision:c.revision})}}))
  value(service.setConfig(config(),1));const old=service.read();value(service.setConfig({...config(),revision:2},2));const current=value(await service.read());resolve(success(data));rejected(await old,'CANCELLED');assert.equal(service.peek()!.ok,true);assert.equal(value(service.peek()!).sequence,current.sequence);assert.equal(current.configRevision,2);assert.equal(current.calendarRevision,2);service.dispose()
})
test('hidden 60s, visible 1Hz, repeated subscriptions and resume maintain one timer',async()=>{
  const ctx=context(),service=createSnapshotService(ctx.clock,c=>createDashboardEngine(c,ctx.calendars,zones,100000));value(service.setConfig(config(),1));const timers=new Timers(),refresh=createRefreshCoordinator(service,timers);refresh.start();await flush();assert.equal(timers.delay(),60000)
  let visible=true;const key={};let delivered=0;const client={visible:()=>visible,push:()=>{delivered++}}
  refresh.subscribe(key,client);refresh.subscribe(key,client);await flush();assert.equal(refresh.subscriberCount(),1);assert.equal(timers.delay(),1000)
  value(ctx.clock.advanceMilliseconds(1000));timers.tick();await flush();assert.ok(delivered>0);assert.equal(timers.jobs.size,1)
  visible=false;refresh.visibilityChanged();assert.equal(timers.delay(),60000);value(ctx.clock.advanceMilliseconds(3600000));refresh.wake(true);await flush();assert.equal(value(service.peek()!).computedAt,value(ctx.clock.read()).instant)
  refresh.unsubscribe(key);refresh.unsubscribe(key);refresh.dispose();service.dispose();assert.equal(timers.jobs.size,0)
})
test('startup missing configuration performs no write and has a real uninitialized draft',async()=>{const a=await runtimeFixture();rejected(a.runtime.readConfig(),'UNAVAILABLE');assert.equal(value(a.runtime.readDraft()).saved,null);rejected(await a.runtime.snapshots.read(),'UNAVAILABLE');await assert.rejects(readFile(join(a.directory,'settings.json')))})
test('startup invalid/future never auto initializes or overwrites original bytes',async()=>{for(const text of ['broken','{"schemaVersion":99}']){const a=await runtimeFixture({broken:text});rejected(a.runtime.readConfig(),text==='broken'?'UNAVAILABLE':'UNSUPPORTED_SCHEMA');assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),text)}})
test('first draft updates/discards without writing defaults; explicit save initializes revision one',async()=>{const a=await runtimeFixture();const settings=value(editableConfig(config()));value(a.runtime.updateDraft({draft:settings as unknown as import('../../src/shared/contracts').JsonObject,expectedRevision:0}));assert.equal(value(a.runtime.readDraft()).dirty,true);value(a.runtime.discardDraft());assert.equal(value(a.runtime.readDraft()).dirty,false);const result=value(await a.runtime.save({settings,expectedRevision:0}));assert.equal(result.config.revision,1);assert.equal(value(a.runtime.readDraft()).saved!.revision,1);assert.equal(value(await a.runtime.snapshots.read()).configRevision,1)})
test('save failure retains old config, draft and cached snapshot revision',async()=>{const a=await runtimeFixture({source:config()});const settings=value(editableConfig(config()));settings.schedule.endTime='08:00';const before=await readFile(join(a.directory,'settings.json'),'utf8');rejected(await a.runtime.save({settings,expectedRevision:0}));assert.equal(value(a.runtime.readDraft()).dirty,true);assert.equal(value(a.runtime.readDraft()).save.status,'failed');assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),before);assert.equal(value(a.runtime.readConfig()).config.schedule.endTime,'18:00');assert.equal(value(await a.runtime.snapshots.read()).configRevision,0)})
test('external edits reject save; old revision requests cannot overwrite fresh authority',async()=>{const a=await runtimeFixture();const settings=value(editableConfig(config()));const saved=value(await a.runtime.save({settings,expectedRevision:0}));rejected(await a.runtime.save({settings,expectedRevision:0}),'REVISION_CONFLICT');await writeFile(join(a.directory,'settings.json'),JSON.stringify({...saved.config,revision:2}));rejected(await a.runtime.save({settings,expectedRevision:1}),'REVISION_CONFLICT');await writeFile(join(a.directory,'settings.json'),'{"schemaVersion":99}');rejected(await a.runtime.save({settings,expectedRevision:1}),'UNSUPPORTED_SCHEMA');assert.equal(value(a.runtime.readDraft()).dirty,false)})
test('dirty formal adapter blocks silent exit; explicit discard clears only the draft',async()=>{const a=await runtimeFixture();value(a.runtime.updateDraft({draft:{employee:{startDate:'2026-01-01'}},expectedRevision:0}));const quit=createQuitCoordinator({waitMilliseconds:100,confirmationMilliseconds:100,waitForWrites:a.writes.drain,restoreMain(){},commitQuit:()=>success(null)});quit.registerDraft(a.runtime.exitAdapter);rejected(await quit.requestQuit(),'CANCELLED');assert.equal(value(a.runtime.readDraft()).dirty,true);const d=value(await a.runtime.exitAdapter.read());value(await a.runtime.exitAdapter.discard(d.identity));assert.equal(value(a.runtime.readDraft()).dirty,false);quit.dispose()})
test('migration success invalidates existing clean draft and cached revisions',async()=>{
  const a=await runtimeFixture();value(await a.runtime.save({settings:value(editableConfig(config())),expectedRevision:0}));const source=join(a.directory,'poc.json');await writeFile(source,'{"workStartTime":"10:00","workEndTime":"19:00"}')
  a.runtime.dispose();const migration=createMigrationService({...a.ctx,store:a.store,sources:createMigrationFiles({selectImport:async()=>source,selectExport:async()=>null})})
  const runtime=createRuntime({...a.ctx,store:a.store,migration,timers:a.timers,writes:a.writes,maxHistoryDays:100000,confirm:async()=>success('continueEditing')});value(await runtime.start())
  const preview=value(await runtime.previewImport({sourceKind:'electron-poc'}));const result=value(await runtime.applyImport({previewToken:preview.previewToken,expectedRevision:1,selectedFields:['schedule.startTime','schedule.endTime'],undatedOvertimeShiftDate:null}))
  assert.equal(result.config.revision,2);assert.equal(value(runtime.readDraft()).expectedRevision,2);assert.equal(value(await runtime.snapshots.read()).configRevision,2);assert.equal(await readFile(source,'utf8'),'{"workStartTime":"10:00","workEndTime":"19:00"}');runtime.dispose()
})
test('router validates actual role/frame/url and request, subscriptions revoke idempotently',async()=>{
  const a=await runtimeFixture(),handlers=new Map<string,(e:IpcEvent,i:unknown)=>Promise<unknown>>(),router=createIpcRouter({handle:(c,h)=>{assert.ok(!handlers.has(c));handlers.set(c,h)},removeHandler:c=>{handlers.delete(c)}},a.runtime,{window:()=>success(null),quit:async()=>success(null)})
  const sender={},frame={},mini={},miniFrame={};let url='file:///trusted',destroyed=false,pushed=0
  const release=router.register('main',{sender,frame:()=>frame,url:()=>url,destroyed:()=>destroyed,visible:()=>false,push:()=>pushed++},url)
  router.register('mini',{sender:mini,frame:()=>miniFrame,url:()=>url,destroyed:()=>false,visible:()=>false,push:()=>{}},url)
  const call=(method:keyof typeof V2_CHANNELS,event:IpcEvent={sender,senderFrame:frame},input:unknown=null)=>handlers.get(V2_CHANNELS[method])!(event,input) as Promise<Result<unknown>>
  value(await call('settingsDraft.read'));rejected(await call('config.save',{sender:mini,senderFrame:miniFrame},{}),'FORBIDDEN');rejected(await call('settingsDraft.read',{sender,senderFrame:{}}),'FORBIDDEN');rejected(await call('snapshot.read',{sender:{},senderFrame:frame}),'FORBIDDEN')
  url='file:///untrusted';rejected(await call('snapshot.read'),'FORBIDDEN');url='file:///trusted';destroyed=true;rejected(await call('snapshot.read'),'FORBIDDEN');destroyed=false
  rejected(await call('config.save',undefined,{settings:{},expectedRevision:0}));rejected(await call('window.perform',undefined,{action:'showMain',windowId:3}));rejected(await call('data.previewImport',undefined,{sourceKind:'v2',path:'C:\\secret'}))
  value(await call('snapshot.subscribe'));value(await call('snapshot.subscribe'));assert.equal(a.runtime.refresh.subscriberCount(),1);value(await call('snapshot.unsubscribe'));value(await call('snapshot.unsubscribe'));assert.equal(a.runtime.refresh.subscriberCount(),0);release();rejected(await call('snapshot.read'),'FORBIDDEN');router.dispose();assert.equal(handlers.size,0);assert.ok(pushed>=0)
})
test('IPC strips exception detail and never claims unimplemented imports succeed',async()=>{const a=await runtimeFixture(),handlers=new Map<string,(e:IpcEvent,i:unknown)=>Promise<unknown>>();const router=createIpcRouter({handle:(c,h)=>handlers.set(c,h),removeHandler:c=>{handlers.delete(c)}},a.runtime,{window(){throw Error('C:\\Users\\secret token stack')},quit:async()=>success(null)});const sender={},frame={};router.register('main',{sender,frame:()=>frame,url:()=>'/trusted',destroyed:()=>false,visible:()=>false,push(){}},'/trusted');const e={sender,senderFrame:frame};const result=await handlers.get(V2_CHANNELS['window.perform'])!(e,{action:'showMain'});assert.ok(!JSON.stringify(result).includes('secret'));value(validateJsonDto(result));rejected(await handlers.get(V2_CHANNELS['calendar.previewImport'])!(e,null) as Result<unknown>,'UNAVAILABLE');router.dispose()})
test('Preload fixed bridge mini surface, local subscriptions, transport failure DTO and no raw event',async()=>{
  const invocations:string[]=[];let listener:((v:unknown)=>void)|null=null,removed=0
  const transport={async invoke(channel:string){invocations.push(channel);return {ok:true,data:null}},listen(channel:string,callback:(v:unknown)=>void){assert.equal(channel,SNAPSHOT_PUSH);listener=callback;return()=>{removed++;listener=null}}}
  const main=createV2Bridge('main',transport),mini=createV2Bridge('mini',transport);assert.ok(!('config' in mini));assert.ok(!('invoke' in main));assert.ok(!('fs' in main));let received=0
  const fn=()=>{received++};value(await main.snapshot.subscribe(fn));value(await main.snapshot.subscribe(fn));assert.equal(invocations.filter(c=>c===V2_CHANNELS['snapshot.subscribe']).length,1);(listener! as (v:unknown)=>void)(success({sequence:1}));assert.equal(received,1);value(await main.snapshot.unsubscribe());assert.equal(removed,1)
  const failed=createV2Bridge('main',{invoke:async()=>{throw Error('secret')},listen:()=>()=>{}});rejected(await failed.config.read(),'INTERNAL');assert.ok(!JSON.stringify(await failed.config.read()).includes('secret'))
})

test('snapshot reads two clients from one consistent injected clock computation and isolates mutation',async()=>{
  const ctx=context();let computations=0,reads=0
  const service=createSnapshotService({read(){reads++;return ctx.clock.read()}},c=>{const engine=value(createDashboardEngine(c,ctx.calendars,zones,100000));return success({invalidate:engine.invalidate,calculate(now){computations++;return engine.calculate(now)}})})
  value(service.setConfig({...config(),revision:3},2));const [a,b]=await Promise.all([service.read(),service.read()])
  const left=value(a),right=value(b);assert.equal(computations,1);assert.equal(reads,2);assert.equal(left.sequence,right.sequence);assert.equal(left.computedAt,value(ctx.clock.read()).instant);assert.equal(left.localDate,value(ctx.clock.read()).date);assert.equal(left.configRevision,3)
  left.warnings.length=0;assert.deepEqual(value(await service.read()).warnings,right.warnings);service.dispose()
})

test('midnight/year and hidden shift boundary refresh on actual clock without catch-up ticks',async()=>{
  const ctx=context(),clock=value(createFixedClock(Date.parse('2026-12-31T23:59:59.500Z'),'UTC',zones)),c=config()
  c.schedule.startTime='00:00';c.schedule.endTime='23:59'
  const service=createSnapshotService(clock,input=>createDashboardEngine(input,ctx.calendars,zones,100000));value(service.setConfig(c,1))
  const timers=new Timers(),refresh=createRefreshCoordinator(service,timers);refresh.start();await flush();assert.equal(timers.delay(),500)
  value(clock.advanceMilliseconds(500));timers.tick();await flush();assert.equal(value(service.peek()!).localDate,'2027-01-01');assert.equal(timers.delay(),60000)
  value(clock.setInstant(Date.parse('2026-10-14T08:59:50Z')));c.schedule.startTime='09:00';c.schedule.endTime='18:00';value(service.setConfig(c,2));refresh.wake();await flush();assert.equal(timers.delay(),10000)
  value(clock.advanceMilliseconds(2*3600000));timers.tick();await flush();assert.equal(value(service.peek()!).computedAt,value(clock.read()).instant);assert.equal(value(service.peek()!).state,'working');assert.equal(timers.jobs.size,1)
  refresh.dispose();service.dispose()
})

test('same date timezone change invalidates dates and absolute shift boundaries',async()=>{
  const ctx=context(),service=createSnapshotService(ctx.clock,c=>createDashboardEngine(c,ctx.calendars,zones,100000));value(service.setConfig(config(),1))
  const utc=value(await service.read());value(ctx.clock.setTimeZone('America/New_York'));const ny=value(await service.read());assert.equal(ny.computedAt,utc.computedAt);assert.equal(ny.timeZoneId,'America/New_York');assert.notEqual(ny.activeShift!.startsAt,utc.activeShift!.startsAt);assert.ok(ny.sequence>utc.sequence);service.dispose()
})

test('successful overtime and calendar changes invalidate snapshots only at committed revisions',async()=>{
  const a=await runtimeFixture({source:config()}),before=value(await a.runtime.snapshots.read()),settings=value(editableConfig(config()))
  settings.overtime.entries=[{shiftDate:'2026-10-14',minutes:120}]
  value(await a.runtime.save({settings,expectedRevision:0}));const after=value(await a.runtime.snapshots.read());assert.equal(after.configRevision,1);assert.ok(after.progress!.percent<before.progress!.percent);assert.equal(after.calendarRevision,before.calendarRevision)
  settings.calendar.overrides['2026-10-14']='rest';settings.overtime.entries=[]
  value(await a.runtime.save({settings,expectedRevision:1}));const rest=value(await a.runtime.snapshots.read());assert.equal(rest.state,'rest');assert.equal(rest.progress,null);assert.ok(rest.calendarRevision>after.calendarRevision)
})

test('first initialization IO failure leaves no saved config and preserves the explicit dirty draft',async()=>{
  const a=await runtimeFixture({files:{...nodeConfigFiles,writeExclusiveFlush:async()=>{throw Object.assign(Error('fixture'),{code:'ENOSPC'})}}}),settings=value(editableConfig(config()))
  rejected(await a.runtime.save({settings,expectedRevision:0}),'UNAVAILABLE');const draft=value(a.runtime.readDraft());assert.equal(draft.saved,null);assert.equal(draft.dirty,true);assert.equal(draft.save.status,'failed');rejected(a.runtime.readConfig(),'UNAVAILABLE');await assert.rejects(readFile(join(a.directory,'settings.json')))
})

test('pending save protects the main draft and barrier; duplicate edits cannot race authority',async()=>{
  let entered!:()=>void,release!:()=>void;const enteredPromise=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r)
  const a=await runtimeFixture({files:{...nodeConfigFiles,async writeExclusiveFlush(path,text){entered();await hold;await nodeConfigFiles.writeExclusiveFlush(path,text)}}}),settings=value(editableConfig(config()))
  const saved=a.runtime.save({settings,expectedRevision:0});await enteredPromise;assert.equal(a.writes.pendingCount(),1);assert.equal(value(a.runtime.readDraft()).save.status,'saving')
  rejected(a.runtime.discardDraft(),'UNAVAILABLE');rejected(a.runtime.updateDraft({draft:{},expectedRevision:0}),'UNAVAILABLE');rejected(await a.runtime.save({settings,expectedRevision:0}),'UNAVAILABLE')
  release();value(await saved);value(await a.writes.drain());assert.equal(a.writes.pendingCount(),0);assert.equal(value(a.runtime.readConfig()).config.revision,1)
})

test('both POC and formal dirty domains are included in one D08 exit decision',async()=>{
  const a=await runtimeFixture();value(a.runtime.updateDraft({draft:{employee:{startDate:null}},expectedRevision:0}));let discarded=0
  const poc={read:async()=>success({dirty:true,saving:false,identity:'poc'}),confirm:async()=>success('continueEditing' as const),save:async()=>({ok:false as const,error:{code:'UNAVAILABLE' as const,message:'POC failure'}}),discard:async()=>{discarded++;return success(null)}}
  const combined=combineExitDrafts(a.runtime.exitAdapter,poc),draft=value(await combined.read());assert.equal(draft.dirty,true);rejected(await combined.save(draft.identity),'UNAVAILABLE');assert.equal(value(a.runtime.readDraft()).dirty,true)
  value(await combined.discard(draft.identity));assert.equal(discarded,1);assert.equal(value(a.runtime.readDraft()).dirty,false)
})

test('factory failure after revision change clears the prior valid snapshot and error is controlled',async()=>{
  const ctx=context(),service=createSnapshotService(ctx.clock,c=>c.revision===0?createDashboardEngine(c,ctx.calendars,zones,100000):{ok:false,error:{code:'UNAVAILABLE',message:'fixture'}})
  value(service.setConfig(config(),1));value(await service.read());rejected(service.setConfig({...config(),revision:1},2),'UNAVAILABLE');assert.equal(service.peek(),null);rejected(await service.read(),'UNAVAILABLE');service.dispose()
})

test('cached timezone resolution is bounded and cannot be mutated by consumers',()=>{
  let count=0;const cached=createTimeZoneCache({project:zones.project,resolve(l,z){count++;return zones.resolve(l,z)}},1)
  const local={date:'2026-10-14',time:{hour:9,minute:0,second:0,millisecond:0}}
  const first=value(cached.resolve(local,'UTC'));if(first.kind==='unique')first.instant=0
  assert.notEqual(value(cached.resolve(local,'UTC')),first);assert.equal(count,1)
  value(cached.resolve({...local,date:'2026-10-15'},'UTC'));value(cached.resolve(local,'UTC'));assert.equal(count,3);cached.clear();value(cached.resolve(local,'UTC'));assert.equal(count,4)
})

test('bridge rejects malformed result envelopes and non-JSON object transfer',async()=>{
  for(const payload of [{hello:'world'},{ok:true},{ok:false,error:{code:'UNKNOWN',message:'bad'}},{ok:false,error:{code:'REVISION_CONFLICT',message:'bad'}},{ok:true,data:new Date(0)}]){
    const bridge=createV2Bridge('main',{invoke:async()=>payload,listen:()=>()=>{}});rejected(await bridge.config.read(),'INTERNAL')
  }
})

test('exit timeout while formal save is pending never authorizes destruction or cancels the write',async()=>{
  let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r)
  const a=await runtimeFixture({files:{...nodeConfigFiles,async writeExclusiveFlush(path,text){entered();await hold;await nodeConfigFiles.writeExclusiveFlush(path,text)}}})
  value(a.runtime.updateDraft({draft:value(editableConfig(config())) as unknown as import('../../src/shared/contracts').JsonObject,expectedRevision:0}))
  const actual=a.runtime.exitAdapter,adapter={...actual,confirm:async()=>success('save' as const)};let quits=0
  const quit=createQuitCoordinator({waitMilliseconds:10,confirmationMilliseconds:100,waitForWrites:a.writes.drain,restoreMain(){},commitQuit:()=>{quits++;return success(null)}});quit.registerDraft(adapter)
  const request=quit.requestQuit();await started;rejected(await request,'IO_BUSY');assert.equal(quits,0);assert.equal(value(a.runtime.readDraft()).save.status,'saving');assert.equal(a.writes.pendingCount(),1)
  release();value(await a.writes.drain());await flush();assert.equal(value(a.runtime.readConfig()).config.revision,1);value(await quit.requestQuit());assert.equal(quits,1);quit.dispose()
})

test('older clock result cannot replace a newer instant even within one config generation',async()=>{
  const ctx=context(),data=dashboard().read();let finish!:(result:Result<import('../../src/domain/dashboard').DashboardData>)=>void,first=true
  const service=createSnapshotService(ctx.clock,()=>success({invalidate(){},calculate(now){if(first){first=false;return new Promise(r=>finish=r)}return success({...data,computedAt:now.instant,localDate:now.date,timeZoneId:now.timeZoneId})}}))
  value(service.setConfig(config(),1));const old=service.read();value(ctx.clock.advanceMilliseconds(2000));const current=value(await service.read());finish(success(data));rejected(await old,'CANCELLED');assert.equal(value(service.peek()!).computedAt,current.computedAt);service.dispose()
})

test('runtime migration refusal preserves a dirty draft and never commits a valid preview',async()=>{
  const a=await runtimeFixture({source:config()}),source=join(a.directory,'poc.json');await writeFile(source,'{"workStartTime":"10:00","workEndTime":"19:00"}')
  a.runtime.dispose();const migration=createMigrationService({...a.ctx,store:a.store,sources:createMigrationFiles({selectImport:async()=>source,selectExport:async()=>null})})
  const runtime=createRuntime({...a.ctx,store:a.store,migration,timers:a.timers,writes:a.writes,maxHistoryDays:100000,confirm:async()=>success('continueEditing')});value(await runtime.start())
  const preview=value(await runtime.previewImport({sourceKind:'electron-poc'}));value(runtime.updateDraft({draft:{employee:{startDate:null}},expectedRevision:0}))
  rejected(await runtime.applyImport({previewToken:preview.previewToken,expectedRevision:0,selectedFields:['schedule.startTime','schedule.endTime'],undatedOvertimeShiftDate:null}),'UNAVAILABLE');assert.equal(value(runtime.readDraft()).dirty,true);assert.equal(value(runtime.readConfig()).config.revision,0);runtime.dispose()
})

test('Preload listener transport failures return Result and still release Main subscription',async()=>{
  const broken=createV2Bridge('main',{invoke:async()=>success(null),listen(){throw Error('fixture secret')}})
  rejected(await broken.snapshot.subscribe(()=>{}),'INTERNAL')
  const calls:string[]=[];const removeBroken=createV2Bridge('main',{invoke:async channel=>{calls.push(channel);return success(null)},listen:()=>()=>{throw Error('fixture secret')}})
  value(await removeBroken.snapshot.subscribe(()=>{}));rejected(await removeBroken.snapshot.unsubscribe(),'INTERNAL');assert.ok(calls.includes(V2_CHANNELS['snapshot.unsubscribe']))
})
