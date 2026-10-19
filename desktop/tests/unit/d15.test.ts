import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createWindowManager,type ManagedWindow} from '../../src/main/windows/window-manager'
import {createMiniController} from '../../src/main/windows/mini-controller'
import {createRuntime} from '../../src/main/services/runtime'
import {createConfigStore} from '../../src/main/services/config-store'
import {createIpcRouter} from '../../src/main/ipc/router'
import {createV2Bridge} from '../../src/shared/bridge'
import {createOperationBarrier} from '../../src/main/lifecycle/operation-barrier'
import {success} from '../../src/shared/validation'
import {value,rejected,context,initial} from './config-fixtures'
import type {TimerPort} from '../../src/main/services/clock'

// Explicit model ports: their visibility is not a native Windows GUI claim.
class ModelWindow extends EventEmitter implements ManagedWindow {
  visible=false;minimized=false;destroyed=false;fail=false;input='08:'
  isDestroyed(){return this.destroyed}isVisible(){return this.visible}isMinimized(){return this.minimized}
  show(){if(this.fail)throw Error('model show failure');this.visible=true;this.emit('show')}
  hide(){this.visible=false;this.emit('hide')}restore(){this.minimized=false;this.show()}focus(){}setAlwaysOnTop(){}
  destroy(){this.destroyed=true;this.visible=false;this.emit('closed')}
  listenersTotal(){return this.eventNames().reduce((n,key)=>n+this.listenerCount(key),0)}
}
async function harness(){
  const directory=await mkdtemp(join(tmpdir(),'workday-d15-')),ctx=context()
  const store=value(createConfigStore({...ctx,directory,appVersion:'2.0.0'}));value(await store.initialize({...initial,startDate:'2026-10-01'}))
  const jobs=new Map<object,()=>void>(),timers:TimerPort={set(fn){const key={};jobs.set(key,fn);return key},clear(key){jobs.delete(key as object)}}
  const runtime=createRuntime({...ctx,store,timers,writes:createOperationBarrier(),confirm:async()=>success('continueEditing'),maxHistoryDays:100000});value(await runtime.start())
  const saved=value(runtime.readConfig()).config;const enabled={...saved.desktop,miniEnabled:true}
  const main=new ModelWindow(),small=new ModelWindow(),windows=createWindowManager(()=>main);value(windows.showMain());let available=true,created=0,pending=false
  value(windows.registerTrayRecovery({isAvailable:()=>available,registerRestore:()=>()=>{}}))
  const mini=createMiniController({windows,config:()=>success({...saved,desktop:enabled}),pending:async()=>success(pending),create:async()=>{created++;return success(small)},destroy:w=>(w as ModelWindow).destroy(),exiting:()=>false,changed(){}})
  const handlers=new Map<string,(event:{sender:object;senderFrame:unknown},input:unknown)=>Promise<unknown>>()
  const router=createIpcRouter({handle:(channel,fn)=>handlers.set(channel,fn),removeHandler:channel=>handlers.delete(channel)},runtime,{window:()=>success(null),quit:async()=>success(null)})
  function bridge(role:'main'|'mini',window:ModelWindow){
    const sender={},frame={},events=new EventEmitter(),trusted=`file:///test/${role}.html`;let url=trusted
    const release=router.register(role,{sender,frame:()=>frame,url:()=>url,destroyed:()=>window.destroyed,visible:()=>window.visible,push:(channel,payload)=>events.emit(channel,payload)},trusted)
    const transport={invoke:(channel:string,input:unknown)=>handlers.get(channel)!({sender,senderFrame:frame},input),listen:(channel:string,fn:(payload:unknown)=>void)=>{events.on(channel,fn);return()=>{events.removeListener(channel,fn)}}}
    const api=role==='main'?createV2Bridge('main',transport):createV2Bridge('mini',transport)
    return{api,sender,frame,events,release,set url(value:string){url=value},listeners:()=>events.eventNames().reduce((n,key)=>n+events.listenerCount(key),0)}
  }
  const a=bridge('main',main),b=bridge('mini',small)
  return{ctx,runtime,windows,mini,main,small,a,b,jobs,handlers,directory,set pending(v:boolean){pending=v},set available(v:boolean){available=v},created:()=>created,
    async dispose(){mini.dispose();router.dispose();windows.dispose();runtime.dispose();assert.equal(jobs.size,0);assert.equal(handlers.size,0);assert.equal(main.listenersTotal()+small.listenersTotal(),0);assert.ok(directory.startsWith(join(tmpdir(),'workday-d15-')));await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}
}

test('D15 100 model switches keep one mini, authoritative dirty draft, one timer and no accumulating IPC subscriptions',async()=>{
  const h=await harness();try{
    const draft=value(h.runtime.readDraft());(draft.draft.salary as Record<string,unknown>).day=11;value(h.runtime.updateDraft({draft:draft.draft,expectedRevision:draft.expectedRevision}))
    const dirty=value(h.runtime.readDraft()),before=await readFile(join(h.directory,'settings.json'),'utf8');await h.mini.prepare()
    const baseline=[h.main.listenersTotal(),h.small.listenersTotal()]
    for(let i=0;i<100;i++){
      value(await h.a.api.snapshot.subscribe(()=>{}));assert.equal(h.runtime.refresh.subscriberCount(),1)
      const old=value(await h.a.api.snapshot.read());value(await h.a.api.snapshot.unsubscribe());value(await h.mini.show())
      assert.equal(h.windows.state(),'miniVisible');assert.equal(h.main.visible,false)
      value(await h.b.api.snapshot.subscribe(()=>{}));const next=value(await h.b.api.snapshot.read());assert.deepEqual(next,old)
      assert.equal(h.runtime.refresh.subscriberCount(),1);value(await h.b.api.snapshot.unsubscribe());value(h.windows.showMain())
      assert.equal(h.runtime.refresh.subscriberCount(),0);assert.equal(h.a.listeners()+h.b.listeners(),0);assert.equal(h.jobs.size,1)
      assert.deepEqual([h.main.listenersTotal(),h.small.listenersTotal()],baseline);assert.equal(h.small.visible,false);assert.equal(h.main.input,'08:')
      assert.deepEqual(value(h.runtime.readDraft()),dirty)
    }
    assert.equal(h.created(),1);assert.equal(await readFile(join(h.directory,'settings.json'),'utf8'),before)
  }finally{await h.dispose()}
})
test('D15 repeated model show failure and lost tray recovery preserve an operable main and input',async()=>{
  const h=await harness();try{await h.mini.prepare();const before=h.small.listenersTotal()
    for(let i=0;i<100;i++){h.small.fail=true;rejected(await h.mini.show(),'UNAVAILABLE');assert.equal(h.main.visible,true);h.small.fail=false;value(await h.mini.show());h.available=false;value(h.mini.hide());assert.equal(h.main.visible,true);assert.equal(h.main.input,'08:');h.available=true;assert.equal(h.small.listenersTotal(),before)}
    assert.equal(h.created(),1)
  }finally{await h.dispose()}
})
test('D15 frame navigation invalidates old subscription then clean re-registration does not retain listeners',async()=>{
  const h=await harness();try{
    for(let i=0;i<100;i++){value(await h.b.api.snapshot.subscribe(()=>{}));h.b.url='file:///test/other.html';rejected(await h.b.api.snapshot.read(),'FORBIDDEN');value(h.ctx.clock.advanceMilliseconds(1000));await h.runtime.snapshots.read();assert.equal(h.runtime.refresh.subscriberCount(),0);await h.b.api.snapshot.unsubscribe();h.b.url='file:///test/mini.html';assert.equal(h.b.listeners(),0)}
  }finally{await h.dispose()}
})
test('D15 hidden service wake uses jumped clock/date/timezone immediately without replaying missed seconds',async()=>{
  const h=await harness();try{
    const first=value(await h.runtime.snapshots.read());value(h.ctx.clock.setInstant(Date.parse('2026-10-15T00:01:00Z')));h.runtime.refresh.wake(true)
    let next=value(await h.runtime.snapshots.read());assert.equal(next.localDate,'2026-10-15');assert.ok(next.sequence>first.sequence)
    value(h.ctx.clock.setTimeZone('Asia/Shanghai'));h.runtime.refresh.wake(true);next=value(await h.runtime.snapshots.read());assert.equal(next.timeZoneId,'Asia/Shanghai');assert.equal(next.computedAt,Date.parse('2026-10-15T00:01:00Z'))
    value(h.ctx.clock.setInstant(Date.parse('2026-10-14T08:00:00Z')));h.runtime.refresh.wake(true);const back=value(await h.runtime.snapshots.read());assert.ok(back.sequence>next.sequence);assert.equal(back.localDate,'2026-10-14');assert.equal(h.jobs.size,1)
  }finally{await h.dispose()}
})
