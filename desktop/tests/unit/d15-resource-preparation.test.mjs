import {test} from 'node:test'
import assert from 'node:assert/strict'
import {prepareResourceMain,resourceModeIssues,classifyResourceInput,newResourceRunDirectories} from '../helpers/d15-resource-preparation.mjs'

test('blocked preflight never claims any historical resource directory',()=>{
  assert.deepEqual(newResourceRunDirectories([],['historical-main'],false),[])
})

test('launched resource run can only select directories absent from its initial snapshot',()=>{
  assert.deepEqual(newResourceRunDirectories(['historical-main'],['historical-main','new-mini'],true),['new-mini'])
})

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(){
  const close=deferred(),events=[]
  const port={closeMain:()=>close.promise,confirmHide:async()=>events.push('invoke-return'),assertTrayOnly:async()=>events.push('tray-only'),showMain:async()=>{events.push('restored');return {ok:true}},assertMain:async()=>events.push('main-visible'),record:event=>events.push(event)}
  return {close,events,port}
}
test('restore waits for the full close promise, not dialog Invoke or a transient hidden observation',async()=>{
  const {close,events,port}=fixture(),prepared=prepareResourceMain(port)
  await tick();assert.deepEqual(events,['close-request','invoke-return','hide-confirmation-invoked'])
  close.resolve({ok:true});await prepared
  assert.deepEqual(events.slice(3),['close-complete','tray-only','show-main-request','restored','show-main-return','main-visible'])
})
for(const failure of ['rejected','failed-result'])test('close '+failure+' never restores or starts sampling',async()=>{
  const {close,events,port}=fixture(),prepared=prepareResourceMain(port)
  await tick()
  if(failure==='rejected')close.reject(Error('close rejected'));else close.resolve({ok:false,error:{code:'UNAVAILABLE'}})
  await assert.rejects(prepared,/close/);assert.ok(!events.includes('restored'));assert.ok(!events.includes('main-visible'))
})
test('failed restore is reported instead of accepting the earlier tray-only state',async()=>{
  const {close,events,port}=fixture();port.showMain=async()=>({ok:false,error:{code:'UNAVAILABLE'}})
  const prepared=prepareResourceMain(port);close.resolve({ok:true});await assert.rejects(prepared,/restore failed/)
  assert.ok(!events.includes('main-visible'))
})
const window=(id,visible=true,minimized=false)=>({id,visible,minimized})
const point=windows=>({windows,trayAvailable:true,subscribers:1})
test('mode validation accepts only the expected real Main, Mini or tray-only state',()=>{
  assert.deepEqual(resourceModeIssues(point([window(1),window(2,false)]),'main',1),[])
  assert.deepEqual(resourceModeIssues(point([window(1,false),window(2)]),'mini',2),[])
  assert.deepEqual(resourceModeIssues({...point([window(1,false),window(2,false)]),subscribers:0},'tray'),[])
})
for(const [name,windows]of [['hidden',[window(1,false)]],['minimized',[window(1,true,true)]],['wrong-window',[window(2)]],['two-visible',[window(1),window(2)]]])test('ongoing collection rejects '+name+' rather than relabeling Main as Tray',()=>{
  assert.ok(resourceModeIssues(point(windows),'main',1).includes('resource mode visibility changed'))
})
test('missing tray, expected identity or accumulated subscriptions cannot pass',()=>{
  assert.ok(resourceModeIssues({...point([window(1)]),trayAvailable:false},'main',1).length)
  assert.ok(resourceModeIssues(point([window(1)]),'main').length)
  assert.ok(resourceModeIssues({...point([window(1)]),subscribers:2},'main',1).length)
})

test('tray-only rejects a minimized window even when no window is visible',()=>{
  assert.ok(resourceModeIssues({...point([window(1,false,true),window(2,false)]),subscribers:0},'tray').includes('unexpected minimized window'))
})

test('tray-only requires all Snapshot subscriptions to be released',()=>{
  assert.ok(resourceModeIssues(point([window(1,false),window(2,false)]),'tray').includes('tray-only retained Snapshot subscription'))
})

const foreground=(pid,tick=100,at=1000,name='fixture')=>({lastInputTick:tick,at,foreground:{pid,name}})
test('existing ChatGPT/QQ foreground with unchanged input is not a Main visibility failure',()=>{
  const result=classifyResourceInput(foreground(28324),foreground(28324))
  assert.equal(result.changed,false);assert.deepEqual(result.stopReasons,[]);assert.deepEqual(result.uncertainReasons,[])
})
test('recorded isolated input tick change is a note, not unconditional interference',()=>{
  const result=classifyResourceInput(foreground(47896,93516109,1792465248397),foreground(47896,93501500,1792465247010))
  assert.equal(result.changed,true);assert.deepEqual(result.stopReasons,[]);assert.deepEqual(result.uncertainReasons,[])
})
test('native foreground transitions without input remain diagnostic for Main resource sampling',()=>{
  assert.deepEqual(classifyResourceInput(foreground(28324),foreground(13400)).stopReasons,[])
})
test('Main acquiring foreground from the initial app without input is allowed',()=>{
  assert.deepEqual(classifyResourceInput(foreground(13400),foreground(28324)).stopReasons,[])
})
test('sustained unresolved activity is inconclusive, not silently healthy or attributed to a user',()=>{
  let previous=foreground(1),activity;let result
  for(const [tick,at]of [[101,1000],[102,2200],[103,3400]]){const current=foreground(2,tick,at);result=classifyResourceInput(current,previous,activity);previous=current;activity=result.activity}
  assert.deepEqual(result.stopReasons,[]);assert.equal(result.uncertainReasons.length,1)
})
test('stable observations reset the activity streak between isolated input changes',()=>{
  let previous=foreground(1),activity;let result
  for(const [tick,at]of [[101,1000],[101,2200],[102,3400],[102,4600],[103,5800]]){const current=foreground(1,tick,at);result=classifyResourceInput(current,previous,activity);previous=current;activity=result.activity}
  assert.deepEqual(result.uncertainReasons,[])
})
test('loss of the usable test desktop still requests safe interruption without input',()=>{
  for(const name of ['LogonUI','LockApp'])assert.deepEqual(classifyResourceInput(foreground(1,100,1000,name),foreground(1)).stopReasons,['test desktop unavailable'])
})
