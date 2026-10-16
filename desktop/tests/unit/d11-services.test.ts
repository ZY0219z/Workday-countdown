import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {value,rejected,context,initial} from './config-fixtures'
import {createConfigStore} from '../../src/main/services/config-store'
import {createRuntime} from '../../src/main/services/runtime'
import {createMigrationService} from '../../src/main/services/migration-service'
import {createMigrationFiles} from '../../src/main/services/migration-files'
import {createOperationBarrier} from '../../src/main/lifecycle/operation-barrier'
import {createQuitCoordinator,type ExitChoice} from '../../src/main/lifecycle/quit-coordinator'
import {createIpcRouter,type IpcEvent} from '../../src/main/ipc/router'
import {createV2Bridge} from '../../src/shared/bridge'
import {V2_CHANNELS} from '../../src/shared/ipc'
import type {Result,ContractRequests,AppConfig} from '../../src/shared/contracts'
import {createDefaultAppConfig} from '../../src/shared/config-schema'
import {createCalendar} from '../../src/domain/calendar'
import {calculateNextSalary} from '../../src/domain/salary'
import {validateConfigSettings,validateConfigSettingsAsync,editableConfig} from '../../src/main/services/config-validation'
import {currentOvertimeShift,expectedEndOvertime} from '../../src/domain/expected-end'
import {success} from '../../src/shared/validation'
import {createSettingsController} from '../../src/renderer/src/ui/settings-controller'
import {nodeConfigFiles} from '../../src/main/services/config-files'
const directories:string[]=[]
after(async()=>{for(const directory of directories){assert.ok(directory.startsWith(join(tmpdir(),'workday-d11-')));await rm(directory,{recursive:true,force:true})}})
async function setup(options:{missing?:boolean;failWrite?:boolean}={}){
  const directory=await mkdtemp(join(tmpdir(),'workday-d11-'));directories.push(directory)
  const ctx=context();let failWrite=false,source:string|null=null,choice:ExitChoice='continueEditing',quits=0
  const store=value(createConfigStore({...ctx,directory,appVersion:'2.0.0',files:{...nodeConfigFiles,async writeExclusiveFlush(path,text){if(failWrite)throw Object.assign(Error('fixture'),{code:'EACCES'});return nodeConfigFiles.writeExclusiveFlush(path,text)}}}))
  if(!options.missing)value(await store.initialize(initial))
  const migration=createMigrationService({...ctx,store,sources:createMigrationFiles({selectImport:async()=>source,selectExport:async()=>join(directory,'export.json')})}),writes=createOperationBarrier()
  const runtime=createRuntime({...ctx,store,migration,writes,maxHistoryDays:100000,confirm:async()=>success(choice)})
  value(await runtime.start())
  const quit=createQuitCoordinator({waitForWrites:writes.drain,restoreMain(){},commitQuit(){quits++;return success(null)},waitMilliseconds:3000,confirmationMilliseconds:3000});quit.registerDraft(runtime.exitAdapter)
  const handlers=new Map<string,(event:IpcEvent,input:unknown)=>Promise<unknown>>()
  const router=createIpcRouter({handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>{handlers.delete(key)}},runtime,{window:()=>success(null),quit:quit.requestQuit})
  const sender={},frame={},event={sender,senderFrame:frame};router.register('main',{sender,frame:()=>frame,url:()=>'/fixed',destroyed:()=>false,visible:()=>false,push(){}},'/fixed')
  const api=createV2Bridge('main',{invoke:(key,input)=>handlers.get(key)!(event,input),listen:()=>()=>{}})
  const controller=createSettingsController(api,()=>{});value(await controller.load())
  const close=()=>{controller.dispose();quit.dispose();router.dispose();runtime.dispose()}
  after(close)
  return {ctx,directory,store,runtime,controller,api,handlers,event,choose:(value:ExitChoice)=>{choice=value},quits:()=>quits,source:(path:string|null)=>{source=path},fail:()=>{failWrite=true}}
}
test('real missing first session remains missing until explicit UI save, then real Snapshot exists',async()=>{
  const a=await setup({missing:true});assert.equal(a.controller.state.session!.saved,null);assert.equal(a.controller.state.session!.configurationStatus,'missing')
  await assert.rejects(readFile(join(a.directory,'settings.json')))
  const edit=structuredClone(a.controller.state.editor);edit.schedule.startTime='09:00';edit.schedule.endTime='18:00';edit.salary.day=10;a.controller.edit(edit)
  assert.equal(await a.controller.save(),true);assert.equal(value(await a.api.config.read()).config.revision,1)
  const snapshot=value(await a.api.snapshot.read());assert.equal(snapshot.configRevision,1);assert.equal(snapshot.employment.status,'unset')
})
test('real UI controller, fixed IPC and ConfigStore save; metadata comes from trusted registry',async()=>{
  const a=await setup();const metadata=value(await a.api.calendar.readMetadata());assert.deepEqual(metadata.map(x=>x.year),[2024,2025,2026]);assert.ok(metadata.every(x=>x.verification==='verified'))
  const edit=structuredClone(a.controller.state.editor);edit.calendar.enabledYears=[2024,2025,2026];edit.calendar.overrides['2026-10-14']='rest';a.controller.edit(edit)
  assert.equal(await a.controller.save(),true);const saved=JSON.parse(await readFile(join(a.directory,'settings.json'),'utf8'));assert.equal(saved.calendar.overrides['2026-10-14'],'rest');assert.equal(saved.calendar.datasets.length,3)
  const snapshot=value(await a.api.snapshot.read());assert.equal(snapshot.configRevision,saved.revision);assert.equal(snapshot.state,'rest')
})
test('actual semantic date/shift/overtime errors preserve disk and entered draft',async()=>{
  const a=await setup(),original=await readFile(join(a.directory,'settings.json'),'utf8')
  for(const bad of ['time','overtime','break'] as const){await a.controller.discard();const edit=structuredClone(a.controller.state.editor)
    if(bad==='time')edit.schedule.endTime='08:00';if(bad==='overtime')edit.overtime.entries=[{shiftDate:'2026-10-14',minutes:601}];if(bad==='break')edit.schedule.breaks=[{startTime:'08:00',endTime:'09:00',startDayOffset:0,endDayOffset:0}]
    a.controller.edit(edit);assert.equal(await a.controller.save(),false);assert.equal(a.controller.state.dirty,true);assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),original)
  }
})
test('actual filesystem save failure keeps old authority and draft',async()=>{
  const a=await setup(),original=await readFile(join(a.directory,'settings.json'),'utf8');a.fail();const edit=structuredClone(a.controller.state.editor);edit.schedule.endTime='19:00';a.controller.edit(edit)
  assert.equal(await a.controller.save(),false);assert.equal(a.controller.state.editor.schedule.endTime,'19:00');assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),original)
})
test('actual external revision conflict never silently overwrites or adopts new revision',async()=>{
  const a=await setup();const external=JSON.parse(await readFile(join(a.directory,'settings.json'),'utf8'));external.revision+=1;external.appearance.accent='coral';await writeFile(join(a.directory,'settings.json'),JSON.stringify(external))
  const edit=structuredClone(a.controller.state.editor);edit.schedule.endTime='19:00';a.controller.edit(edit);assert.equal(await a.controller.save(),false)
  assert.equal(a.controller.state.error!.code,'REVISION_CONFLICT');assert.equal(a.controller.state.editor.schedule.endTime,'19:00');assert.equal(JSON.parse(await readFile(join(a.directory,'settings.json'),'utf8')).appearance.accent,'coral')
})
test('real Main draft reloads without editor loss; explicit discard restores saved values',async()=>{
  const a=await setup();const edit=structuredClone(a.controller.state.editor);edit.schedule.endTime='19:00';a.controller.edit(edit);value(await a.controller.flush())
  const second=createSettingsController(a.api,()=>{});value(await second.load());assert.equal(second.state.editor.schedule.endTime,'19:00');assert.equal(await second.discard(),true);assert.equal(second.state.editor.schedule.endTime,'18:00')
})
test('real POC preview is read-only; cancellation revokes token and apply changes only chosen fields',async()=>{
  const a=await setup(),path=join(a.directory,'poc.json'),text='{"workStartTime":"09:00","workEndTime":"19:00"}';await writeFile(path,text);a.source(path)
  const cancelled=value(await a.api.data.previewImport({sourceKind:'electron-poc'}));value(await a.api.data.cancelImport({previewToken:cancelled.previewToken}))
  rejected(await a.api.data.applyImport({previewToken:cancelled.previewToken,expectedRevision:cancelled.expectedRevision,selectedFields:['schedule.endTime'],undatedOvertimeShiftDate:null}),'UNAVAILABLE')
  const preview=value(await a.api.data.previewImport({sourceKind:'electron-poc'}));const result=value(await a.api.data.applyImport({previewToken:preview.previewToken,expectedRevision:preview.expectedRevision,selectedFields:['schedule.endTime'],undatedOvertimeShiftDate:null}))
  assert.equal(result.config.schedule.endTime,'19:00');assert.equal(result.config.employee.startDate,initial.startDate);assert.equal(await readFile(path,'utf8'),text)
})
test('source mutation between real preview and apply is rejected with no revision update',async()=>{
  const a=await setup(),path=join(a.directory,'poc.json');await writeFile(path,'{"workStartTime":"09:00","workEndTime":"19:00"}');a.source(path)
  const preview=value(await a.api.data.previewImport({sourceKind:'electron-poc'}));await writeFile(path,'{"workStartTime":"09:00","workEndTime":"20:00"}')
  rejected(await a.api.data.applyImport({previewToken:preview.previewToken,expectedRevision:preview.expectedRevision,selectedFields:['schedule.endTime'],undatedOvertimeShiftDate:null}),'UNAVAILABLE')
  assert.equal(value(a.runtime.readConfig()).config.schedule.endTime,'18:00')
})
test('real export includes ended overtime and excludes paths; existing export target is not overwritten',async()=>{
  const a=await setup();const edit=structuredClone(a.controller.state.editor);edit.overtime.entries=[{shiftDate:'2026-10-01',minutes:0}];a.controller.edit(edit);assert.equal(await a.controller.save(),true)
  value(await a.api.data.export({kind:'v2-config'}));const exported=await readFile(join(a.directory,'export.json'),'utf8');assert.equal(JSON.parse(exported).overtime.entries.length,1);assert.ok(!exported.includes(a.directory))
  rejected(await a.api.data.export({kind:'v2-config'}),'IO_BUSY');assert.equal(await readFile(join(a.directory,'export.json'),'utf8'),exported)
})
test('real fixed backup preview/apply restores only after explicit selection and keeps corrupt source copy',async()=>{
  const a=await setup();const edit=structuredClone(a.controller.state.editor);edit.schedule.endTime='19:00';a.controller.edit(edit);assert.equal(await a.controller.save(),true)
  await writeFile(join(a.directory,'settings.json'),'{broken');const preview=value(await a.api.data.previewRecovery());assert.equal(preview.sourceKind,'v2')
  assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),'{broken')
  value(await a.api.data.applyImport({previewToken:preview.previewToken,expectedRevision:preview.expectedRevision,selectedFields:preview.choices.filter(x=>!x.issues.length).map(x=>x.field),undatedOvertimeShiftDate:null}))
  assert.equal(JSON.parse(await readFile(join(a.directory,'settings.json'),'utf8')).schedule.endTime,'18:00')
})
for(const choice of ['continueEditing','discard','save'] as const)test(`actual D08 formal exit ${choice} does not depend on POC DOM`,async()=>{
  const a=await setup();const edit=structuredClone(a.controller.state.editor);edit.schedule.endTime='19:00';a.controller.edit(edit);value(await a.controller.flush());a.choose(choice)
  const result=await a.api.app.quit();if(choice==='continueEditing'){rejected(result,'CANCELLED');assert.equal(a.quits(),0);assert.equal(value(a.runtime.readDraft()).dirty,true)}else{value(result);assert.equal(a.quits(),1);assert.equal(value(a.runtime.readDraft()).dirty,false);assert.equal(JSON.parse(await readFile(join(a.directory,'settings.json'),'utf8')).schedule.endTime,choice==='save'?'19:00':'18:00')}
})
test('exit save failure cancels exit and retains draft; annual imports remain honestly unavailable',async()=>{
  const a=await setup();a.fail();const edit=structuredClone(a.controller.state.editor);edit.schedule.endTime='19:00';a.controller.edit(edit);value(await a.controller.flush());a.choose('save');rejected(await a.api.app.quit(),'IO_DENIED');assert.equal(a.quits(),0)
  rejected(await a.api.calendar.previewImport(),'UNAVAILABLE');rejected(await a.api.calendar.applyImport({previewToken:'not-real',expectedCalendarRevision:0}),'UNAVAILABLE')
})

async function defaultSession(options:{primary?:string;backup?:string;failWrite?:boolean}={}){
  const directory=await mkdtemp(join(tmpdir(),'workday-d11-defaults-'));directories.push(directory)
  if(options.primary!==undefined)await writeFile(join(directory,'settings.json'),options.primary)
  if(options.backup!==undefined)await writeFile(join(directory,'settings.backup.json'),options.backup)
  const ctx=context(),writes=createOperationBarrier()
  const store=value(createConfigStore({...ctx,directory,appVersion:'2.0.0',files:options.failWrite?{...nodeConfigFiles,async writeExclusiveFlush(){throw Object.assign(Error('fixture denied'),{code:'EACCES'})}}:undefined}))
  const runtime=createRuntime({...ctx,store,writes,initializeDefaults:{appVersion:'2.0.0'},confirm:async()=>success('continueEditing'),maxHistoryDays:100000})
  value(await runtime.start());after(()=>runtime.dispose())
  return {runtime,store,ctx,directory,async settled(){const end=performance.now()+5000;while(value(runtime.readDraft()).defaultPersistence?.status==='pending'){assert.ok(performance.now()<end,'bounded default save');await new Promise<void>(resolve=>setImmediate(resolve))}return value(runtime.readDraft())}}
}
test('approved defaults show a Snapshot before disk save, then persist once and survive restart',async()=>{
  const a=await defaultSession(),initial=value(a.runtime.readDraft())
  assert.equal(initial.saved,null);assert.equal(initial.defaultPersistence?.status,'pending')
  const snapshot=value(await a.runtime.snapshots.read());assert.ok(snapshot.countdown);assert.equal(snapshot.configRevision,0)
  assert.equal(initial.draft.employee&&typeof initial.draft.employee==='object'&&(initial.draft.employee as {startDate:string}).startDate,'2025-07-17')
  const settled=await a.settled();assert.equal(settled.saved!.revision,1);assert.equal(settled.defaultPersistence,undefined)
  const text=await readFile(join(a.directory,'settings.json'),'utf8'),config=JSON.parse(text) as AppConfig
  assert.deepEqual(config.schedule,{startTime:'08:30',endTime:'18:00',crossMidnight:false,workWeek:[1,2,3,4,5],breaks:[]});assert.equal(config.salary.day,10);assert.equal(config.salary.nonWorkingPolicy,'delay');assert.deepEqual(config.overtime.entries,[]);assert.deepEqual(config.calendar.enabledYears,[2024,2025,2026])
  a.runtime.dispose();const restarted=value(createConfigStore({...a.ctx,directory:a.directory,appVersion:'2.0.0'}));assert.equal(value(await restarted.load()).status,'ready');assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),text)
})
test('failed automatic default save retains usable Snapshot and never calls defaults persisted',async()=>{
  const a=await defaultSession({failWrite:true}),draft=await a.settled();assert.equal(draft.saved,null);assert.equal(draft.defaultPersistence?.status,'failed');assert.equal(draft.dirty,false);assert.ok(value(await a.runtime.snapshots.read()).countdown);await assert.rejects(readFile(join(a.directory,'settings.json')))
  const edited={...draft.draft,salary:{day:15,nonWorkingPolicy:'delay',missingDayPolicy:'monthEnd',showPaydayAsToday:true}};value(a.runtime.updateDraft({draft:edited,expectedRevision:0}));value(a.runtime.discardDraft());assert.equal((value(a.runtime.readDraft()).draft.salary as {day:number}).day,10)
})
for(const scenario of ['existing','backup','broken','future','brokenBackup'] as const)test(`automatic defaults never replace ${scenario} data`,async()=>{
  const config=value(createDefaultAppConfig({updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'},context().calendars.listMetadata()));config.schedule.startTime='10:00';config.revision=7
  const text=JSON.stringify(config),options=scenario==='existing'?{primary:text}:scenario==='backup'?{primary:'broken',backup:text}:scenario==='broken'?{primary:'broken'}:scenario==='future'?{primary:'{"schemaVersion":99}'}:{backup:'broken backup'}
  const a=await defaultSession(options),draft=value(a.runtime.readDraft());assert.equal(draft.defaultPersistence,undefined)
  assert.equal(draft.configurationStatus,scenario==='existing'?'ready':scenario==='backup'?'recoverable':scenario==='future'?'future':'invalid')
  if(options.primary!==undefined)assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),options.primary)
  else await assert.rejects(readFile(join(a.directory,'settings.json')))
  if(options.backup!==undefined)assert.equal(await readFile(join(a.directory,'settings.backup.json'),'utf8'),options.backup)
})
test('cooperative and synchronous checks cover the same full horizon and reject the same invalid schedule',async()=>{
  const ctx=context(),config=value(createDefaultAppConfig({updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'},ctx.calendars.listMetadata())),settings=value(editableConfig(config))
  const synchronous=validateConfigSettings(settings,null,ctx),cooperative=await validateConfigSettingsAsync(settings,null,ctx)
  assert.deepEqual(cooperative,synchronous);assert.ok(value(cooperative).checkedShiftDates.length>=367)
  settings.schedule.endTime='08:00';assert.deepEqual(await validateConfigSettingsAsync(settings,config,ctx),validateConfigSettings(settings,config,ctx));rejected(await validateConfigSettingsAsync(settings,config,ctx))
})
test('default payroll delays a rest-day tenth but respects an official Saturday makeup day',()=>{
  const ctx=context(),config=value(createDefaultAppConfig({updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'},ctx.calendars.listMetadata()))
  const calendar=value(createCalendar({workWeek:config.schedule.workWeek,overrides:{}},[2024,2025,2026].map(year=>value(ctx.calendars.readYear(year))!)))
  const rest=value(calculateNextSalary(calendar,'2026-05-09',10,'delay')),makeup=value(calculateNextSalary(calendar,'2026-10-10',10,'delay'))
  assert.equal(rest.status,'found');if(rest.status==='found')assert.equal(rest.actualDate,'2026-05-11')
  assert.equal(makeup.status,'found');if(makeup.status==='found'){assert.equal(makeup.actualDate,'2026-10-10');assert.equal(makeup.days,0)}
})

function targetFixture(at='2026-10-14T10:00:00Z',zone='UTC',change:(settings:import('../../src/shared/contracts').EditableConfig)=>void=()=>{}){
  const ctx=context();value(ctx.clock.setTimeZone(zone));value(ctx.clock.setInstant(Date.parse(at)))
  const config=value(createDefaultAppConfig({updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'},ctx.calendars.listMetadata())),settings=value(editableConfig(config));change(settings)
  const calendar=value(createCalendar({workWeek:settings.schedule.workWeek,overrides:settings.calendar.overrides},[2024,2025,2026].map(year=>value(ctx.calendars.readYear(year))!)))
  const scheduleContext={calendar,zones:ctx.zones,timeZoneId:zone},now=value(ctx.clock.read()),shift=currentOvertimeShift(settings,now,scheduleContext)
  return {ctx,settings,scheduleContext,shift}
}
for(const [input,minutes]of [['18:00',0],['19:00',60],['20:00',120],['00:30',390]] as const)test(`expected end ${input} maps to ${minutes} exact elapsed minutes`,()=>{
  const a=targetFixture(),shift=value(a.shift),result=value(expectedEndOvertime(a.settings,shift,input,a.scheduleContext))
  assert.deepEqual(result.entries,[{shiftDate:'2026-10-14',minutes}]);assert.deepEqual(a.settings.overtime.entries,[])
})
for(const input of ['04:01','24:00','08:60','19:',''])test(`invalid expected end ${JSON.stringify(input)} never changes overtime`,()=>{
  const a=targetFixture();rejected(expectedEndOvertime(a.settings,value(a.shift),input,a.scheduleContext));assert.deepEqual(a.settings.overtime.entries,[])
})
for(const [at,date]of [['2026-10-14T07:00:00Z','2026-10-14'],['2026-10-14T20:30:00Z','2026-10-14']] as const)test(`target is identifiable before work or after normal finish at ${at}`,()=>{
  const a=targetFixture(at);assert.equal(value(a.shift).shiftDate,date);assert.equal(value(expectedEndOvertime(a.settings,value(a.shift),'21:00',a.scheduleContext)).entries[0].minutes,180)
})
test('overnight active shift is assigned to its original start date',()=>{
  const a=targetFixture('2026-10-15T01:00:00Z','UTC',s=>{s.schedule.startTime='22:00';s.schedule.endTime='06:00';s.schedule.crossMidnight=true})
  assert.equal(value(a.shift).shiftDate,'2026-10-14');assert.deepEqual(value(expectedEndOvertime(a.settings,value(a.shift),'07:00',a.scheduleContext)).entries,[{shiftDate:'2026-10-14',minutes:60}])
})
test('rest day without active regular shift never creates overtime',()=>{rejected(targetFixture('2026-10-17T12:00:00Z').shift,'UNAVAILABLE')})
for(const [at,input]of [['2026-11-01T04:10:00Z','01:30'],['2026-03-08T06:10:00Z','02:30']] as const)test(`expected end refuses DST ambiguity or gap at ${at}`,()=>{
  const a=targetFixture(at,'America/New_York',s=>{s.schedule.startTime='00:00';s.schedule.endTime=at.includes('11-01')?'00:30':'01:30';s.schedule.workWeek=[7]})
  const result=expectedEndOvertime(a.settings,value(a.shift),input,a.scheduleContext);rejected(result);if(!result.ok)assert.match(result.error.message+' '+JSON.stringify(result.error),/DST/)
})
test('expected end still rejects overlap with the next regular shift',()=>{
  const a=targetFixture('2026-10-14T10:00:00Z','UTC',s=>{s.schedule.startTime='00:30'})
  rejected(expectedEndOvertime(a.settings,value(a.shift),'01:00',a.scheduleContext))
})
test('cancel current overtime preserves all other dated history and future records',()=>{
  const a=targetFixture('2026-10-14T10:00:00Z','UTC',s=>{s.overtime.entries=[{shiftDate:'2026-10-01',minutes:80},{shiftDate:'2026-10-14',minutes:120},{shiftDate:'2026-10-15',minutes:60}]})
  assert.deepEqual(value(expectedEndOvertime(a.settings,value(a.shift),null,a.scheduleContext)).entries,[{shiftDate:'2026-10-01',minutes:80},{shiftDate:'2026-10-15',minutes:60}]);assert.equal(a.settings.overtime.entries.length,3)
})

test('real Main scratch preserves partial input across reload; invalid save/exit never writes it',async()=>{
  const a=await setup(),before=await readFile(join(a.directory,'settings.json'),'utf8');a.controller.editExpectedEnd('19:');value(await a.controller.flush())
  const draft=value(a.runtime.readDraft());assert.equal(draft.expectedEndEdit!.input,'19:');assert.equal(draft.dirty,true);assert.deepEqual(draft.draft.overtime,{entries:[]})
  const reloaded=createSettingsController(a.api,()=>{});value(await reloaded.load());assert.equal(reloaded.state.expectedEndInput,'19:');reloaded.dispose()
  assert.equal(await a.controller.save(),false);a.choose('save');rejected(await a.api.app.quit());assert.equal(a.quits(),0);assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),before)
  a.choose('continueEditing');rejected(await a.api.app.quit(),'CANCELLED');assert.equal(value(a.runtime.readDraft()).expectedEndEdit!.input,'19:')
  assert.equal(await a.controller.discard(),true);assert.equal(a.controller.state.expectedEndInput,'18:00');assert.equal(a.controller.state.dirty,false)
})
test('real expected-end save updates Snapshot and progress, does not inherit next day',async()=>{
  const a=await setup();value(a.ctx.clock.setInstant(Date.parse('2026-10-14T18:30:00Z')));value(await a.controller.load());a.controller.editExpectedEnd('20:00');value(await a.controller.flush());assert.equal(await a.controller.save(),true)
  const config=value(a.runtime.readConfig()).config;assert.deepEqual(config.overtime.entries,[{shiftDate:'2026-10-14',minutes:120}]);const snapshot=value(await a.runtime.snapshots.read());assert.equal(snapshot.state,'overtime');assert.equal(snapshot.countdown!.seconds,5400);assert.ok(snapshot.progress!.percent<100)
  value(a.ctx.clock.setInstant(Date.parse('2026-10-15T10:00:00Z')));a.runtime.refresh.wake(true);assert.equal(value(await a.runtime.snapshots.read()).activeShift!.overtimeMinutes,0)
})
test('history breaks survive unrelated save; cancel clears only current shift and failed write retains inputs',async()=>{
  const a=await setup(),edit=structuredClone(a.controller.state.editor);edit.schedule.breaks=[{startTime:'12:00',endTime:'13:00',startDayOffset:0,endDayOffset:0}];edit.overtime.entries=[{shiftDate:'2026-10-01',minutes:80},{shiftDate:'2026-10-14',minutes:120}];a.controller.edit(edit);assert.equal(await a.controller.save(),true);assert.equal(a.controller.state.expectedEndInput,'20:00')
  const next=structuredClone(a.controller.state.editor);next.appearance.accent='coral';a.controller.edit(next);assert.equal(await a.controller.save(),true);assert.deepEqual(value(a.runtime.readConfig()).config.schedule.breaks,edit.schedule.breaks)
  a.controller.editExpectedEnd(null);assert.equal(await a.controller.save(),true);assert.deepEqual(value(a.runtime.readConfig()).config.overtime.entries,[{shiftDate:'2026-10-01',minutes:80}]);assert.equal(a.controller.state.expectedEndInput,'18:00')
  const before=await readFile(join(a.directory,'settings.json'),'utf8');a.fail();a.controller.editExpectedEnd('19:00');assert.equal(await a.controller.save(),false);assert.equal(a.controller.state.expectedEndInput,'19:00');assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),before);assert.equal(await a.controller.discard(),true);assert.equal(a.controller.state.expectedEndInput,'18:00')
})
for(const change of ['date','zone'] as const)test(`stale expected-end target after ${change} change cannot target a new shift`,async()=>{
  const a=await setup(),before=await readFile(join(a.directory,'settings.json'),'utf8');a.controller.editExpectedEnd('20:00');value(await a.controller.flush())
  if(change==='date')value(a.ctx.clock.setInstant(Date.parse('2026-10-15T10:00:00Z')));else value(a.ctx.clock.setTimeZone('Asia/Shanghai'))
  assert.equal(value(a.runtime.readDraft()).expectedEnd?.available,false);assert.equal(await a.controller.save(),false);assert.equal(a.controller.state.expectedEndInput,'20:00');assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),before)
})
test('new fixed IPC cannot set a foreign target or revision; native discard handles raw expected time',async()=>{
  const a=await setup(),context=a.controller.state.expectedEnd;assert.ok(context?.available)
  rejected(await a.api.settingsDraft.setExpectedEnd({targetKey:'foreign',expectedRevision:1,input:'19:00'}),'UNAVAILABLE')
  rejected(await a.api.settingsDraft.setExpectedEnd({targetKey:context.targetKey,expectedRevision:2,input:'19:00'}),'REVISION_CONFLICT')
  a.controller.editExpectedEnd('24:00');value(await a.controller.flush());a.choose('discard');value(await a.api.app.quit());assert.equal(a.quits(),1);assert.equal(value(a.runtime.readDraft()).expectedEndEdit,undefined)
})

test('Main provides a next-date preview without writing it or forgetting equal repeated input',async()=>{
  const a=await setup(),before=await readFile(join(a.directory,'settings.json'),'utf8');a.controller.editExpectedEnd('00:30');value(await a.controller.flush());let draft=value(a.runtime.readDraft());assert.ok(draft.expectedEnd?.available);assert.deepEqual(draft.expectedEnd.previewEnd,{date:'2026-10-15',time:'00:30'});assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),before)
  a.controller.editExpectedEnd('00:30');value(await a.controller.flush());draft=value(a.runtime.readDraft());assert.equal(draft.expectedEndEdit!.input,'00:30');assert.equal(await a.controller.save(),true);assert.deepEqual(value(a.runtime.readConfig()).config.overtime.entries,[{shiftDate:'2026-10-14',minutes:390}])
})

test('failed expected-time synchronization survives an unrelated edit and retry, then explicit discard clears it',async()=>{
  const a=await setup(),before=await readFile(join(a.directory,'settings.json'),'utf8');a.controller.editExpectedEnd('x'.repeat(33));rejected(await a.controller.flush());const edit=structuredClone(a.controller.state.editor);edit.appearance.accent='coral';a.controller.edit(edit);rejected(await a.controller.flush());assert.equal(a.controller.state.expectedEndInput,'x'.repeat(33));assert.equal(await a.controller.save(),false);a.controller.retry();rejected(await a.controller.flush());assert.equal(a.controller.state.expectedEndInput,'x'.repeat(33));assert.equal(await readFile(join(a.directory,'settings.json'),'utf8'),before);assert.equal(await a.controller.discard(),true);assert.equal(a.controller.state.expectedEndInput,'18:00')
})
