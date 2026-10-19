import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {createNativeRpc,collectCleanup} from '../helpers/d15-native-rpc.mjs'
function fixture(options={}){
  const child=new EventEmitter();Object.assign(child,{pid:123,exitCode:null,signalCode:null,stdin:new PassThrough(),stdout:new PassThrough()})
  const writes=[];child.stdin.on('data',data=>writes.push(JSON.parse(data.toString())))
  const exit=(code=0,signal=null)=>{child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);child.emit('close',code,signal)}
  child.stdin.on('finish',()=>exit())
  const client=createNativeRpc(child,{timeoutMs:40,readyTimeoutMs:500,...options})
  child.stdout.write(JSON.stringify({ready:true,identity:{pid:1,createdFileTime:'1'}})+'\n')
  return {child,client,writes,exit,reply:packet=>child.stdout.write(JSON.stringify(packet)+'\n')}
}
test('RPC response ids match callers even when responses arrive in reverse order',async()=>{
  const f=fixture();await f.client.ready
  const one=f.client.request({action:'first'}),two=f.client.request({action:'second'})
  f.reply({id:f.writes[1].id,value:2});f.reply({id:f.writes[0].id,value:1})
  assert.deepEqual(await Promise.all([one,two]),[1,2]);await f.client.close()
})
test('normal close is idempotent; subsequent RPC rejects without writing or queueing',async()=>{
  const f=fixture();await f.client.ready
  const first=f.client.close();assert.equal(f.client.close(),first);await first
  await assert.rejects(f.client.request({action:'late'}),/not available/)
  assert.equal(f.writes.length,0);assert.equal(f.client.state().pending,0);assert.equal(f.client.state().phase,'closed')
})
test('abnormal exit rejects all pending and later RPC with the original exit code',async()=>{
  const f=fixture();await f.client.ready
  const pending=[f.client.request({action:'a'}),f.client.request({action:'b'})];f.exit(77)
  for(const request of pending)await assert.rejects(request,/code=77/)
  await assert.rejects(f.client.request({action:'late'}),/code=77/);assert.equal(f.writes.length,2);assert.equal(f.client.state().pending,0)
  const closing=f.client.close();await assert.rejects(closing,/code=77/);assert.equal(f.client.close(),closing)
})
test('an unsolicited exit 0 is unavailable too, not permission to queue diagnostics',async()=>{
  const f=fixture();await f.client.ready;f.exit(0)
  await assert.rejects(f.client.request({action:'foreground'}),/code=0/);assert.equal(f.client.state().exitCode,0);assert.equal(f.writes.length,0)
  await assert.rejects(f.client.close(),/code=0/)
})
for(const event of ['error','stdin','stdout'])test('transport '+event+' failure ends pending work',async()=>{
  const f=fixture();await f.client.ready;const pending=f.client.request({action:'waiting'})
  const target=event==='error'?f.child:event==='stdin'?f.child.stdin:f.child.stdout
  target.emit('error',Error('fixture failure'));await assert.rejects(pending,/fixture failure/)
  await assert.rejects(f.client.close(),/fixture failure/);assert.equal(f.client.state().pending,0)
})
test('stdout EOF cannot leave pending RPC hanging',async()=>{
  const f=fixture();await f.client.ready;const pending=f.client.request({action:'waiting'})
  f.child.stdout.end();await assert.rejects(pending,/stdout ended/);await assert.rejects(f.client.close(),/stdout ended/)
})
test('unknown response id fails closed instead of assigning a response to the next caller',async()=>{
  const f=fixture();await f.client.ready;const pending=f.client.request({action:'waiting'})
  f.reply({id:999,value:'wrong'});await assert.rejects(pending,/Unmatched/);await assert.rejects(f.client.close(),/Unmatched/)
})
test('RPC deadline rejects pending and future work rather than reusing the FIFO slot',async()=>{
  const f=fixture();await f.client.ready
  await assert.rejects(f.client.request({action:'no response'}),/timed out/)
  await assert.rejects(f.client.request({action:'late'}),/timed out/);assert.equal(f.writes.length,1)
  await assert.rejects(f.client.close(),/timed out/)
})
test('cleanup failure and a stuck diagnostic do not skip later quit or erase failures',async()=>{
  const calls=[]
  const errors=await collectCleanup([
    {name:'dead RPC',milliseconds:40,run:async()=>{calls.push('diagnostic');throw Error('driver exited 77')}},
    {name:'stuck diagnostic',milliseconds:10,run:()=>new Promise(()=>{})},
    {name:'owned quit',milliseconds:40,run:async()=>{calls.push('quit')}}
  ])
  assert.deepEqual(calls,['diagnostic','quit']);assert.equal(errors.length,2);assert.match(errors[1].message,/timed out/)
})
test('a failing diagnostic logger cannot skip the subsequent owned quit step',async()=>{
  let quit=false
  const errors=await collectCleanup([
    {name:'diagnostic',milliseconds:40,run:async()=>{throw Error('driver gone')}},
    {name:'quit',milliseconds:40,run:async()=>{quit=true}}
  ],()=>{throw Error('evidence write failed')})
  assert.equal(quit,true);assert.equal(errors.length,2);assert.match(errors[1].message,/evidence write failed/)
})
test('response journal failure rejects the current RPC instead of dropping its pending slot',async()=>{
  const f=fixture({onRecord:event=>{if(event.event==='rpc-response')throw Error('journal write failed')}});await f.client.ready
  const pending=f.client.request({action:'read'});f.reply({id:f.writes[0].id,value:'data'})
  await assert.rejects(pending,/journal write failed/);assert.equal(f.client.state().pending,0)
  await assert.rejects(f.client.close(),/journal write failed/)
})
