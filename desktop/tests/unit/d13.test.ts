import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createTrayController,trayStatus,type TrayPort,type TrayItem} from '../../src/main/tray/tray-controller'
import {createWindowManager} from '../../src/main/windows/window-manager'
import {acquireSingleInstance} from '../../src/main/single-instance'
import {createAppConfig} from '../../src/shared/config-schema'
import {success} from '../../src/shared/validation'
import {createConfigStore} from '../../src/main/services/config-store'
import {createRuntime} from '../../src/main/services/runtime'
import {createOperationBarrier} from '../../src/main/lifecycle/operation-barrier'
import {createQuitCoordinator,type ExitChoice} from '../../src/main/lifecycle/quit-coordinator'
import {createV2Bridge} from '../../src/shared/bridge'
import {createIpcRouter,type IpcEvent} from '../../src/main/ipc/router'
import {OPEN_SETTINGS_PUSH} from '../../src/shared/ipc'
import {editableConfig} from '../../src/main/services/config-validation'
import {nodeConfigFiles} from '../../src/main/services/config-files'
import {value,rejected,context,initial} from './config-fixtures'
import type {DashboardSnapshot,Result} from '../../src/shared/contracts'

class Window extends EventEmitter {
  visible=true;minimized=false;destroyed=false;shows=0
  isDestroyed(){return this.destroyed}isVisible(){return this.visible}isMinimized(){return this.minimized}
  show(){this.visible=true;this.shows++;this.emit('show')}hide(){this.visible=false;this.emit('hide')}focus(){}setAlwaysOnTop(){}
  restore(){this.minimized=false;this.visible=true;this.emit('restore')}minimize(){this.minimized=true;this.emit('minimize')}
}
class Icon extends EventEmitter implements TrayPort {
  destroyed=false;items:TrayItem[]=[];menus=0
  isDestroyed(){return this.destroyed}setToolTip(){}popUpMenu(items:TrayItem[]){this.items=items;this.menus++}destroy(){this.destroyed=true}
}
const unavailable:Result<never>={ok:false,error:{code:'UNAVAILABLE',message:'fixture unavailable'}}
const snap=(state='working',seconds=12360)=>success({state,countdown:{seconds,target:'finalWorkEnd',quality:{approximate:false}}} as DashboardSnapshot)
function setup(overrides:Partial<Parameters<typeof createTrayController>[0]>={}){
  const window=new Window(),windows=createWindowManager(()=>window),icons:Icon[]=[],feedback:string[]=[]
  value(windows.ensureMain())
  let config=value(createAppConfig({...initial,updatedAt:'2026-10-16T00:00:00.000Z',appVersion:'2.0.0'})),notice=true,notices=0,acks=0,quits=0,settings=0,fail=false,exiting=false
  const controller=createTrayController({windows,create(){if(fail)throw Error('fixture');const icon=new Icon();icons.push(icon);return icon},config:()=>success(config),snapshot:async()=>snap(),quit:async()=>{quits++;return success(null)},openSettings:()=>{settings++;return success(null)},
    confirmFirstHide:async()=>{notices++;return success(notice)},acknowledgeNotice(){acks++},feedback:message=>feedback.push(message),exiting:()=>exiting,...overrides})
  return{controller,window,windows,icons,feedback,get config(){return config},set config(c){config=c},set notice(n:boolean){notice=n},set fail(n:boolean){fail=n},set exiting(n:boolean){exiting=n},counts:()=>({notices,acks,quits,settings})}
}
test('default native close hides with a recovery port, not exit or destruction',async()=>{const h=setup();value(await h.controller.closeMain());assert.equal(h.window.visible,false);assert.equal(h.window.destroyed,false);assert.equal(h.windows.state(),'trayOnly');assert.deepEqual(h.counts(),{notices:1,acks:1,quits:0,settings:0});h.controller.dispose()})
test('saved quit preference requests the existing quit operation without creating a tray',async()=>{const h=setup();h.config.desktop.closeAction='quit';value(await h.controller.closeMain());assert.equal(h.counts().quits,1);assert.equal(h.icons.length,0)})
test('a draft preference never changes saved close behavior',async()=>{const h=setup();const draft=structuredClone(h.config);draft.desktop.closeAction='quit';value(await h.controller.closeMain());assert.equal(h.counts().quits,0);assert.equal(draft.desktop.closeAction,'quit');h.controller.dispose()})
test('first notice is triggered by close only, once per acknowledged session',async()=>{const h=setup();value(h.controller.ensure());assert.equal(h.counts().notices,0);value(await h.controller.closeMain());value(h.controller.restoreMain());value(await h.controller.closeMain());assert.equal(h.counts().notices,1);h.controller.dispose()})
test('persisted notice flag skips the first-hide dialog',async()=>{const h=setup();h.config.desktop.tray.firstHideNoticeAcknowledged=true;value(await h.controller.closeMain());assert.equal(h.counts().notices,0);h.controller.dispose()})
test('cancelled notice leaves the original window and no acknowledgement',async()=>{const h=setup();h.notice=false;rejected(await h.controller.closeMain(),'CANCELLED');assert.equal(h.window.visible,true);assert.equal(h.counts().acks,0);h.controller.dispose()})
test('concurrent closes share one confirmation and one hide',async()=>{const h=setup();await Promise.all([h.controller.closeMain(),h.controller.closeMain(),h.controller.closeMain()]);assert.equal(h.counts().notices,1);assert.equal(h.icons.length,1);h.controller.dispose()})
test('minimize remains taskbar state and never calls close or hide',()=>{const h=setup();value(h.controller.ensure());h.window.minimize();assert.equal(h.windows.state(),'mainMinimized');assert.equal(h.window.visible,true);assert.equal(h.counts().notices,0);h.controller.dispose()})
test('tray click restores the same minimized or hidden window',async()=>{const h=setup();value(await h.controller.closeMain());h.window.minimize();h.icons[0].emit('click');assert.equal(h.window.minimized,false);assert.equal(h.window.visible,true);assert.equal(value(h.windows.ensureMain()),h.window);h.controller.dispose()})
test('100 hide/restore and menu operations keep one window, icon and listener pair',async()=>{const h=setup();for(let i=0;i<100;i++){value(await h.controller.closeMain());h.icons[0].emit('click');value(await h.controller.openMenu())}assert.equal(h.icons.length,1);assert.equal(h.icons[0].listenerCount('click'),1);assert.equal(h.icons[0].listenerCount('right-click'),1);assert.equal(value(h.windows.ensureMain()),h.window);h.controller.dispose();assert.equal(h.icons[0].listenerCount('click'),0)})
test('menu has only status/main/settings/quit and invokes the existing operations',async()=>{const h=setup();value(h.controller.ensure());value(await h.controller.openMenu());assert.deepEqual(h.icons[0].items.map(i=>i.label??i.type),['工作中 · 距下班约 3 小时 26 分','打开主窗口','打开设置','separator','退出程序']);assert.equal(h.icons[0].items[0].enabled,false);h.icons[0].items[2].click!();assert.equal(h.counts().settings,1);h.icons[0].items[4].click!();await Promise.resolve();assert.equal(h.counts().quits,1);h.controller.dispose()})
test('menu and native callbacks are invalid after disposal',async()=>{const h=setup();value(h.controller.ensure());value(await h.controller.openMenu());const stale=h.icons[0].items[2].click!,click=h.icons[0].listeners('click')[0] as ()=>void;h.controller.dispose();stale();click();assert.equal(h.counts().settings,0);assert.equal(h.controller.available(),false)})
test('old callbacks cannot restore through a newly created tray generation',async()=>{const h=setup();value(h.controller.ensure());const stale=h.icons[0].listeners('click')[0] as ()=>void;h.icons[0].destroyed=true;value(h.controller.ensure());value(await h.controller.closeMain());stale();assert.equal(h.window.visible,false);h.icons[1].emit('click');assert.equal(h.window.visible,true);h.controller.dispose()})
test('creation failure never hides the active window',async()=>{const h=setup();h.fail=true;rejected(await h.controller.closeMain(),'UNAVAILABLE');assert.equal(h.window.visible,true);assert.equal(h.controller.available(),false);assert.equal(h.feedback.length,1)})
test('lost recovery while hidden restores the main window before failed recreation',async()=>{const h=setup();value(await h.controller.closeMain());h.icons[0].destroyed=true;h.fail=true;rejected(h.controller.ensure(),'UNAVAILABLE');assert.equal(h.window.visible,true)})
test('no recovery registration means no hidden process',async()=>{const h=setup();h.windows.dispose();rejected(await h.controller.closeMain(),'UNAVAILABLE');assert.equal(h.window.visible,true);assert.equal(h.icons[0].isDestroyed(),true)})
test('recover and stale callbacks are ignored while quitting',async()=>{const h=setup();value(await h.controller.closeMain());h.exiting=true;h.icons[0].emit('click');rejected(h.controller.restoreMain(),'UNAVAILABLE');assert.equal(h.window.visible,false);h.windows.beginQuit();h.controller.dispose()})
test('unreadable saved configuration never hides or acknowledges',async()=>{const h=setup({config:()=>unavailable});rejected(await h.controller.closeMain(),'UNAVAILABLE');assert.equal(h.window.visible,true);assert.equal(h.counts().acks,0);h.controller.dispose()})
test('an empty or destroyed native icon cannot authorize hiding',async()=>{const icon=new Icon();icon.destroyed=true;const h=setup({create:()=>icon});rejected(await h.controller.closeMain(),'UNAVAILABLE');assert.equal(h.window.visible,true);h.controller.dispose()})
test('menu failure revokes recovery and restores the hidden main',async()=>{const h=setup();value(await h.controller.closeMain());h.icons[0].popUpMenu=()=>{throw Error('native menu failure')};rejected(await h.controller.openMenu(),'UNAVAILABLE');assert.equal(h.window.visible,true);assert.equal(h.controller.available(),false);h.controller.dispose()})
test('each menu reads a fresh Snapshot, with no extra polling',async()=>{let reads=0;const h=setup({snapshot:async()=>{reads++;return snap('working',reads*60)}});value(h.controller.ensure());assert.equal(reads,0);value(await h.controller.openMenu());assert.ok(h.icons[0].items[0].label?.includes('1 分'));value(await h.controller.openMenu());assert.ok(h.icons[0].items[0].label?.includes('2 分'));assert.equal(reads,2);h.controller.dispose()})
test('disposed async menu cannot publish or invoke stale native commands',async()=>{let finish!:(snapshot:Result<DashboardSnapshot>)=>void;const h=setup({snapshot:()=>new Promise(resolve=>{finish=resolve})});value(h.controller.ensure());const opening=h.controller.openMenu();h.controller.dispose();finish(snap());rejected(await opening,'UNAVAILABLE');assert.equal(h.icons[0].menus,0)})
test('concurrent tray exit calls do not duplicate confirmation or writes',async()=>{let finish!:(result:Result<null>)=>void,calls=0;const h=setup({quit:()=>{calls++;return new Promise(resolve=>{finish=resolve})}});const first=h.controller.requestExit();rejected(await h.controller.requestExit(),'UNAVAILABLE');assert.equal(calls,1);finish(success(null));value(await first);h.controller.dispose()})

test('tray menu reports a resolved business failure once and preserves its Result',async()=>{
  const failure:Result<null>={ok:false,error:{code:'IO_BUSY',message:'设置正在同步或保存，请稍后再退出。'}}
  const h=setup({quit:async()=>failure})
  try{
    value(h.controller.ensure());value(await h.controller.openMenu())
    const result=await h.icons[0].items.find(item=>item.label==='退出程序')!.click!()
    assert.equal(result,failure);assert.equal(h.window.destroyed,false)
    assert.deepEqual(h.feedback,['退出程序失败：'+failure.error.message])
  }finally{h.controller.dispose()}
})

for(const scenario of ['clean','continueEditing','save','discard','saveFailure','syncFailure'] as const)test(`tray menu through the real quit coordinator: ${scenario}`,async()=>{
  let coordinator!:ReturnType<typeof createQuitCoordinator>
  const h=setup({quit:()=>coordinator.requestQuit(),exiting:()=>coordinator.isAuthorized()})
  const state={dirty:!['clean','syncFailure'].includes(scenario),saving:false,identity:'tray-draft'}
  const calls={commit:0,confirm:0,save:0,discard:0}
  coordinator=createQuitCoordinator({waitMilliseconds:500,confirmationMilliseconds:500,
    waitForWrites:async()=>scenario==='syncFailure'?{ok:false,error:{code:'IO_BUSY',message:'设置同步尚未完成。'}}:success(null),
    restoreMain(){value(h.windows.showMain())},commitQuit(){calls.commit++;h.windows.beginQuit();h.controller.dispose();return success(null)}})
  coordinator.registerDraft({read:async()=>success({...state}),confirm:async()=>{calls.confirm++;return success(scenario==='discard'?'discard':scenario==='continueEditing'?'continueEditing':'save')},
    async save(){calls.save++;if(scenario==='saveFailure')return {ok:false,error:{code:'IO_DENIED',message:'设置保存失败。'}};state.dirty=false;return success(null)},
    async discard(){calls.discard++;state.dirty=false;return success(null)}})
  try{
    value(await h.controller.closeMain());value(await h.controller.openMenu());assert.equal(h.window.visible,false)
    const result=await h.icons[0].items.find(item=>item.label==='退出程序')!.click!() as Result<null>
    const failed=['continueEditing','saveFailure','syncFailure'].includes(scenario)
    assert.equal(result.ok,!failed);assert.equal(coordinator.isAuthorized(),!failed);assert.equal(calls.commit,failed?0:1)
    assert.equal(calls.confirm,scenario==='clean'||scenario==='syncFailure'?0:1)
    if(failed){
      rejected(result,scenario==='continueEditing'?'CANCELLED':scenario==='saveFailure'?'IO_DENIED':'IO_BUSY')
      assert.equal(h.window.visible,true);assert.equal(h.window.destroyed,false)
      assert.equal(state.dirty,scenario!=='syncFailure')
      assert.equal(h.feedback.length,scenario==='continueEditing'?0:1)
    }else{assert.equal(state.dirty,false);assert.equal(h.feedback.length,0)}
    assert.equal(calls.save,scenario==='save'||scenario==='saveFailure'?1:0)
    assert.equal(calls.discard,scenario==='discard'?1:0)
  }finally{h.controller.dispose();coordinator.dispose()}
})

test('old exit menu callbacks cannot quit after disposal, destruction, replacement or external quit',async()=>{
  for(const invalidation of ['dispose','destroy','replace','quitting']){
    const h=setup()
    try{
      value(h.controller.ensure());value(await h.controller.openMenu())
      const stale=h.icons[0].items.find(item=>item.label==='退出程序')!.click!
      if(invalidation==='dispose')h.controller.dispose()
      else if(invalidation==='quitting')h.exiting=true
      else{h.icons[0].destroyed=true;if(invalidation==='replace')value(h.controller.ensure())}
      assert.equal(stale(),undefined);assert.equal(h.counts().quits,0);assert.equal(h.feedback.length,0)
    }finally{h.controller.dispose()}
  }
})

test('repeated exit menu clicks while a request is pending invoke quit only once',async()=>{
  let finish!:(result:Result<null>)=>void,calls=0
  const h=setup({quit:()=>{calls++;return new Promise(resolve=>{finish=resolve})}})
  try{
    value(h.controller.ensure());value(await h.controller.openMenu())
    const click=h.icons[0].items.find(item=>item.label==='退出程序')!.click!,first=click() as Promise<Result<null>>
    assert.equal(click(),undefined);assert.equal(calls,1);assert.equal(h.feedback.length,0)
    finish(success(null));value(await first);assert.equal(calls,1);assert.equal(h.feedback.length,0)
  }finally{h.controller.dispose()}
})

test('quit menu exceptions produce safe feedback without exposing exception details',async()=>{
  const h=setup({quit:async()=>{throw Error('private fixture path')}})
  try{
    value(h.controller.ensure());value(await h.controller.openMenu())
    const result=await h.icons[0].items.find(item=>item.label==='退出程序')!.click!() as Result<null>
    rejected(result,'UNAVAILABLE');assert.deepEqual(h.feedback,['退出调用失败，窗口与草稿保留。'])
    assert.equal(h.window.destroyed,false)
  }finally{h.controller.dispose()}
})

test('a failed quit completing after tray disposal does not publish stale feedback',async()=>{
  let finish!:(result:Result<null>)=>void
  const h=setup({quit:()=>new Promise(resolve=>{finish=resolve})})
  value(h.controller.ensure());value(await h.controller.openMenu())
  const pending=h.icons[0].items.find(item=>item.label==='退出程序')!.click!() as Promise<Result<null>>
  h.controller.dispose();finish(unavailable);rejected(await pending,'UNAVAILABLE');assert.equal(h.feedback.length,0)
})
test('second-instance restoration reuses the main that was hidden by the tray',async()=>{const h=setup(),events=new EventEmitter();const instance=value(acquireSingleInstance({on:events.on.bind(events),off:events.off.bind(events),requestSingleInstanceLock:()=>true,releaseSingleInstanceLock(){},quit(){}},()=>{h.windows.showMain()}));instance.markReady();value(await h.controller.closeMain());events.emit('second-instance',{},['--untrusted']);assert.equal(h.window.visible,true);assert.equal(value(h.windows.ensureMain()),h.window);instance.dispose();h.controller.dispose()})
for(const state of ['rest','finished','beforeWork','break','overtime','incomplete'])test(`tray status formats ${state} using provided Snapshot only`,()=>{const snapshot=snap(state);if(snapshot.ok&&['rest','finished'].includes(state))snapshot.data.countdown=null;assert.ok(trayStatus(snapshot).length>0);assert.ok(!trayStatus(snapshot).includes('undefined'))})
test('snapshot errors are explicitly unavailable, not a fabricated zero countdown',()=>assert.equal(trayStatus(unavailable),'倒计时暂不可用'))

const cleanup:Array<()=>void>=[],dirs:string[]=[];after(async()=>{for(const dispose of cleanup)dispose();for(const dir of dirs)await rm(dir,{recursive:true,force:true})})
async function service(){
  const ctx=context(),directory=await mkdtemp(join(tmpdir(),'workday-d13-'));dirs.push(directory);let failWrite=false,choice:ExitChoice='continueEditing',quits=0
  const store=value(createConfigStore({...ctx,directory,appVersion:'2.0.0',files:{...nodeConfigFiles,async writeExclusiveFlush(path,text){if(failWrite)throw Object.assign(Error('fixture'),{code:'EACCES'});return nodeConfigFiles.writeExclusiveFlush(path,text)}}}));value(await store.initialize(initial))
  const writes=createOperationBarrier(),runtime=createRuntime({...ctx,store,writes,maxHistoryDays:100000,confirm:async()=>success(choice)});value(await runtime.start())
  const quit=createQuitCoordinator({waitForWrites:writes.drain,restoreMain(){},commitQuit(){quits++;return success(null)},waitMilliseconds:3000,confirmationMilliseconds:3000});quit.registerDraft(runtime.exitAdapter);cleanup.push(()=>{runtime.dispose();quit.dispose()})
  return{runtime,store,directory,quit,get quits(){return quits},set choice(v:ExitChoice){choice=v},set failWrite(v:boolean){failWrite=v}}
}
test('notice acknowledgement never overwrites a draft, disk file or revision on its own',async()=>{const h=await service(),before=await readFile(join(h.directory,'settings.json'),'utf8'),session=value(h.runtime.readDraft());session.draft.salary={...(session.draft.salary as object),day:11};value(h.runtime.updateDraft({draft:session.draft,expectedRevision:session.expectedRevision}));const dirty=value(h.runtime.readDraft());h.runtime.acknowledgeTrayNotice();assert.deepEqual(value(h.runtime.readDraft()),dirty);assert.equal(await readFile(join(h.directory,'settings.json'),'utf8'),before);h.runtime.dispose()})
test('normal save safely persists pending notice together with intended fields',async()=>{const h=await service();h.runtime.acknowledgeTrayNotice();const config=value(h.runtime.readConfig()).config,settings=value(editableConfig(config));settings.salary.day=11;const saved=value(await h.runtime.save({settings,expectedRevision:config.revision}));assert.equal(saved.config.desktop.tray.firstHideNoticeAcknowledged,true);assert.equal(saved.config.salary.day,11);assert.equal(saved.config.revision,config.revision+1);h.runtime.dispose()})
test('failed save retains old acknowledgement, inputs and retry opportunity',async()=>{const h=await service();h.runtime.acknowledgeTrayNotice();const config=value(h.runtime.readConfig()).config,settings=value(editableConfig(config));h.failWrite=true;rejected(await h.runtime.save({settings,expectedRevision:config.revision}),'IO_DENIED');assert.equal(value(h.runtime.readConfig()).config.desktop.tray.firstHideNoticeAcknowledged,false);h.failWrite=false;assert.equal(value(await h.runtime.save({settings,expectedRevision:config.revision})).config.desktop.tray.firstHideNoticeAcknowledged,true);h.runtime.dispose()})
test('notice cannot bypass revision conflict or overwrite external changes',async()=>{const h=await service();h.runtime.acknowledgeTrayNotice();const config=value(h.runtime.readConfig()).config,settings=value(editableConfig(config));rejected(await h.runtime.save({settings,expectedRevision:config.revision+1}),'REVISION_CONFLICT');const file=join(h.directory,'settings.json'),original=await readFile(file,'utf8');await writeFile(file,original+'\n');rejected(await h.runtime.save({settings,expectedRevision:config.revision}),'REVISION_CONFLICT');assert.equal(await readFile(file,'utf8'),original+'\n');h.runtime.dispose()})
for(const [input,code]of [['{broken','REVISION_CONFLICT'],['{"schemaVersion":99}','UNSUPPORTED_SCHEMA']] as const)test(`pending notice cannot overwrite ${code} source`,async()=>{const h=await service(),config=value(h.runtime.readConfig()).config,file=join(h.directory,'settings.json');await writeFile(file,input);h.runtime.acknowledgeTrayNotice();assert.equal(await readFile(file,'utf8'),input);rejected(await h.runtime.save({settings:value(editableConfig(config)),expectedRevision:config.revision}),code);assert.equal(await readFile(file,'utf8'),input);h.runtime.dispose()})
for(const choice of ['continueEditing','discard','save'] as const)test(`tray exit preserves existing ${choice} coordination`,async()=>{const h=await service(),draft=value(h.runtime.readDraft());(draft.draft.salary as Record<string,unknown>).day=11;value(h.runtime.updateDraft({draft:draft.draft,expectedRevision:draft.expectedRevision}));h.choice=choice;const result=await h.quit.requestQuit();assert.equal(result.ok,choice!=='continueEditing');assert.equal(h.quits,choice==='continueEditing'?0:1);if(choice==='continueEditing')assert.equal(value(h.runtime.readDraft()).dirty,true);h.runtime.dispose();h.quit.dispose()})
test('failed dirty exit cannot exit or lose settings',async()=>{const h=await service(),draft=value(h.runtime.readDraft());(draft.draft.salary as Record<string,unknown>).day=11;value(h.runtime.updateDraft({draft:draft.draft,expectedRevision:draft.expectedRevision}));h.failWrite=true;h.choice='save';rejected(await h.quit.requestQuit(),'IO_DENIED');assert.equal(h.quits,0);assert.equal(value(h.runtime.readDraft()).dirty,true);h.runtime.dispose();h.quit.dispose()})
test('settings push validates exact DTO, releases listener and is absent from mini',()=>{let handler:(input:unknown)=>void=()=>{},removed=0,called=0;const transport={invoke:async()=>success(null),listen(_channel:string,fn:(payload:unknown)=>void){handler=fn;return()=>{removed++}}};const main=createV2Bridge('main',transport),mini=createV2Bridge('mini',transport);const stop=main.window.onOpenSettings(()=>called++);for(const dto of [{action:'openSettings',url:'http://evil'},{action:'navigate'},{action:'openSettings'}])handler(success(dto));assert.equal(called,1);assert.equal('onOpenSettings'in mini.window,false);stop();assert.equal(removed,1)})
test('router only pushes settings to the exact registered main page',async()=>{const h=await service();const router=createIpcRouter({handle(){},removeHandler(){}},h.runtime,{window:()=>success(null),quit:async()=>success(null)}),sent:unknown[]=[],sender={},frame={};let url='/trusted';router.register('main',{sender,frame:()=>frame,url:()=>url,destroyed:()=>false,visible:()=>false,push:(channel,payload)=>sent.push({channel,payload})},'/trusted');value(router.openSettings());assert.equal((sent[0] as {channel:string}).channel,OPEN_SETTINGS_PUSH);url='/foreign';rejected(router.openSettings(),'UNAVAILABLE');assert.equal(sent.length,1);router.dispose();h.runtime.dispose()})
