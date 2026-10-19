import {test} from 'node:test'
import assert from 'node:assert/strict'
import {summarizeResourceLog} from '../../scripts/lib/resource-summary.mjs'
const p=(key,cpuSeconds=0,extra={})=>({key,pid:Number(key.split('/')[0]),createdUtc:'2026-10-19T00:00:00.000Z',cpuSeconds,pwsBytes:1048576,exited:false,exitCode:extra.exited?0:null,...extra})
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`)
const frame=(second,processes,phase='sample',extra={})=>({kind:'frame',phase,utc:new Date(Date.UTC(2026,9,19,0,0,second)).toISOString(),elapsedSeconds:second,processes,events:[],errors:[],...extra})
const log=(frames,footer={kind:'footer',complete:true},sampleSeconds=2)=>[JSON.stringify({kind:'header',logicalCores:4,warmupSeconds:30,sampleSeconds,scope:'fixture',completeness:'polling',environment:{}}),...frames.map(JSON.stringify),JSON.stringify(footer)].join('\n')
test('CPU uses machine-normalized cumulative deltas, interval weights, P95 and total Private Working Set',()=>{
  const result=summarizeResourceLog(log([frame(0,[p('1/a'),p('2/a')],'baseline'),frame(1,[p('1/a',.04),p('2/a',.04)]),frame(3,[p('1/a',.08),p('2/a',.08)])]))
  assert.equal(result.status,'COMPLETE');near(result.meanCpuPercent,.16/12*100);near(result.p95CpuPercent,2);assert.equal(result.pws.meanMiB,2)
})
test('new PID CPU is counted from birth; final exited process CPU is retained and PWS excluded',()=>{
  const fresh={createdUtc:'2026-10-19T00:00:00.500Z'}
  const result=summarizeResourceLog(log([frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.04),p('2/a',.08,fresh)]),frame(2,[p('1/a',.08),p('2/a',.12,{...fresh,exited:true,pwsBytes:0})])]))
  assert.equal(result.status,'COMPLETE');near(result.samples[0].cpuPercent,3);near(result.samples[1].cpuPercent,2);assert.equal(result.samples[1].pwsMiB,1)
})
test('PID reuse is a new creation identity, never negative CPU or double counting',()=>{
  const old=p('2/a',2,{exited:true,pwsBytes:0}),fresh=p('2/b',.08,{createdUtc:'2026-10-19T00:00:00.500Z'})
  const result=summarizeResourceLog(log([frame(0,[old],'baseline'),frame(1,[old,fresh]),frame(2,[old,{...fresh,cpuSeconds:.12}])]))
  assert.equal(result.processIdentities,2);assert.equal(result.status,'COMPLETE');assert.equal(result.samples[0].cpuPercent,2)
})
for(const [name,change]of [
  ['missing PWS',s=>{s[1].processes[0].pwsBytes=null}],['missing prior CPU',s=>{s[0].processes[0].cpuSeconds=null}],['counter regression',s=>{s[2].processes[0].cpuSeconds=-1}],
  ['duplicate identity',s=>{s[1].processes.push(s[1].processes[0])}],['lost final process counter',s=>{s[1].processes=[]}],
  ['late discovery',s=>{s[2].processes.push(p('9/a'))}],['nonmonotonic wall interval',s=>{s[2].elapsedSeconds=1}]
])test(`${name} reports incomplete rather than substituting zero or claiming a valid sample`,()=>{
  const frames=[frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.1)]),frame(2,[p('1/a',.2)])];change(frames);assert.equal(summarizeResourceLog(log(frames)).status,'INCOMPLETE')
})
test('interrupted or truncated JSONL preserves partial evidence and cannot pass completeness',()=>{
  const text=log([frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.1)])],{kind:'footer',complete:false})
  assert.equal(summarizeResourceLog(text).status,'INCOMPLETE');assert.equal(summarizeResourceLog(text+'\n{"kind":').status,'INCOMPLETE')
})
test('a nonzero child exit cannot silently become a healthy resource baseline',()=>{
  const result=summarizeResourceLog(log([frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.1,{exited:true,pwsBytes:0,exitCode:0x80000003})]),frame(2,[p('1/a',.1,{exited:true,pwsBytes:0,exitCode:0x80000003})])]))
  assert.equal(result.status,'INCOMPLETE');assert.ok(result.issues.some(issue=>issue.includes('exit code')))
})
