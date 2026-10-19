import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {summarizeResourceLog,verifyMetricCoverage} from '../../scripts/lib/resource-summary.mjs'
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

const covered=log([frame(0,[p('58280/a',0,{createdUtc:'2026-10-19T03:37:44.3753601Z'})],'baseline')])
const metric=(pid=58280,creationTime=1792381064375.36)=>({pid,creationTime,type:'GPU'})
const point=(metrics,at=1792381185369)=>({at,metrics})
test('metric coverage compares native high-precision birth and PID, not PID alone',()=>{
  const result=verifyMetricCoverage(covered,[point([metric()])])
  assert.equal(result.status,'COMPLETE');assert.equal(result.observedIdentities,1)
})
test('GPU 5008 fixture remains incomplete; its CPU/PWS are never invented or zero-filled',()=>{
  const input=[point([metric(),metric(5008,1792381184540.311)])],before=JSON.stringify(input)
  const result=verifyMetricCoverage(covered,input)
  assert.equal(result.status,'INCOMPLETE');assert.deepEqual(result.missing,[{pid:5008,creationTime:1792381184540.311,type:'GPU',reason:'NOT_CAPTURED',firstSeenAt:input[0].at,lastSeenAt:input[0].at}])
  assert.equal(JSON.stringify(input),before)
})
test('a reused numeric PID with a different creation time fails coverage',()=>{
  const result=verifyMetricCoverage(covered,[point([metric(58280,1792381064376.36)])])
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.missing[0].reason,'CREATION_MISMATCH')
})
test('missing metric birth is not treated as a match',()=>{
  const result=verifyMetricCoverage(covered,[point([{pid:58280,type:'GPU'}])])
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.missing[0].reason,'MISSING_CREATION_TIME')
})
test('repeated unresolved identity retains first and last observations without duplicate counting',()=>{
  const result=verifyMetricCoverage(covered,[point([metric(5008,1)],10),point([metric(5008,1)],20)])
  assert.equal(result.observedIdentities,1);assert.equal(result.missing.length,1);assert.equal(result.missing[0].firstSeenAt,10);assert.equal(result.missing[0].lastSeenAt,20)
})
test('empty observations cannot grant complete cross-process coverage',()=>{
  assert.equal(verifyMetricCoverage(covered,[]).status,'INCOMPLETE');assert.equal(verifyMetricCoverage(covered,[point([])]).status,'INCOMPLETE')
})

for(const phase of ['warmup','baseline'])test(`${phase} missing live PWS or unresolved metric cannot be erased by later healthy samples`,()=>{
  const frames=[frame(-1,[p('1/a',0,{pwsBytes:null})],phase,{errors:['unresolved Electron metric identity 5008/birth']}),frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.1)]),frame(2,[p('1/a',.2)])]
  const result=summarizeResourceLog(log(frames))
  assert.equal(result.status,'INCOMPLETE');assert.ok(result.issues.some(issue=>issue.includes('5008')));assert.ok(result.issues.some(issue=>issue.includes('PWS')))
})

test('retained exited identity contributes final CPU with no invented live PWS',()=>{
  const ended=p('2/a',.12,{exited:true,pwsBytes:null})
  const result=summarizeResourceLog(log([frame(0,[p('1/a'),p('2/a')],'baseline'),frame(1,[p('1/a',.04),ended]),frame(2,[p('1/a',.08),ended])]))
  assert.equal(result.status,'COMPLETE');near(result.samples[0].cpuPercent,4);assert.equal(result.samples[0].pwsMiB,1)
})

test('GPU identity match does not excuse missing measured CPU or PWS',()=>{
  const frames=[frame(0,[p('58280/a',0,{createdUtc:'2026-10-19T03:37:44.3753601Z'})],'baseline'),frame(1,[p('58280/a',null,{createdUtc:'2026-10-19T03:37:44.3753601Z',pwsBytes:null})]),frame(2,[p('58280/a',.1,{createdUtc:'2026-10-19T03:37:44.3753601Z'})])]
  const raw=log(frames)
  assert.equal(verifyMetricCoverage(raw,[point([metric()])]).status,'COMPLETE')
  assert.equal(summarizeResourceLog(raw).status,'INCOMPLETE')
})

test('post-provider discovered GPU is covered without duplicate counting and historical missing GPU remains incomplete',()=>{
  const born='2026-10-19T00:00:00.500Z',frames=[frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.04),p('2/gpu',.08,{createdUtc:born})]),frame(2,[p('1/a',.08),p('2/gpu',.12,{createdUtc:born})])]
  const raw=log(frames),result=summarizeResourceLog(raw)
  assert.equal(result.status,'COMPLETE');assert.equal(result.processIdentities,2);assert.equal(result.samples[0].pwsMiB,2)
  assert.equal(verifyMetricCoverage(raw,[point([metric(2,Date.parse(born))])]).status,'COMPLETE')
  assert.equal(verifyMetricCoverage(raw,[point([metric(5008,1792381184540.311)])]).status,'INCOMPLETE')
})

test('sampler native handle matches its own precise CIM identity and rejects wrong birth/path/metric identity',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../../scripts/measure-owned-processes.ps1',import.meta.url),'utf8')
  const native=source.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]+?)\r?\n'@/)[1]
  const script=`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${native}\n'@\n$counter=New-Object OwnedCounter($PID)\ntry{$row=Get-CimInstance Win32_Process -Filter "ProcessId=$PID";$epoch=($counter.Creation-116444736000000000L)/10000.0;if(!$counter.Matches($row.CreationDate,$row.ExecutablePath)){throw 'same process rejected'};if($counter.Matches($row.CreationDate.AddTicks(10),$row.ExecutablePath)){throw 'wrong birth accepted'};if($counter.Matches($row.CreationDate,'other.exe')){throw 'wrong path accepted'};if(!$counter.MatchesMetric($epoch) -or $counter.MatchesMetric($epoch+1)){throw 'metric birth check failed'};if($counter.Cpu -lt 0 -or $counter.Exited){throw 'invalid native state'};[Console]::Write('PASS')}finally{$counter.Dispose()}`
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'PASS')
})

test('recorded Main FILETIME/metric boundary avoids double rounding without increasing one-microsecond limit',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../../scripts/measure-owned-processes.ps1',import.meta.url),'utf8')
  const native=source.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]+?)\r?\n'@/)[1]
  const script=`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${native}\n'@\nif(![OwnedCounter]::MatchesMetricCreation(134368763628899739L,1792402762889.973)){throw 'recorded valid Main rejected'};if([OwnedCounter]::MatchesMetricCreation(134368763628899739L,1792402762889.970)){throw 'outside existing limit accepted'};if([OwnedCounter]::MatchesMetricCreation(134368763628899739L,[double]::NaN)){throw 'NaN accepted'};[Console]::Write('PASS')`
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'PASS')
})
