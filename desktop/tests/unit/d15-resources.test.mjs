import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {summarizeResourceLog,verifyMetricCoverage,inspectSamplingTiming} from '../../scripts/lib/resource-summary.mjs'
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

test('recorded GPU 29156 birth matches only its exact CIM microsecond and path, without widening identity checks',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../../scripts/measure-owned-processes.ps1',import.meta.url),'utf8')
  const native=source.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]+?)\r?\n'@/)[1]
  // Fixed values, no process is launched/opened and no CIM observation is invented.
  // The historical first rejected CIM row was NOT logged; this tests the guard,
  // not a claim that the missing historical row had these values.
  const script=`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\n${native}\n'@\n$counter=[Runtime.Serialization.FormatterServices]::GetUninitializedObject([OwnedCounter]);$counter.Creation=134368790324437009L;$counter.Path='C:\\fixture\\electron.exe';$cim=[DateTime]::FromFileTimeUtc(134368790324437000L);if(!$counter.Matches($cim,$counter.Path) -or !$counter.Matches($cim.ToLocalTime(),$counter.Path)){throw 'exact GPU identity rejected'};foreach($bad in @($cim.AddTicks(10),$cim.AddTicks(-10),[DateTime]::SpecifyKind($cim,[DateTimeKind]::Unspecified))){if($counter.Matches($bad,$counter.Path)){throw 'wrong birth accepted'}};if($counter.Matches($cim,$null) -or $counter.Matches($cim,'other.exe')){throw 'wrong path accepted'};if(!$counter.MatchesMetric(1792405432443.7)){throw 'recorded metric birth rejected'};[Console]::Write('PASS')`
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'PASS')
})

test('rejected identity diagnostics preserve native/CIM raw values, query times and exited state',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../../scripts/measure-owned-processes.ps1',import.meta.url),'utf8')
  const helper=source.match(/function Identity-Diagnostic[\s\S]+?(?=function Discover-Owned)/)[0]
  const script=`$ErrorActionPreference='Stop'\n${helper}\n$row=[pscustomobject]@{ProcessId=29156;ParentProcessId=9824;CreationDate=[DateTime]::FromFileTimeUtc(134368790324437000L);ExecutablePath=$null};$counter=[pscustomobject]@{Creation=134368790324437009L;Path='fixture.exe';Cpu=0.5625;Exited=$true;ExitCode=0};Identity-Diagnostic $row $counter 'new' 1000 1001|ConvertTo-Json -Depth 8 -Compress`
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000})
  assert.equal(result.status,0,result.stderr)
  const packet=JSON.parse(result.stdout)
  assert.equal(packet.pid,29156);assert.equal(packet.parentPid,9824)
  assert.equal(packet.queryStartedAt,1000);assert.equal(packet.queryCompletedAt,1001)
  assert.equal(packet.native.createdFileTime,'134368790324437009');assert.equal(packet.native.exited,true);assert.equal(packet.native.exitCode,0)
  assert.equal(packet.cim.path,null);assert.equal(packet.cim.creation.fileTime,'134368790324437000');assert.equal(packet.cim.creation.kind,'Utc')
})

test('identity diagnostic metadata cannot repair a known failed sample or substitute PWS',()=>{
  const frames=[frame(0,[p('1/a')],'baseline'),frame(1,[p('1/a',.1)],'sample',{errors:['cannot capture owned PID 29156: native/CIM identity mismatch']}),frame(2,[p('1/a',.2)])]
  const raw=log(frames)+'\n'+JSON.stringify({kind:'identity-check',pid:29156,native:{cpuSeconds:.5625,pwsBytes:0}})+'\n'+JSON.stringify({kind:'footer',complete:true})
  const result=summarizeResourceLog(raw)
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.validSamples,1);assert.equal(result.processIdentities,1)
})

const frequency='10000000',filetime=utc=>String(BigInt(Date.parse(utc))*10000n+116444736000000000n)
const stamp=seconds=>({utc:new Date(Date.UTC(2026,9,20)+seconds*1000).toISOString().replace(/(\.\d{3})Z$/,'$10000Z'),ticks:String(Math.round(seconds*1e7))})
function timingFixture(birth=1){
  const created=stamp(birth).utc,key=`2/${filetime(created)}`
  const cim={pid:2,parentPid:1,name:'electron.exe',path:'fixture.exe',creationDate:created,creationUtc:created,creationFileTime:filetime(created)}
  const capture={event:'identity-capture',queryId:1,key,started:stamp(2.3),completed:stamp(2.6),cim,
    native:{createdFileTime:filetime(created),path:'fixture.exe',opened:stamp(2.4),firstCpu:stamp(2.5),cpuSeconds:0,exited:false},matched:true}
  const header={kind:'header',logicalCores:4,warmupSeconds:30,sampleSeconds:2,timingDiagnostics:{version:1,frequency}}
  const records=[header]
  for(let i=0;i<3;i++){
    const start=2+i*2,phase=i?'sample':'baseline'
    const events=[{event:'cim-query',queryId:i*3+1,stage:'pre-pws',started:stamp(start+.1),completed:stamp(start+.2),owned:[cim],error:null},
      ...(i?[]:[capture]),
      {event:'pws-query',queryId:i*3+2,attempt:0,started:stamp(start+.7),completed:stamp(start+.8),results:[{key,pid:2,status:'VALID',pwsBytes:1048576}],error:null},
      {event:'cim-query',queryId:i*3+3,stage:'post-pws',started:stamp(start+.9),completed:stamp(start+1),owned:[cim],error:null}]
    records.push({...frame(i,[p(key,i*.04,{createdUtc:created})],phase),frameId:i+1,utc:stamp(start+1.05).utc},
      {kind:'sampling-timing',frameId:i+1,phase,started:stamp(start),completed:stamp(start+1.1),writeStarted:stamp(start+1.2),aborted:false,events})
  }
  records.push({kind:'footer',complete:true});return records
}
const asJsonl=records=>records.map(r=>JSON.stringify(r)).join('\n')
const timingGroups=records=>records.filter(r=>r.kind==='sampling-timing')

for(const [name,birth,expected]of [['before CIM',1,'BEFORE_QUERY'],['during CIM',2.15,'DURING_QUERY']])test(`GPU born ${name} retains the actual query bounds and unrounded identity`,()=>{
  const raw=asJsonl(timingFixture(birth)),result=inspectSamplingTiming(raw)
  assert.equal(result.status,'COMPLETE',JSON.stringify(result.issues));assert.equal(result.queries[0].births[0].position,expected)
  assert.equal(result.identities[0].capture.cim.creationUtc,stamp(birth).utc)
})
test('GPU born between adjacent CIM queries is not described as present in the earlier snapshot',()=>{
  const records=timingFixture(2.05),first=timingGroups(records)[0]
  const prior={kind:'sampling-timing',frameId:0,phase:'startup',started:stamp(0),completed:stamp(2),writeStarted:stamp(2),aborted:false,
    events:[{event:'cim-query',queryId:10,stage:'startup-root',started:stamp(0),completed:stamp(2),owned:[],error:null}]}
  records.splice(1,0,prior)
  const result=inspectSamplingTiming(asJsonl(records))
  assert.equal(result.status,'COMPLETE',JSON.stringify(result.issues))
  assert.ok(BigInt(prior.completed.ticks)<BigInt(first.events[0].started.ticks)) // Also retain the exact UTC bounds for analysis.
  assert.equal(result.queries[0].owned.length,0);assert.equal(result.queries[1].births[0].position,'BEFORE_QUERY')
})
for(const [name,exitTime,pwsStatus,exitedAtCapture]of [
  ['before native identity read',2.35,'NO_ROW',true],['after native identity read / before PWS',2.65,'NO_ROW',false],
  ['during PWS query',2.75,'NO_ROW',false],['after a valid PWS query',2.85,'VALID',false]
])test(`GPU exits ${name}: diagnostic query history never becomes current exited PWS`,()=>{
  const records=timingFixture(),group=timingGroups(records)[0],key=group.events[1].key
  group.events[1].native.exited=exitedAtCapture
  group.events[2].results[0]={key,pid:2,status:pwsStatus,pwsBytes:pwsStatus==='VALID'?1048576:null}
  group.events.push({event:'exit-observed',key,observed:stamp(3),kernelExitFileTime:filetime(stamp(exitTime).utc),cpuSeconds:.04,exitCode:0})
  for(const r of records.filter(r=>r.kind==='frame'))Object.assign(r.processes[0],{exited:true,exitCode:0,pwsBytes:null,cpuSeconds:.04})
  const result=inspectSamplingTiming(asJsonl(records))
  assert.equal(result.status,'COMPLETE',JSON.stringify(result.issues));assert.equal(result.identities[0].exit.observed.utc,stamp(3).utc)
  assert.equal(result.identities[0].exit.kernelExitFileTime,filetime(stamp(exitTime).utc))
  assert.equal(result.identities[0].pwsQueries[0].results[0].pwsBytes,pwsStatus==='VALID'?1048576:null)
  const resource=summarizeResourceLog(asJsonl(records));assert.equal(resource.pws.maxMiB,0) // Exited identities excluded, never a measured zero.
})
for(const [name,change]of [
  ['missing UTC',r=>{delete timingGroups(r)[0].events[0].started.utc}],
  ['missing native ticks',r=>{delete timingGroups(r)[0].events[1].native.opened.ticks}],
  ['reversed query',r=>{timingGroups(r)[0].events[0].completed=stamp(1)}],
  ['missing frame diagnostics',r=>{r.splice(r.findIndex(r=>r.frameId===2&&r.kind==='sampling-timing'),1)}],
  ['missing first identity',r=>{timingGroups(r)[0].events.splice(1,1)}],
  ['missing PWS evidence',r=>{timingGroups(r)[0].events.splice(2,1)}],
  ['failed query',r=>{timingGroups(r)[0].events[2].error='fixture provider failure'}],
  ['unknown frequency',r=>{r[0].timingDiagnostics.frequency='0'}],
  ['missing query association',r=>{timingGroups(r)[0].events[1].queryId=100}],
  ['missing session footer',r=>{r.pop()}],
  ['invalid retry count',r=>{r.find(r=>r.kind==='frame').pwsRetries=1}],
  ['invalid PWS marked valid',r=>{timingGroups(r)[0].events[2].results[0].pwsBytes=null}],
  ['aborted capture',r=>{timingGroups(r)[0].aborted=true}]
])test(`${name} cannot claim complete diagnostic evidence`,()=>{
  const records=timingFixture();change(records);assert.equal(inspectSamplingTiming(asJsonl(records)).status,'INCOMPLETE')
})
test('diagnostic events do not change CPU/PWS aggregation or repair late discovery',()=>{
  const records=timingFixture(),raw=asJsonl(records),old=asJsonl(records.filter(r=>r.kind!=='sampling-timing'))
  assert.deepEqual(summarizeResourceLog(raw),summarizeResourceLog(old));assert.equal(summarizeResourceLog(raw).status,'COMPLETE')
  records.find(r=>r.kind==='frame'&&r.phase==='sample').processes.push(p('9/old',.1))
  assert.equal(summarizeResourceLog(asJsonl(records)).status,'INCOMPLETE')
  assert.equal(inspectSamplingTiming(old).status,'INCOMPLETE')
  assert.equal(inspectSamplingTiming(log([frame(0,[p('1/a')],'baseline')])).status,'NOT_AVAILABLE')
})

function runPs(script){
  // Stream this fixed fixture instead of exceeding Windows' command-line limit.
  // No script files, execution-policy changes or GUI permission are needed.
  const runner='[Console]::InputEncoding=New-Object Text.UTF8Encoding($false); . ([scriptblock]::Create([Console]::In.ReadToEnd()))'
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(runner,'utf16le').toString('base64')],{input:"$ErrorActionPreference='Stop'\n"+script,encoding:'utf8',windowsHide:true,timeout:15000})
  assert.ifError(r.error);assert.equal(r.status,0,r.stderr);return r.stdout.trim()
}
const samplerSource=()=>readFileSync(new URL('../../scripts/measure-owned-processes.ps1',import.meta.url),'utf8')
test('actual CIM query wrapper records both boundaries and query sequence, without adding queries',{skip:process.platform!=='win32'},()=>{
  const functions=samplerSource().match(/function Timing-Stamp[\s\S]+?(?=\$root=Query-Processes)/)[0]
  const data=JSON.parse(runPs(`$originTicks=[Diagnostics.Stopwatch]::GetTimestamp();$queryId=0;$timingEvents=New-Object Collections.Generic.List[object];$calls=0\n${functions}\nfunction Get-CimInstance {param($class,$Filter,$Property);$script:calls++;[pscustomobject]@{ProcessId=2;ParentProcessId=1;Name='fixture';CreationDate=[DateTime]::SpecifyKind([DateTime]'2026-10-20',[DateTimeKind]::Utc);ExecutablePath='fixture.exe'}}\n$rows=@(Query-Processes 'fixture' 'pre-pws' @('ProcessId'));$lastCimQuery.owned=@(Cim-Identity $rows[0]);$null=Query-Processes 'fixture' 'post-pws';@{calls=$calls;events=@($timingEvents.ToArray())}|ConvertTo-Json -Depth 10 -Compress`))
  assert.equal(data.calls,2);assert.deepEqual(data.events.map(e=>e.queryId),[1,2]);assert.equal(data.events[0].owned[0].pid,2)
  for(const e of data.events){assert.match(e.started.utc,/\.\d{7}Z$/);assert.ok(BigInt(e.completed.ticks)>=BigInt(e.started.ticks));assert.equal(e.error,null)}
})
for(const scenario of ['valid','no-row','invalid','invalid-string','exit-during-pws','query-error'])test(`actual Capture diagnostic path: ${scenario}, bounded retries and exited PWS isolation`,{skip:process.platform!=='win32'},()=>{
  const source=samplerSource(),helpers=source.match(/function Native-Stamp[\s\S]+?(?=function Read-MetricHints)/)[0],capture=source.match(/function Capture[\s\S]+?(?=function Wait-Until)/)[0]
  const result=JSON.parse(runPs(`
$originTicks=[Diagnostics.Stopwatch]::GetTimestamp();$watch=[Diagnostics.Stopwatch]::StartNew();$frameId=0;$queryId=0;$RootProcessId=1;$metricHints=@{};$packets=New-Object Collections.Generic.List[object];$timingEvents=New-Object Collections.Generic.List[object];$calls=0
function Timing-Stamp {return @{utc=[DateTime]::UtcNow.ToString('o');ticks=([Diagnostics.Stopwatch]::GetTimestamp()-$originTicks).ToString()}}
function Emit($record){$packets.Add($record)}
${helpers}
$counter=[pscustomobject]@{Cpu=0.5;Exited=$false;ExitCode=0;ExitObservedUtc=$null;ExitObservedTicks=0L;KernelExitFileTime=0L}
$counter|Add-Member ScriptMethod Read {if($script:scenario -eq 'exit-during-pws' -and $script:calls -gt 0){$this.Exited=$true;$this.ExitObservedUtc=[DateTime]::UtcNow.ToString('o');$this.ExitObservedTicks=[Diagnostics.Stopwatch]::GetTimestamp()}}
$counter|Add-Member ScriptMethod Dispose {}
$records=@{'1/root'=@{key='1/root';pid=1;parentPid=0;name='fixture';imagePath='fixture.exe';createdFileTime='1';createdUtc=[DateTime]::UtcNow;counter=$counter;cpuSeconds=0.5;exited=$false;exitedUtc=$null}}
function Discover-Owned($events,$errors,$stage){}
function Get-CimInstance {param($ClassName,$Filter,$Property);$script:calls++;switch($scenario){'valid'{[pscustomobject]@{IDProcess=1;WorkingSetPrivate=4096}}'invalid'{[pscustomobject]@{IDProcess=1;WorkingSetPrivate=-1}}'invalid-string'{[pscustomobject]@{IDProcess=1;WorkingSetPrivate='not-a-number'}}'query-error'{throw 'fixture provider failure'}}}
function Start-Sleep {param($Milliseconds)}
$scenario='${scenario}'
${capture}
try{Capture 'sample'}catch{if($scenario -notin @('query-error','invalid-string','exit-during-pws')){throw}}
@{calls=$calls;packets=@($packets.ToArray())}|ConvertTo-Json -Depth 14 -Compress`))
  assert.equal(result.calls,['no-row','invalid'].includes(scenario)?4:1)
  const trace=result.packets.find(p=>p.kind==='sampling-timing'),queries=trace.events.filter(e=>e.event==='pws-query')
  assert.equal(trace.events.filter(e=>e.event==='pws-retry').length,scenario==='exit-during-pws'?1:result.calls-1)
  for(const [i,q]of queries.entries()){
    assert.equal(q.attempt,i);assert.ok(BigInt(q.completed.ticks)>=BigInt(q.started.ticks));assert.equal(q.results[0].status,{valid:'VALID','no-row':'NO_ROW',invalid:'INVALID_VALUE','invalid-string':'INVALID_VALUE','exit-during-pws':'NO_ROW','query-error':'QUERY_ERROR'}[scenario])
  }
  const frame=result.packets.find(p=>p.kind==='frame')
  if(scenario==='valid')assert.equal(frame.processes[0].pwsBytes,4096)
  if(['no-row','invalid'].includes(scenario)){assert.equal(frame.processes[0].pwsBytes,null);assert.ok(frame.errors.length)}
  if(scenario==='exit-during-pws'){assert.equal(frame.processes[0].pwsBytes,null);assert.equal(trace.events.filter(e=>e.event==='exit-observed').length,1)}
  if(scenario==='query-error'){assert.equal(trace.aborted,true);assert.equal(frame,undefined);assert.match(queries[0].error,/fixture provider failure/)}
  if(scenario==='invalid-string'){assert.equal(trace.aborted,true);assert.equal(frame,undefined);assert.equal(queries[0].error,null)} // Query returned a row, then the original numeric conversion failed.
})

for(const scenario of ['already-exited','open-failed'])test(`actual first identity capture: ${scenario} retains boundaries without inventing native evidence`,{skip:process.platform!=='win32'},()=>{
  const source=samplerSource(),clock=source.match(/function Timing-Stamp[\s\S]+?(?=\$root=Query-Processes)/)[0],helpers=source.match(/function Native-Stamp[\s\S]+?(?=function Read-MetricHints)/)[0],discover=source.match(/function Discover-Owned[\s\S]+?(?=function Capture)/)[0]
  const result=JSON.parse(runPs(`
$originTicks=[Diagnostics.Stopwatch]::GetTimestamp();$queryId=0;$timingEvents=New-Object Collections.Generic.List[object];$events=New-Object Collections.Generic.List[object];$errors=New-Object Collections.Generic.List[string];$metricHints=@{};$RootProcessId=1;$ElectronProcessId=2;$rootBirthUtc=[DateTime]::SpecifyKind([DateTime]'2026-10-20',[DateTimeKind]::Utc)
${clock}
${helpers}
function Read-MetricHints {}
function Emit($record){}
$rootCounter=[pscustomobject]@{};$rootCounter|Add-Member ScriptMethod Matches {return $true}
$records=@{'1/root'=@{key='1/root';pid=1;exited=$false;createdUtc=$rootBirthUtc;counter=$rootCounter}}
function Get-CimInstance {param($ClassName,$Filter,$Property);foreach($id in 1,2){[pscustomobject]@{ProcessId=$id;ParentProcessId=if($id -eq 1){0}else{1};CreationDate=$rootBirthUtc;Name='fixture';ExecutablePath='fixture.exe'}}}
function New-Object {param($TypeName,$ArgumentList);if($TypeName -ne 'OwnedCounter'){return Microsoft.PowerShell.Utility\\New-Object $TypeName $ArgumentList};if('${scenario}' -eq 'open-failed'){throw 'fixture handle unavailable'};$now=[DateTime]::UtcNow;$ticks=[Diagnostics.Stopwatch]::GetTimestamp();$c=[pscustomobject]@{Creation=$rootBirthUtc.ToFileTimeUtc();Path='fixture.exe';Cpu=0.125;Exited=$true;ExitCode=0;OpenedUtc=$now.ToString('o');OpenedTicks=$ticks;FirstCpuUtc=$now.ToString('o');FirstCpuTicks=$ticks;ExitObservedUtc=$now.ToString('o');ExitObservedTicks=$ticks;KernelExitFileTime=0L};$c|Add-Member ScriptMethod Matches {return $true};$c|Add-Member ScriptMethod Dispose {};return $c}
${discover}
Discover-Owned $events $errors 'pre-pws'
@{timing=@($timingEvents.ToArray());errors=@($errors.ToArray());events=@($events.ToArray())}|ConvertTo-Json -Depth 14 -Compress`))
  assert.equal(result.timing[0].event,'cim-query');assert.equal(result.timing[0].owned.length,2)
  if(scenario==='already-exited'){
    const identity=result.timing.find(e=>e.event==='identity-capture'),exit=result.timing.find(e=>e.event==='exit-observed')
    assert.equal(identity.native.exited,true);assert.equal(identity.matched,true);assert.match(identity.native.createdFileTime,/^\d+$/)
    assert.ok(BigInt(identity.native.opened.ticks)>=BigInt(identity.started.ticks));assert.ok(BigInt(identity.completed.ticks)>=BigInt(identity.native.firstCpu.ticks))
    assert.equal(exit.cpuSeconds,.125);assert.equal(exit.exitCode,0);assert.equal(exit.kernelExitFileTime,null);assert.deepEqual(result.errors,[])
  }else{
    assert.equal(result.timing.filter(e=>e.event==='identity-capture').length,0)
    assert.equal(result.timing.filter(e=>e.event==='capture-error').length,1);assert.equal(result.errors.length,1)
    assert.match(result.timing[1].error,/fixture handle unavailable/)
  }
})

test('100ns UTC/tick ordering is preserved; wall-clock regression cannot establish a complete chronology',()=>{
  const records=timingFixture(),query=timingGroups(records)[0].events[0]
  query.started={utc:'2026-10-20T00:00:02.1000001Z',ticks:'21000001'}
  query.completed={utc:'2026-10-20T00:00:02.1000002Z',ticks:'21000002'}
  assert.equal(inspectSamplingTiming(asJsonl(records)).status,'COMPLETE')
  query.completed.utc='2026-10-20T00:00:02.1000000Z'
  assert.equal(inspectSamplingTiming(asJsonl(records)).status,'INCOMPLETE')
})

test('combined sampler functions emit diagnostics accepted by the offline inspector using fixed owned processes only',{skip:process.platform!=='win32'},()=>{
  const source=samplerSource(),clock=source.match(/function Timing-Stamp[\s\S]+?(?=\$root=Query-Processes)/)[0],helpers=source.match(/function Native-Stamp[\s\S]+?(?=function Read-MetricHints)/)[0],functions=source.match(/function Discover-Owned[\s\S]+?(?=function Wait-Until)/)[0]
  const result=JSON.parse(runPs(`
$originTicks=[Diagnostics.Stopwatch]::GetTimestamp();$watch=[Diagnostics.Stopwatch]::StartNew();$frameId=0;$queryId=0;$timingEvents=New-Object Collections.Generic.List[object];$packets=New-Object Collections.Generic.List[object];$records=@{};$metricHints=@{};$RootProcessId=1;$ElectronProcessId=2;$rootBirthUtc=[DateTime]::SpecifyKind([DateTime]'2026-10-20',[DateTimeKind]::Utc)
${clock}
${helpers}
function Emit($record){$packets.Add($record)}
function Read-MetricHints {}
function Get-CimInstance {param($ClassName,$Filter,$Property);if($ClassName -eq 'Win32_PerfFormattedData_PerfProc_Process'){foreach($id in 1,2){[pscustomobject]@{IDProcess=$id;WorkingSetPrivate=4096}}}else{foreach($id in 1,2){[pscustomobject]@{ProcessId=$id;ParentProcessId=if($id -eq 1){0}else{1};CreationDate=$rootBirthUtc;Name='fixture';ExecutablePath='fixture.exe'}}}}
function New-Object {param($TypeName,$ArgumentList);if($TypeName -ne 'OwnedCounter'){return Microsoft.PowerShell.Utility\\New-Object $TypeName $ArgumentList};$now=[DateTime]::UtcNow;$ticks=[Diagnostics.Stopwatch]::GetTimestamp();$c=[pscustomobject]@{Creation=$rootBirthUtc.ToFileTimeUtc();Path='fixture.exe';Cpu=0.125;Exited=$false;ExitCode=0;OpenedUtc=$now.ToString('o');OpenedTicks=$ticks;FirstCpuUtc=$now.ToString('o');FirstCpuTicks=$ticks};$c|Add-Member ScriptMethod Matches {return $true};$c|Add-Member ScriptMethod Read {};$c|Add-Member ScriptMethod Dispose {};return $c}
${functions}
Capture 'baseline'
Capture 'sample'
@{packets=@($packets.ToArray())}|ConvertTo-Json -Depth 14 -Compress`))
  const records=[{kind:'header',timingDiagnostics:{version:1,frequency}},...result.packets,{kind:'footer',complete:true}]
  const report=inspectSamplingTiming(asJsonl(records))
  assert.equal(report.status,'COMPLETE',JSON.stringify(report.issues));assert.equal(report.identities.length,2);assert.equal(report.queries.length,6)
  assert.equal(report.identities.filter(i=>i.capture.cim.parentPid===1).length,1)
})
