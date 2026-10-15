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
import type {Result,ContractRequests} from '../../src/shared/contracts'
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
  return {directory,store,runtime,controller,api,handlers,event,choose:(value:ExitChoice)=>{choice=value},quits:()=>quits,source:(path:string|null)=>{source=path},fail:()=>{failWrite=true}}
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
