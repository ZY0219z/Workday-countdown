import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import type { Result } from '../../src/shared/contracts'
import { success } from '../../src/shared/validation'
import { createSettingsDraft, updateSettingsDraft, beginDraftSave, finishDraftSave, prepareDraftSave } from '../../src/shared/settings-draft'
import { APPLICATION_ID, resolveApplicationPaths } from '../../src/main/app-identity'
import { acquireSingleInstance } from '../../src/main/single-instance'
import { restoreWindowBounds, applyRestoredBounds } from '../../src/main/windows/window-bounds'
import type { DisplayArea } from '../../src/main/windows/window-bounds'
import { createWindowManager } from '../../src/main/windows/window-manager'
import { createQuitCoordinator } from '../../src/main/lifecycle/quit-coordinator'
import type { ExitDraft, ExitChoice, ExitDraftAdapter } from '../../src/main/lifecycle/quit-coordinator'
import { createOperationBarrier } from '../../src/main/lifecycle/operation-barrier'
import { createPocDraftAdapter } from '../../src/main/lifecycle/poc-draft'
import { backgroundTestEnabled, blockInteractiveWindowOperations } from '../../src/main/lifecycle/background-testing'
import { createConfigStore } from '../../src/main/services/config-store'
import { nodeConfigFiles } from '../../src/main/services/config-files'
import { context, initial, value, rejected } from './config-fixtures'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
class FakeWindow extends EventEmitter {
  destroyed = false; visible = false; minimized = false; focusCount = 0; topChanges: boolean[] = []
  form = { value: 'unsaved' }
  isDestroyed() { return this.destroyed }
  isVisible() { return this.visible }
  isMinimized() { return this.minimized }
  show() { this.visible = true; this.emit('show') }
  hide() { this.visible = false; this.emit('hide') }
  restore() { this.minimized = false; this.visible = true; this.emit('restore') }
  minimize() { this.minimized = true; this.visible = false; this.emit('minimize') }
  focus() { this.focusCount++ }
  setAlwaysOnTop(enabled: boolean) { this.topChanges.push(enabled) }
  destroy() { this.destroyed = true; this.visible = false; this.emit('closed') }
}
function manager() {
  const created: FakeWindow[] = []
  const windows = createWindowManager(() => { const window = new FakeWindow(); created.push(window); return window })
  return { windows, created }
}
function tray() {
  let callback: (() => void) | null = null, available = true, released = 0
  return { port: { isAvailable: () => available, registerRestore(restore: () => void) { callback = restore; return () => { released++; if (callback === restore) callback = null } } },
    fail() { available = false }, restore() { callback?.() }, releases: () => released }
}
function quitting(options: { choice?: ExitChoice; dirty?: boolean; wait?: number; confirm?: ExitDraftAdapter['confirm']; save?: ExitDraftAdapter['save']; drain?: () => Promise<Result<null>> } = {}) {
  const state: ExitDraft = { dirty: options.dirty ?? false, saving: false, identity: 'revision1:draft1' }
  const calls = { quit: 0, restore: 0, save: 0, discard: 0, confirm: 0 }
  const coordinator = createQuitCoordinator({ waitMilliseconds: options.wait ?? 500, confirmationMilliseconds: options.wait ?? 500,
    waitForWrites: options.drain ?? (async () => success(null)), restoreMain() { calls.restore++ }, commitQuit() { calls.quit++; return success(null) } })
  const adapter: ExitDraftAdapter = { read: async () => success({ ...state }),
    async confirm(snapshot) { calls.confirm++; return options.confirm ? options.confirm(snapshot) : success(options.choice ?? 'continueEditing') },
    async save(identity) { calls.save++; if (options.save) return options.save(identity); state.dirty = false; return success(null) },
    async discard() { calls.discard++; state.dirty = false; return success(null) }
  }
  const unregister = coordinator.registerDraft(adapter)
  return { coordinator, state, calls, adapter, unregister }
}
const defaults = { x: 30, y: 40, width: 600, height: 560 }, minimum = { width: 420, height: 500 }
const primary: DisplayArea = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }
const second: DisplayArea = { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 }

test('background mode requires unpackaged development, owned profile AND exact marker; packaged runtime cannot enable it',()=>{
  assert.equal(backgroundTestEnabled(true,true,'1'),true)
  for(const marker of ['1',true,'--background',null,undefined]){
    assert.equal(backgroundTestEnabled(true,false,marker),false)
    assert.equal(backgroundTestEnabled(false,true,marker),false)
  }
  for(const marker of [true,'--background',null,undefined])assert.equal(backgroundTestEnabled(true,true,marker),false)
})
test('background window guard refuses interactive operations without faking native state',()=>{
  let called=0;const window={show(){called++},showInactive(){called++},focus(){called++},restore(){called++},minimize(){called++}}
  const attempts=blockInteractiveWindowOperations(window)
  for(const method of ['show','showInactive','focus','restore','minimize'] as const)assert.throws(()=>window[method](),/后台测试禁止/)
  assert.equal(called,0);assert.deepEqual(attempts,['show','showInactive','focus','restore','minimize'])
})

test('stable identity has no EXE path/version input; formal and POC settings separate', () => {
  const appData = join(tmpdir(), 'fixture-appdata'), a = value(resolveApplicationPaths({ appData, temp: tmpdir(), testMode: false, testProfile: null }))
  assert.equal(APPLICATION_ID, 'com.workdayescape'); assert.equal(a.userData, join(appData,'Workday Escape'))
  assert.equal(a.pocSettings, join(appData,'Workday Escape POC','settings.json'));assert.notEqual(a.pocSettings,join(a.userData,'settings.json'))
  const b=value(resolveApplicationPaths({appData,temp:tmpdir(),testMode:false,testProfile:'C:\\arbitrary-profile'}));assert.deepEqual(b,a)
})
test('only explicit test mode and owned temporary profiles permit identity override',()=>{
  const appData=join(tmpdir(),'fake-appdata'),profile=join(tmpdir(),'workday-d08-fixture')
  const paths=value(resolveApplicationPaths({appData,temp:tmpdir(),testMode:true,testProfile:profile}));assert.equal(paths.userData,join(profile,'lifecycle'));assert.equal(paths.pocSettings,join(profile,'settings.json'))
  for(const path of [tmpdir(),join(tmpdir(),'..','outside'),join(tmpdir(),'ordinary'),'relative'])rejected(resolveApplicationPaths({appData,temp:tmpdir(),testMode:true,testProfile:path}))
  assert.notEqual(paths.userData,value(resolveApplicationPaths({appData,temp:tmpdir(),testMode:true,testProfile:join(tmpdir(),'workday-d08-other')})).userData)
})
test('single-instance owns lock once, ignores second argv, releases once and removes listener',()=>{
  const events=new EventEmitter();let released=0,restored=0,requests=0,exited=0
  const instance=value(acquireSingleInstance({on:events.on.bind(events),off:events.off.bind(events),requestSingleInstanceLock(){requests++;return true},releaseSingleInstanceLock(){released++},quit(){exited++}},()=>{restored++}))
  assert.equal(instance.primary,true);events.emit('second-instance',{},['--import=untrusted'], 'C:\\arbitrary', {execute:'bad'})
  assert.equal(restored,0);instance.markReady();assert.equal(restored,1);events.emit('second-instance');assert.equal(restored,2)
  instance.beginQuit();events.emit('second-instance');assert.equal(restored,2);instance.dispose();instance.dispose()
  assert.equal(released,1);assert.equal(requests,1);assert.equal(exited,0);assert.equal(events.listenerCount('second-instance'),0)
})
test('lock failure exits before ready/window creation and does not release someone else lock',()=>{
  const events=new EventEmitter();let exited=0,released=0,restored=0
  const instance=value(acquireSingleInstance({on:events.on.bind(events),off:events.off.bind(events),requestSingleInstanceLock:()=>false,releaseSingleInstanceLock(){released++},quit(){exited++}},()=>{restored++}))
  instance.markReady();instance.dispose();assert.equal(instance.primary,false);assert.equal(exited,1);assert.equal(released,0);assert.equal(restored,0);assert.equal(events.listenerCount('second-instance'),0)
})
test('lock exception returns failure and leaves no registered instance listener',()=>{
  const events=new EventEmitter()
  rejected(acquireSingleInstance({on:events.on.bind(events),off:events.off.bind(events),requestSingleInstanceLock(){throw Error('lock unavailable')},releaseSingleInstanceLock(){},quit(){}},()=>{}),'UNAVAILABLE')
  assert.equal(events.listenerCount('second-instance'),0)
})
test('window creation/show are idempotent and starting state does not create',()=>{
  const {windows,created}=manager();assert.equal(windows.state(),'starting');value(windows.ensureMain());value(windows.ensureMain());value(windows.showMain());value(windows.showMain());assert.equal(created.length,1);assert.equal(windows.state(),'mainVisible')
})
test('minimized main remains minimized, restoring focuses the same window',()=>{
  const {windows,created}=manager();value(windows.showMain());created[0].minimize();assert.equal(windows.state(),'mainMinimized');assert.equal(created[0].minimized,true)
  value(windows.showMain());assert.equal(created.length,1);assert.equal(created[0].minimized,false);assert.equal(windows.state(),'mainVisible')
})
test('no tray refuses hiding; even external hide automatically recovers visible main',()=>{
  const {windows,created}=manager();value(windows.showMain());rejected(windows.hideMain(),'UNAVAILABLE');assert.equal(windows.state(),'mainVisible')
  created[0].hide();assert.equal(created[0].visible,true);assert.equal(created.length,1)
})
test('registered controlled recovery allows trayOnly, revoke/failure restores main',()=>{
  const {windows}=manager(),recovery=tray();value(windows.showMain());const revoke=value(windows.registerTrayRecovery(recovery.port));value(windows.hideMain());assert.equal(windows.state(),'trayOnly')
  recovery.restore();assert.equal(windows.state(),'mainVisible');value(windows.hideMain());recovery.fail();assert.equal(windows.state(),'mainVisible');revoke();revoke();assert.equal(recovery.releases(),1)
})
test('registration failure cannot falsely establish trayReady',()=>{
  const {windows}=manager();value(windows.showMain());rejected(windows.registerTrayRecovery({isAvailable:()=>true,registerRestore(){throw Error('no tray')}}),'UNAVAILABLE');rejected(windows.hideMain(),'UNAVAILABLE');assert.equal(windows.state(),'mainVisible')
})
test('old recovery revoker cannot remove a newer registration using the same port',()=>{
  const {windows}=manager(),recovery=tray();value(windows.showMain());const old=value(windows.registerTrayRecovery(recovery.port)),current=value(windows.registerTrayRecovery(recovery.port));old();value(windows.hideMain());assert.equal(windows.state(),'trayOnly');current();assert.equal(windows.state(),'mainVisible')
})
test('mini unavailable/disabled by default, explicit mock registration does not create real MiniView',()=>{
  const {windows,created}=manager();value(windows.showMain());rejected(windows.showMini(),'UNAVAILABLE');const mini=new FakeWindow();value(windows.registerMini(mini));rejected(windows.showMini(),'UNAVAILABLE');assert.deepEqual(mini.topChanges,[])
  value(windows.setMiniEnabled(true));value(windows.showMini());assert.equal(windows.state(),'miniVisible');assert.equal(created[0].visible,false);assert.equal(mini.visible,true)
})
test('main/mini transitions preserve same dirty form, exclusive visibility and manual top only',()=>{
  const {windows,created}=manager();value(windows.showMain());const main=created[0],form=main.form,mini=new FakeWindow();value(windows.registerMini(mini));value(windows.setMiniEnabled(true))
  for(let i=0;i<10;i++){value(windows.showMini());assert.equal(main.visible,false);assert.equal(mini.visible,true);value(windows.showMain());assert.equal(main.visible,true);assert.equal(mini.visible,false)}
  assert.equal(main.form,form);assert.equal(form.value,'unsaved');assert.equal(created.length,1);assert.deepEqual(mini.topChanges,[]);value(windows.setMiniTop(true));value(windows.setMiniTop(false));assert.deepEqual(mini.topChanges,[true,false])
})
test('mini close/hide without tray restores main, with mock recovery enters trayOnly',()=>{
  const {windows}=manager();value(windows.showMain());const mini=new FakeWindow();value(windows.registerMini(mini));value(windows.setMiniEnabled(true));value(windows.showMini());value(windows.hideMini());assert.equal(windows.state(),'mainVisible')
  const recovery=tray();value(windows.registerTrayRecovery(recovery.port));value(windows.showMini());value(windows.hideMini());assert.equal(windows.state(),'trayOnly')
})
test('destroyed refs are removed, later restore creates only one replacement',()=>{
  const {windows,created}=manager();value(windows.showMain());const old=created[0];old.destroy();assert.equal(old.listenerCount('closed'),0);assert.notEqual(windows.getMain(),old);value(windows.showMain());assert.equal(created.length,2)
})
test('quitting/dispose never recreate windows and detach registered listeners',()=>{
  const {windows,created}=manager();value(windows.showMain());windows.beginQuit();created[0].destroy();rejected(windows.showMain(),'UNAVAILABLE');assert.equal(windows.state(),'quitting');assert.equal(created.length,1)
  windows.dispose();windows.dispose();assert.equal(windows.getMain(),null);assert.equal(created[0].eventNames().length,0);rejected(windows.ensureMain(),'UNAVAILABLE')
})
test('factory failure/reentrant creation is bounded and cannot create two windows',()=>{
  let calls=0;const failed=createWindowManager(()=>{calls++;throw Error('factory')});rejected(failed.ensureMain(),'UNAVAILABLE');assert.equal(calls,1)
  let nested:ReturnType<typeof createWindowManager>;nested=createWindowManager(()=>{rejected(nested.ensureMain(),'UNAVAILABLE');return new FakeWindow()});value(nested.ensureMain())
})
for(const scaleFactor of [1,1.25,1.5,2])test(`DIP restoration at simulated ${scaleFactor*100}% scale does not double scale coordinates`,()=>{
  const result=value(restoreWindowBounds(defaults,[{...primary,scaleFactor}],1,defaults,minimum));assert.deepEqual(result.bounds,defaults);assert.deepEqual(result.minimum,minimum)
})
test('removed secondary/offscreen coordinates recover entirely inside primary workArea',()=>{
  const saved={x:-1200,y:100,width:600,height:560}
  assert.equal(value(restoreWindowBounds(saved,[primary,second],1,defaults,minimum)).displayId,2)
  const restored=value(restoreWindowBounds(saved,[primary],1,defaults,minimum));assert.equal(restored.displayId,1);assert.equal(restored.bounds.x,0)
})
test('oversized/small workArea reduce size AND minimum so critical content may scroll',()=>{
  const area={id:3,workArea:{x:40,y:50,width:320,height:280},scaleFactor:2},restored=value(restoreWindowBounds({x:5000,y:5000,width:1200,height:900},[area],3,defaults,minimum))
  assert.deepEqual(restored.bounds,area.workArea);assert.deepEqual(restored.minimum,{width:320,height:280})
})
test('resolution change and fractional saved bounds remain within selected display',()=>{
  const area={...primary,workArea:{x:0,y:0,width:800,height:600}},result=value(restoreWindowBounds({x:1600.5,y:900.2,width:650.4,height:540.8},[area],1,defaults,minimum))
  assert.ok(result.bounds.x>=0&&result.bounds.y>=0&&result.bounds.x+result.bounds.width<=800&&result.bounds.y+result.bounds.height<=600)
  assert.ok(Object.values(result.bounds).every(Number.isInteger))
})
test('geometry refuses nonfinite/negative/unknown/dangerous data and no displays',()=>{
  for(const saved of [{...defaults,width:0},{...defaults,x:NaN},{...defaults,extra:true},JSON.parse('{"__proto__":{},"x":0,"y":0,"width":600,"height":560}')])rejected(restoreWindowBounds(saved,[primary],1,defaults,minimum))
  rejected(restoreWindowBounds(defaults,[],1,defaults,minimum));rejected(restoreWindowBounds(defaults,[{...primary,scaleFactor:0}],1,defaults,minimum))
})
test('native fractional-scale frame differences are corrected from measured geometry, not tolerated',async()=>{
  let actual={...defaults},minimumSize={width:0,height:0}
  const window={getBounds:()=>actual,setBounds(bounds:typeof defaults){actual={x:bounds.x-1,y:bounds.y-1,width:bounds.width+2,height:bounds.height+2}},setMinimumSize(width:number,height:number){minimumSize={width,height}}}
  assert.deepEqual(value(await applyRestoredBounds(window,{bounds:defaults,minimum},async()=>{})),defaults)
  const small={x:0,y:0,width:320,height:280};assert.deepEqual(value(await applyRestoredBounds(window,{bounds:small,minimum:{width:320,height:280}},async()=>{})),small);assert.deepEqual(minimumSize,{width:318,height:278})
})
test('uncooperative or destroyed native window gives bounded failure instead of success',async()=>{
  let attempts=0
  const window={getBounds:()=>({...defaults,x:100000}),setBounds(){attempts++},setMinimumSize(){}}
  rejected(await applyRestoredBounds(window,{bounds:defaults,minimum},async()=>{}));assert.equal(attempts,3)
  rejected(await applyRestoredBounds({...window,getBounds(){throw Error('destroyed')}},{bounds:defaults,minimum},async()=>{}),'UNAVAILABLE')
})
test('150% native odd DIP dimensions settle inside the target instead of oscillating outside',async()=>{
  let actual={x:21845,y:21845,width:601,height:561},attempts=0
  const target={x:1106,y:458,width:601,height:561}
  const window={getBounds:()=>actual,setBounds(bounds:typeof defaults){attempts++;actual={...bounds,width:bounds.width%2?bounds.width+1:bounds.width,height:bounds.height%2?bounds.height+1:bounds.height}},setMinimumSize(){}}
  const result=value(await applyRestoredBounds(window,{bounds:target,minimum},async()=>{}))
  assert.deepEqual(result,{...target,width:600,height:560});assert.equal(attempts,2)
  assert.ok(result.x+result.width<=1707&&result.y+result.height<=1019)
})
test('unregistered draft cannot be silently declared clean',async()=>{
  let committed=0;const quit=createQuitCoordinator({waitMilliseconds:10,confirmationMilliseconds:10,waitForWrites:async()=>success(null),restoreMain(){},commitQuit(){committed++;return success(null)}})
  rejected(await quit.requestQuit(),'UNAVAILABLE');assert.equal(committed,0)
})
test('clean exit commits once and repeated requests are idempotent',async()=>{
  const app=quitting();const a=app.coordinator.requestQuit(),b=app.coordinator.requestQuit();assert.equal(a,b);value(await a);value(await app.coordinator.requestQuit());assert.equal(app.calls.quit,1);assert.equal(app.calls.confirm,0)
})
test('dirty continue editing cancels exit and keeps draft without saves/discards',async()=>{
  const app=quitting({dirty:true});rejected(await app.coordinator.requestQuit(),'CANCELLED');assert.equal(app.state.dirty,true);assert.equal(app.calls.save,0);assert.equal(app.calls.discard,0);assert.equal(app.calls.quit,0)
})
test('explicit discard is the only non-save path that may drop dirty draft',async()=>{
  const app=quitting({dirty:true,choice:'discard'});value(await app.coordinator.requestQuit());assert.equal(app.calls.discard,1);assert.equal(app.calls.save,0);assert.equal(app.calls.quit,1)
})
test('save success clears draft before quit, save failure keeps it and cancels quit',async()=>{
  const good=quitting({dirty:true,choice:'save'});value(await good.coordinator.requestQuit());assert.equal(good.calls.save,1);assert.equal(good.calls.quit,1)
  const bad=quitting({dirty:true,choice:'save',save:async()=>({ok:false,error:{code:'IO_DENIED',message:'测试保存拒绝'}})});rejected(await bad.coordinator.requestQuit(),'IO_DENIED');assert.equal(bad.state.dirty,true);assert.equal(bad.calls.quit,0)
})
test('success response that leaves dirty draft is not treated as successful exit',async()=>{
  const app=quitting({dirty:true,choice:'save',save:async()=>success(null)});rejected(await app.coordinator.requestQuit(),'UNAVAILABLE');assert.equal(app.calls.quit,0)
})
test('concurrent quit while confirmation/save pending does not duplicate operations',async()=>{
  const decision=deferred<Result<ExitChoice>>(),saved=deferred<Result<null>>();const app=quitting({dirty:true,confirm:()=>decision.promise,save:()=>saved.promise})
  const first=app.coordinator.requestQuit();await Promise.resolve();const second=app.coordinator.requestQuit();assert.equal(first,second)
  decision.resolve(success('save'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(app.calls.save,1);assert.equal(app.calls.quit,0)
  app.state.dirty=false;saved.resolve(success(null));value(await first);assert.equal(app.calls.confirm,1);assert.equal(app.calls.quit,1)
})
test('confirmation timeout does not accept late choice or create another pending dialog',async()=>{
  const decision=deferred<Result<ExitChoice>>(),app=quitting({dirty:true,wait:10,confirm:()=>decision.promise})
  rejected(await app.coordinator.requestQuit(),'IO_BUSY');rejected(await app.coordinator.requestQuit(),'IO_BUSY');assert.equal(app.calls.confirm,1)
  decision.resolve(success('discard'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(app.state.dirty,true);assert.equal(app.calls.discard,0);assert.equal(app.calls.quit,0)
})
test('save timeout does not cancel write or allow duplicate save/early destruction',async()=>{
  const saved=deferred<Result<null>>(),app=quitting({dirty:true,choice:'save',wait:10,save:()=>saved.promise})
  rejected(await app.coordinator.requestQuit(),'IO_BUSY');rejected(await app.coordinator.requestQuit(),'IO_BUSY');assert.equal(app.calls.save,1);assert.equal(app.calls.quit,0)
  app.state.dirty=false;saved.resolve(success(null));await new Promise(resolve=>setTimeout(resolve,0));value(await app.coordinator.requestQuit());assert.equal(app.calls.quit,1)
})
test('changed/removed draft during confirmation or illegal choices cannot authorize exit',async()=>{
  const app=quitting({dirty:true,confirm:async()=>{app.state.identity='new-draft';return success('discard')}});rejected(await app.coordinator.requestQuit(),'UNAVAILABLE');assert.equal(app.calls.discard,0)
  const removed=quitting({dirty:true,confirm:async()=>{removed.unregister();return success('discard')}});rejected(await removed.coordinator.requestQuit(),'UNAVAILABLE')
  const illegal=quitting({dirty:true,confirm:async()=>success('bogus'as ExitChoice)});rejected(await illegal.coordinator.requestQuit())
})
test('pending writes and saving/unknown snapshots block exit with bounded failure',async()=>{
  const never=deferred<Result<null>>(),app=quitting({wait:10,drain:()=>never.promise});rejected(await app.coordinator.requestQuit(),'IO_BUSY');assert.equal(app.calls.quit,0);never.resolve(success(null))
  const busy=quitting();busy.state.saving=true;rejected(await busy.coordinator.requestQuit(),'IO_BUSY')
})
test('disposing during pending read resolves cancellation and never commits later',async()=>{
  const read=deferred<Result<ExitDraft>>(),app=quitting();app.adapter.read=()=>read.promise
  const result=app.coordinator.requestQuit();await new Promise(resolve=>setTimeout(resolve,0));app.coordinator.dispose();rejected(await result,'CANCELLED');read.resolve(success({...app.state}));assert.equal(app.calls.quit,0)
})
test('adapter exceptions return structured errors and retain restore path',async()=>{
  const app=quitting();app.adapter.read=async()=>{throw Error('private host failure')};rejected(await app.coordinator.requestQuit(),'UNAVAILABLE');assert.equal(app.calls.quit,0);assert.ok(app.calls.restore>0)
})
test('operation barrier drains pending writes, refuses work after seal and may reopen',async()=>{
  const barrier=createOperationBarrier(),pending=deferred<Result<null>>();const operation=barrier.run(()=>pending.promise);assert.equal(barrier.pendingCount(),1)
  const drained=barrier.drain();barrier.seal();let started=false;rejected(await barrier.run(async()=>{started=true;return success(null)}),'UNAVAILABLE');assert.equal(started,false)
  pending.resolve(success(null));value(await operation);value(await drained);assert.equal(barrier.pendingCount(),0);barrier.reopen();value(await barrier.run(async()=>success(null)))
})
test('POC adapter reads actual values, empty/invalid edits stay dirty and failed save keeps them',async()=>{
  let form={workStartTime:'08:30',workEndTime:'18:00',busy:false},saved={workStartTime:'08:30',workEndTime:'18:00'},calls=0
  const adapter=createPocDraftAdapter({readForm:async()=>({...form}),saved:()=>({...saved}),confirm:async()=>success('save'),save:async value=>{calls++;saved=value;return success(null)},discardForm:async()=>{form={...saved,busy:false};return success(null)}})
  assert.equal(value(await adapter.read()).dirty,false);form.workStartTime='';const dirty=value(await adapter.read());assert.equal(dirty.dirty,true);rejected(await adapter.save(dirty.identity));assert.equal(calls,0)
  value(await adapter.discard(dirty.identity));assert.equal(value(await adapter.read()).dirty,false);form.workEndTime='19:00';const valid=value(await adapter.read());value(await adapter.save(valid.identity));assert.equal(saved.workEndTime,'19:00')
})
test('POC missing/unsafe form is unknown, not fixed clean; stale identity rejects mutation',async()=>{
  const adapter=createPocDraftAdapter({readForm:async()=>null,saved:()=>({workStartTime:'08:30',workEndTime:'18:00'}),confirm:async()=>success('discard'),save:async()=>success(null),discardForm:async()=>success(null)})
  rejected(await adapter.read());rejected(await adapter.discard('stale'),'UNAVAILABLE')
})
test('D07 real delayed save survives quit timeout, old file/draft remain until commit, retry exits once',async t=>{
  const scratch=await mkdtemp(join(tmpdir(),'workday-d08-store-'));t.after(async()=>{assert.ok(isAbsolute(scratch)&&scratch.startsWith(join(tmpdir(),'workday-d08-store-')));await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100})})
  const gate=deferred<void>();let blocked=false,saveCalls=0
  const files={...nodeConfigFiles,async writeExclusiveFlush(path:string,text:string){if(blocked&&path.includes('settings.'))await gate.promise;await nodeConfigFiles.writeExclusiveFlush(path,text)}}
  const store=value(createConfigStore({...context(),directory:scratch,appVersion:'2.0.0',files}));value(await store.initialize(initial));const before=await readFile(join(scratch,'settings.json'),'utf8')
  let draft=value(createSettingsDraft(value(await store.read()).config)),raw=structuredClone(draft.draft);(raw.appearance as Record<string,unknown>).accent='coral';draft=value(updateSettingsDraft(draft,raw))
  const barrier=createOperationBarrier();let commits=0
  const quit=createQuitCoordinator({waitMilliseconds:20,confirmationMilliseconds:500,waitForWrites:barrier.drain,restoreMain(){},commitQuit(){commits++;return success(null)}})
  quit.registerDraft({read:async()=>success({dirty:draft.dirty,saving:draft.save.status==='saving',identity:JSON.stringify(draft.draft)}),confirm:async()=>success('save'),discard:async()=>{throw Error('unexpected discard')},
    save:async()=>barrier.run(async()=>{saveCalls++;const req=value(prepareDraftSave(draft,value(await store.read()).config.revision));draft=value(beginDraftSave(draft,req.expectedRevision));const saved=await store.save(req);draft=value(finishDraftSave(draft,saved.ok?success(saved.data.config):saved));return saved.ok?success(null):saved})})
  blocked=true;rejected(await quit.requestQuit(),'IO_BUSY');assert.equal(commits,0);assert.equal(draft.dirty,true);assert.equal(await readFile(join(scratch,'settings.json'),'utf8'),before)
  rejected(await quit.requestQuit(),'IO_BUSY');assert.equal(saveCalls,1);gate.resolve();value(await barrier.drain());await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(value(await store.read()).config.revision,2);assert.equal(draft.dirty,false);value(await quit.requestQuit());assert.equal(commits,1)
})
