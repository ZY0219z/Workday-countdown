import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fixtures,render,progressRatio,fishPosition,fishCanAnimate,createThemeController,createIpcRouter,createV2Bridge,validateContractRequest,V2_CHANNELS,WINDOW_VISIBILITY_PUSH,windowPresentationVisible,MAIN_WINDOW_DEFAULT_SIZE,MAIN_WINDOW_MINIMUM_SIZE,restoreWindowBounds} from '../../test-results/d12-ssr/components.mjs'
const f=fixtures(),ok=data=>({ok:true,data})
test('compact default bounds share one source, preserve saved bounds and clamp to small work areas',()=>{
  assert.deepEqual(MAIN_WINDOW_DEFAULT_SIZE,{width:720,height:640});assert.deepEqual(MAIN_WINDOW_MINIMUM_SIZE,{width:480,height:520})
  const displays=[{id:1,workArea:{x:0,y:0,width:1920,height:1080},scaleFactor:1}],defaults={x:0,y:0,...MAIN_WINDOW_DEFAULT_SIZE}
  assert.deepEqual(restoreWindowBounds(null,displays,1,defaults,MAIN_WINDOW_MINIMUM_SIZE).data.bounds,defaults)
  const saved={x:20,y:30,width:900,height:700};assert.deepEqual(restoreWindowBounds(saved,displays,1,defaults,MAIN_WINDOW_MINIMUM_SIZE).data.bounds,saved)
  const oldDefault={x:20,y:30,width:720,height:660};assert.deepEqual(restoreWindowBounds(oldDefault,displays,1,defaults,MAIN_WINDOW_MINIMUM_SIZE).data.bounds,oldDefault)
  const small=restoreWindowBounds(null,[{id:1,workArea:{x:0,y:0,width:400,height:300},scaleFactor:2}],1,defaults,MAIN_WINDOW_MINIMUM_SIZE).data;assert.equal(small.bounds.height,300);assert.equal(small.minimum.height,300)
})
test('progress uses one original cat, a clean fill and only necessary copy',async()=>{
  const html=await render(f.snapshots.working)
  assert.equal((html.match(/原始蓝色摸鱼猫抱灰鱼/g)||[]).length,1);assert.ok(html.includes('fish-mascot--floating'));assert.ok(html.includes('fish-readout'));assert.ok(!html.includes('fish-waves'));assert.ok(!html.includes('fish-body'));assert.ok(!html.includes('we-countdown-illustration'))
  assert.ok(!html.includes('有效工作进度 · 不含午休'));assert.ok(html.includes('摸鱼一小步，下班一大步'));assert.ok(html.includes('下班时间：2026-10-15 18:00'));assert.ok(!html.includes('最终下班：'))
  const stopped=await render(f.snapshots.break);assert.ok(!stopped.includes('fish-mascot--floating'));assert.ok(stopped.includes('（静态）'))
})
test('the mascot retains the existing work/overtime and stopped-state gates',async()=>{
  for(const state of ['working','overtime','beforeWork','break','finished','rest','incomplete']){
    const snapshot=state==='incomplete'?{...f.snapshots.working,state}:f.snapshots[state]
    const original=JSON.stringify(snapshot)
    for(const allowed of [true,false]){const html=await render(snapshot,allowed);assert.equal(html.includes('fish-mascot--floating'),allowed&&['working','overtime'].includes(state));assert.equal(JSON.stringify(snapshot),original)}
  }
  assert.ok(!(await render({...f.snapshots.working,progress:null})).includes('fish-mascot--floating'))
})
test('low and complete progress keep one fill, one readout and no wave array without mutating data',async()=>{
  for(const percent of [0,1,19.6,27.6,50,78,100]){const snapshot=structuredClone(f.snapshots.working);snapshot.progress.percent=percent;const original=structuredClone(snapshot);const html=await render(snapshot);assert.equal((html.match(/class="fish-fill"/g)||[]).length,1);assert.equal((html.match(/class="(?:[^"]* )?fish-readout(?: [^"]*)?"/g)||[]).length,1);assert.ok(html.includes(`${percent}%`));assert.ok(!html.includes('fish-wave'));assert.deepEqual(snapshot,original)}
  assert.ok(!(await render({...f.snapshots.working,progress:null})).includes('class="fish-readout"'))
})
for(const state of [{visible:true,minimized:false,destroyed:false,expected:true},{visible:false,minimized:false,destroyed:false,expected:false},{visible:true,minimized:true,destroyed:false,expected:false},{visible:true,minimized:false,destroyed:true,expected:false}])test(`native presentation ${JSON.stringify(state)} ignores document visibility`,()=>{
  assert.equal(windowPresentationVisible({isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>state.destroyed}),state.expected)
})
for(const percent of [0,25,50,75,100])test(`Snapshot ${percent}% maps to bounded track travel`,()=>{assert.equal(progressRatio(percent),percent/100);assert.equal(fishPosition(percent,232,32),percent*2);assert.equal(fishPosition(percent,16,32),0);assert.equal(fishPosition(percent,0,32),0)})
for(const value of [null,undefined,NaN,Infinity,'0'])test(`invalid ${String(value)} is not zero progress`,()=>{assert.equal(progressRatio(value),null);assert.equal(fishPosition(value,232,32),null);assert.equal(fishCanAnimate('working',value,true),false)})
test('geometry clamps safely without mutating Snapshot or calculating time',()=>{assert.equal(fishPosition(-1,232,32),0);assert.equal(fishPosition(101,232,32),200);assert.equal(fishPosition(50,Infinity,32),null);assert.equal(fishPosition(50,232,-1),null)})
for(const state of ['beforeWork','break','finished','rest','incomplete',undefined])test(`${state} stays static even with valid progress`,()=>{assert.equal(fishCanAnimate(state,50,true),false)})
for(const state of ['working','overtime'])test(`${state} plays only with visibility and motion enabled`,()=>{assert.equal(fishCanAnimate(state,50,true),true);assert.equal(fishCanAnimate(state,50,false),false)})
test('real net progress, lunch freeze, overtime rollback and end remain domain results',async()=>{
  assert.ok(f.snapshots.rollback.progress.percent<f.snapshots.working.progress.percent)
  assert.ok(fishPosition(f.snapshots.rollback.progress.percent,232,32)<fishPosition(f.snapshots.working.progress.percent,232,32))
  for(const [key,playing]of [['working',true],['overtime',true],['beforeWork',false],['break',false],['finished',false],['rest',false]]){
    const snapshot=f.snapshots[key],original=JSON.stringify(snapshot),html=await render(snapshot)
    assert.equal(html.includes('class="moyu-animated"'),playing);assert.equal(html.includes('aria-label="有效工作进度"'),snapshot.progress!==null);assert.equal(JSON.stringify(snapshot),original)
    if(snapshot.progress)assert.ok(html.includes(snapshot.progress.percent.toFixed(1).replace(/\.0$/,'')+'%'))
  }
  assert.equal(f.snapshots.finished.progress.percent,100);assert.equal(f.snapshots.rest.progress,null)
})
test('null data stays static, missing-calendar progress retains estimate, simplified three cards remain',async()=>{
  const empty=await render(null);assert.ok(!empty.includes('moyu-animated'));assert.ok(!empty.includes('aria-label="有效工作进度"'));assert.ok(empty.includes('无工作进度'))
  const html=await render(f.snapshots.estimate);assert.ok(html.includes('2027'));assert.ok(html.includes('估算'));assert.equal((html.match(/class="we-surface we-metric(?: [^"]*)?"/g)||[]).length,3);assert.ok(!html.includes('累计计划工作日'));assert.ok(!html.includes('dashboard-date'))
})
test('native hidden or reduced-motion gate uses static original canvas',async()=>{const html=await render(f.snapshots.working,false);assert.ok(html.includes('原始蓝色摸鱼猫抱灰鱼（静态）'));assert.ok(!html.includes('moyu-animated'))})
test('D10 theme resolves system OR app reduction for the shared animation gate and releases media listeners',()=>{
  const attrs=new Map(),target={getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)}
  const media=()=>({matches:false,listeners:new Set(),addEventListener(_type,fn){this.listeners.add(fn)},removeEventListener(_type,fn){this.listeners.delete(fn)}}),dark=media(),motion=media(),changes=[]
  const controller=createThemeController(target,{dark,motion},f.config.appearance,value=>changes.push(value)).data
  assert.equal(changes.at(-1).reduceMotion,false);motion.matches=true;for(const fn of motion.listeners)fn();assert.equal(changes.at(-1).reduceMotion,true)
  controller.update({...f.config.appearance,reduceMotion:true});motion.matches=false;for(const fn of motion.listeners)fn();assert.equal(changes.at(-1).reduceMotion,true)
  controller.update({...f.config.appearance,reduceMotion:false});assert.equal(changes.at(-1).reduceMotion,false);controller.dispose();assert.equal(dark.listeners.size+motion.listeners.size,0)
})
function routerFixture(){
  const handlers=new Map(),ports=[],runtime={refresh:{unsubscribe(){},visibilityChanged(){}}}
  const router=createIpcRouter({handle:(key,fn)=>handlers.set(key,fn),removeHandler:key=>handlers.delete(key)},runtime,{window:()=>ok(null),quit:async()=>ok(null)})
  function add(role){const sender={},frame={},pushes=[],port={sender,frame:()=>frame,url:()=>'/trusted',destroyed:()=>false,visible:()=>false,push:(channel,value)=>pushes.push({channel,value:structuredClone(value)})};router.register(role,port,'/trusted');ports.push(port);return{port,event:{sender,senderFrame:frame},pushes,read:(input=null)=>handlers.get(V2_CHANNELS['window.readVisibility'])({sender,senderFrame:frame},input)}}
  return{router,handlers,add}
}
test('visibility read is fixed, own-window-only and still rejects arbitrary IDs, frames and URLs',async()=>{
  const h=routerFixture(),main=h.add('main'),mini=h.add('mini');main.port.visible=()=>true
  assert.equal((await main.read()).data.visible,true);assert.equal((await mini.read()).data.visible,false)
  assert.equal((await main.read({windowId:1})).ok,false)
  const handler=h.handlers.get(V2_CHANNELS['window.readVisibility'])
  for(const event of [{sender:{},senderFrame:main.event.senderFrame},{sender:main.event.sender,senderFrame:{}},mini.event]){const result=await handler(event,event===mini.event?{path:'C:/private'}:null);assert.equal(result.ok,false)}
  main.port.url=()=>'/untrusted';assert.equal((await main.read()).error.code,'FORBIDDEN');h.router.dispose();assert.equal(h.handlers.size,0)
})
test('native visibility events push JSON with monotonic sequence only to registered trusted windows',async()=>{
  const h=routerFixture(),a=h.add('main'),b=h.add('mini');const initial=(await a.read()).data
  a.port.visible=()=>true;h.router.visibilityChanged();assert.deepEqual(a.pushes.at(-1),{channel:WINDOW_VISIBILITY_PUSH,value:ok({visible:true,sequence:initial.sequence+1})})
  a.port.visible=()=>false;h.router.visibilityChanged();assert.equal(a.pushes.at(-1).value.data.visible,false)
  assert.equal(a.pushes.at(-1).value.data.sequence,initial.sequence+2);b.port.url=()=>'/other';const count=b.pushes.length;h.router.visibilityChanged();assert.equal(b.pushes.length,count)
  a.port.destroyed=()=>true;const before=a.pushes.length;h.router.visibilityChanged();assert.equal(a.pushes.length,before);h.router.dispose()
})
for(const role of ['main','mini'])test(`${role} bridge validates, orders and releases its fixed visibility listener`,async()=>{
  let listener,removed=0;const calls=[],seen=[],bridge=createV2Bridge(role,{invoke:async(channel,input)=>{calls.push({channel,input});return ok({visible:true,sequence:1})},listen:(channel,fn)=>{assert.equal(channel,WINDOW_VISIBILITY_PUSH);listener=fn;return()=>{removed++;listener=null}}})
  assert.equal((await bridge.window.subscribeVisibility(value=>seen.push(value))).ok,true);assert.deepEqual(calls,[{channel:V2_CHANNELS['window.readVisibility'],input:null}])
  listener(ok({visible:false,sequence:3}));listener(ok({visible:true,sequence:2}));assert.equal(seen.length,2);assert.equal(seen.at(-1).data.visible,false)
  listener(ok({visible:true,sequence:4,path:'forbidden'}));assert.equal(seen.at(-1).ok,false)
  await bridge.window.unsubscribeVisibility();assert.equal(removed,1);assert.equal(listener,null);assert.equal('invoke'in bridge,false)
})
test('visibility unsubscribe queued during initial read cannot leave a subscription or stale callback',async()=>{
  let resolve,removed=0;const pending=new Promise(done=>{resolve=done}),bridge=createV2Bridge('main',{invoke:()=>pending,listen:()=>()=>{removed++}})
  const subscribe=bridge.window.subscribeVisibility(()=>{}),unsubscribe=bridge.window.unsubscribeVisibility();await Promise.resolve();resolve(ok({visible:false,sequence:1}));await subscribe;await unsubscribe;assert.equal(removed,1)
})
test('failed visibility subscription returns controlled failure and detaches instead of enabling animation',async()=>{
  let removed=0;const bridge=createV2Bridge('main',{invoke:async()=>({ok:false,error:{code:'FORBIDDEN',message:'denied'}}),listen:()=>()=>{removed++}})
  assert.equal((await bridge.window.subscribeVisibility(()=>{})).ok,false);assert.equal(removed,1)
  const bad=createV2Bridge('mini',{invoke:async()=>ok(null),listen(){throw Error('transport')}});assert.equal((await bad.window.subscribeVisibility(()=>{})).ok,false)
  assert.equal(validateContractRequest('mini','window.readVisibility',null).ok,true);assert.equal(validateContractRequest('main','window.readVisibility',{channel:'generic'}).ok,false)
})


test('UI-13 uses two gated water layers, one stable readout and no Hero unit labels',async()=>{
  for(const allowed of [false,true]){
    const html=await render(f.snapshots.working,allowed)
    assert.equal(html.includes('fish-track--flowing'),allowed)
    for(const layer of ['back','front'])assert.equal((html.match(new RegExp('fish-surface--'+layer,'g'))||[]).length,1)
    assert.ok(!html.includes('we-time-label'))
    assert.ok(!html.includes('fish-readout--lifted'))
    assert.ok(html.includes('有效工作进度'))
  }
})


test('UI-14 removes endpoint layout and keeps one accessible progress with a single active capsule',async()=>{
  const html=await render(f.snapshots.working)
  assert.ok(!html.includes('fish-endpoints'))
  assert.equal((html.match(/<progress /g)||[]).length,1)
  assert.equal((html.match(/data-active="true"/g)||[]).length,1)
  assert.ok(html.includes('aria-label="有效工作进度"'))
})
