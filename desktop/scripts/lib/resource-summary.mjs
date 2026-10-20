import assert from 'node:assert/strict'

const mean=values=>values.reduce((a,b)=>a+b,0)/values.length
// Diagnostic inspection is separate from resource aggregation. No timestamp can
// repair a late-discovery interval or supply historical/current PWS.
function utcTicks(utc){
  const m=typeof utc==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{7})Z$/.exec(utc)
  if(!m||!Number.isFinite(Date.parse(m[1]+'Z'))||new Date(m[1]+'Z').toISOString().slice(0,19)!==m[1])throw Error('missing/invalid precise UTC')
  return BigInt(Date.parse(m[1]+'Z'))*10000n+BigInt(m[2])
}
export function inspectSamplingTiming(text){
  const issues=[],identities=[],queries=[],captures=new Map(),exits=new Map(),groups=new Map(),queryIds=new Set()
  let records=[]
  try{records=text.trim().split(/\r?\n/).map(line=>JSON.parse(line))}catch{issues.push('invalid JSONL')}
  const spec=records.find(r=>r.kind==='header')?.timingDiagnostics
  if(!spec)return {status:issues.length?'INCOMPLETE':'NOT_AVAILABLE',issues,identities,queries}
  if(records.at(-1)?.kind!=='footer'||!records.at(-1).complete)issues.push('missing complete diagnostic session footer')
  if(spec.version!==1||!/^\d+$/.test(spec.frequency)||BigInt(spec.frequency)<=0n)issues.push('invalid diagnostic clock/version')
  const stamp=value=>{
    const utc=utcTicks(value?.utc)
    if(typeof value?.ticks!=='string'||!/^\d+$/.test(value.ticks))throw Error('missing/invalid monotonic ticks')
    return {utc,ticks:BigInt(value.ticks)}
  }
  const interval=(start,end)=>{
    const a=stamp(start),b=stamp(end)
    if(a.ticks>b.ticks||a.utc>b.utc)throw Error('reversed diagnostic interval or wall clock discontinuity')
    return [a,b]
  }
  for(const group of records.filter(r=>r.kind==='sampling-timing'))try{
    if(!Number.isInteger(group.frameId)||group.frameId<0||groups.has(group.frameId)||!Array.isArray(group.events)||group.aborted)throw Error('missing/duplicate/aborted frame diagnostics')
    interval(group.started,group.completed);interval(group.completed,group.writeStarted);groups.set(group.frameId,group)
    for(const event of group.events){
      if(['cim-query','pws-query','pws-retry','identity-capture','capture-error'].includes(event.event)){
        const [a,b]=interval(event.started,event.completed)
        if(a.ticks<stamp(group.started).ticks||b.ticks>stamp(group.completed).ticks)throw Error('event outside diagnostic frame')
      }
      if(['cim-query','pws-query'].includes(event.event)){
        if(!Number.isInteger(event.queryId)||event.queryId<1||queryIds.has(event.queryId))throw Error('invalid/duplicate query ID')
        queryIds.add(event.queryId);queries.push({...event,frameId:group.frameId})
        if(event.error)issues.push(`query ${event.queryId} failed`)
      }
      if(event.event==='cim-query')for(const row of event.owned){
        const birth=utcTicks(row.creationUtc),start=utcTicks(event.started.utc),end=utcTicks(event.completed.utc)
        if(birth>end)throw Error('CIM birth after query completion or wall clock discontinuity')
        queries.at(-1).births??=[]
        queries.at(-1).births.push({pid:row.pid,position:birth<start?'BEFORE_QUERY':birth<=end?'DURING_QUERY':'AFTER_QUERY'})
      }
      if(event.event==='pws-query')for(const result of event.results){
        if(!Number.isInteger(event.attempt)||event.attempt<0||event.attempt>3)throw Error('invalid PWS attempt')
        if(!['VALID','NO_ROW','INVALID_VALUE','QUERY_ERROR'].includes(result.status)||result.status==='VALID'&&(!Number.isFinite(result.pwsBytes)||result.pwsBytes<0))throw Error('invalid PWS diagnostic result')
        if(result.status!=='VALID'&&result.pwsBytes!==null)throw Error('nonmeasurement must retain null PWS')
      }
      if(event.event==='identity-capture'){
        interval(event.started,event.native.opened);interval(event.native.opened,event.native.firstCpu);interval(event.native.firstCpu,event.completed)
        if(!event.matched||event.key!==`${event.cim.pid}/${event.native.createdFileTime}`||BigInt(event.cim.creationFileTime)/10n!==BigInt(event.native.createdFileTime)/10n||typeof event.cim.path!=='string'||event.cim.path.toLowerCase()!==event.native.path?.toLowerCase())throw Error('unverified diagnostic identity')
        if(captures.has(event.key))throw Error('duplicate first identity capture')
        captures.set(event.key,event)
      }
      if(event.event==='exit-observed'){
        interval(group.started,event.observed);interval(event.observed,group.completed)
        if(exits.has(event.key)||!Number.isFinite(event.cpuSeconds)||!Number.isInteger(event.exitCode))throw Error('invalid/duplicate exit observation')
        if(event.kernelExitFileTime!==null&&!(typeof event.kernelExitFileTime==='string'&&/^\d+$/.test(event.kernelExitFileTime)&&BigInt(event.kernelExitFileTime)>0n))throw Error('invalid kernel exit FILETIME')
        exits.set(event.key,event)
      }
      if(event.event==='cpu-read-error'){stamp(event.observed);issues.push(`native CPU read failed for ${event.key}`)}
      if(event.event==='capture-error')issues.push(`native capture failed for ${event.pid}`)
    }
  }catch(error){issues.push(`frame ${group.frameId}: ${error.message}`)}
  for(const frame of records.filter(r=>r.kind==='frame')){
    const group=groups.get(frame.frameId)
    if(!group||group.phase!==frame.phase||!group.events.some(e=>e.event==='cim-query'&&e.stage==='pre-pws')||!group.events.some(e=>e.event==='cim-query'&&e.stage==='post-pws'))issues.push(`missing query diagnostics for frame ${frame.frameId}`)
    const retries=group?.events.filter(e=>e.event==='pws-retry')??[]
    if(retries.length!==(frame.pwsRetries??0)||retries.some((e,i)=>e.attempt!==i+1))issues.push(`missing/invalid retry diagnostics for frame ${frame.frameId}`)
    for(const process of frame.processes){
      if(!captures.has(process.key))issues.push(`missing first capture ${process.key}`)
      if(process.exited&&!exits.has(process.key))issues.push(`missing exit observation ${process.key}`)
      if(!process.exited&&!group?.events.some(e=>e.event==='pws-query'&&e.results?.some(r=>r.key===process.key)))issues.push(`missing PWS diagnostic ${process.key}`)
    }
  }
  for(const [key,capture]of captures)try{
    const query=queries.find(q=>q.queryId===capture.queryId&&q.event==='cim-query'&&q.owned.some(p=>p.pid===capture.cim.pid&&p.creationFileTime===capture.cim.creationFileTime))
    if(!query)throw Error('missing successful CIM association')
    interval(query.completed,capture.started)
    const exit=exits.get(key)
    if(exit)interval(capture.native.firstCpu,exit.observed)
    identities.push({key,queryId:query.queryId,capture,exit:exit??null,pwsQueries:queries.filter(q=>q.event==='pws-query'&&q.results.some(r=>r.key===key)),
      note:'PWS query bounds and first exit observation are not an exact provider measurement/exit time; kernelExitFileTime may be unavailable'})
  }catch(error){issues.push(`${key}: ${error.message}`)}
  if(!groups.size||!records.some(r=>r.kind==='frame'))issues.push('no complete diagnostic frames')
  return {status:issues.length?'INCOMPLETE':'COMPLETE',issues,identities,queries}
}
// Preserve sub-millisecond creation times (Date.parse alone truncates them).
function creationEpoch(utc){
  if(typeof utc!=='string')return NaN
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,7})Z$/.exec(utc)
  return match?Date.parse(match[1]+'Z')+Number('0.'+match[2])*1000:NaN
}
export function verifyMetricCoverage(text,observations){
  const native=[],missing=new Map(),observed=new Set(),issues=[]
  for(const line of text.trim().split(/\r?\n/)){
    const record=JSON.parse(line)
    if(record.kind==='frame')for(const process of record.processes)native.push(process)
  }
  for(const point of observations)for(const metric of point.metrics){
    const key=metric.pid+'/'+metric.creationTime;observed.add(key)
    const candidates=native.filter(process=>process.pid===metric.pid)
    // Electron's epoch double and Windows' 100ns FileTime round differently.
    // One microsecond allows floating-point rounding, not a PID-reuse window.
    const matched=Number.isFinite(metric.creationTime)&&candidates.some(process=>Math.abs(creationEpoch(process.createdUtc)-metric.creationTime)<=.001)
    if(matched)continue
    const reason=!Number.isFinite(metric.creationTime)?'MISSING_CREATION_TIME':candidates.length?'CREATION_MISMATCH':'NOT_CAPTURED'
    const prior=missing.get(key)
    missing.set(key,{pid:metric.pid,creationTime:metric.creationTime??null,type:metric.type,reason,firstSeenAt:prior?.firstSeenAt??point.at,lastSeenAt:point.at})
  }
  if(!observations.length||observations.some(point=>!point.metrics.length))issues.push('missing app metric observations')
  return {status:missing.size||issues.length?'INCOMPLETE':'COMPLETE',observedIdentities:observed.size,missing:[...missing.values()],issues,
    scope:'PID + creation-time cross-check only; polling cannot prove absence of other unobserved short-lived children'}
}
export function summarizeResourceLog(text){
  const records=[],issues=[]
  for(const [index,line]of text.trim().split(/\r?\n/).entries())try{records.push(JSON.parse(line))}catch{issues.push(`invalid JSON line ${index+1}`)}
  const header=records.find(r=>r.kind==='header'),footer=records.at(-1)
  assert.ok(header&&Number.isInteger(header.logicalCores)&&header.logicalCores>0,'missing valid header')
  let previous=records.find(r=>r.kind==='frame'&&r.phase==='baseline')
  const samples=[],identities=new Set(),events=[]
  for(const frame of records.filter(r=>r.kind==='frame')){
    events.push(...frame.events);for(const p of frame.processes)identities.add(p.key)
    // A failed discovery/PWS read during warmup must not disappear merely
    // because the final sampling counters happened to look healthy.
    if(frame.phase!=='sample'){
      issues.push(...frame.errors)
      for(const p of frame.processes){
        if(!Number.isFinite(p.cpuSeconds)||p.cpuSeconds<0)issues.push(`missing warmup/baseline CPU ${p.key}`)
        if(p.exited&&p.exitCode!==0)issues.push(`nonzero or unknown exit code ${p.key}: ${p.exitCode}`)
        if(!p.exited&&(!Number.isFinite(p.pwsBytes)||p.pwsBytes<0))issues.push(`missing warmup/baseline PWS ${p.key}`)
      }
      continue
    }
    if(!previous){issues.push('sample without baseline');continue}
    const seconds=frame.elapsedSeconds-previous.elapsedSeconds,prior=new Map(previous.processes.map(p=>[p.key,p])),seen=new Set()
    let cpuSeconds=0,pwsBytes=0,valid=true
    const incomplete=reason=>{issues.push(reason);valid=false}
    if(!(seconds>0))incomplete('nonmonotonic sample clock')
    for(const p of frame.processes){
      if(seen.has(p.key))incomplete(`duplicate identity ${p.key}`);seen.add(p.key)
      if(!Number.isFinite(p.cpuSeconds)||p.cpuSeconds<0){incomplete(`missing CPU ${p.key}`);continue}
      if(p.exited&&p.exitCode!==0)incomplete(`nonzero or unknown exit code ${p.key}: ${p.exitCode}`)
      const before=prior.get(p.key)
      if(before&&(!Number.isFinite(before.cpuSeconds)||before.cpuSeconds<0))incomplete(`missing prior CPU ${p.key}`)
      if(!before&&Date.parse(p.createdUtc)<Date.parse(previous.utc))incomplete(`late discovery ${p.key}`)
      const delta=p.cpuSeconds-(before?before.cpuSeconds:0)
      if(!Number.isFinite(delta)||delta<0)incomplete(`CPU counter regressed ${p.key}`)
      else cpuSeconds+=delta // A new process born in this interval contributes all of its CPU.
      if(!p.exited){if(!Number.isFinite(p.pwsBytes)||p.pwsBytes<0)incomplete(`missing PWS ${p.key}`);else pwsBytes+=p.pwsBytes}
    }
    for(const key of prior.keys())if(!seen.has(key))incomplete(`lost final process counter ${key}`)
    if(frame.errors.length){issues.push(...frame.errors);valid=false}
    samples.push({elapsedSeconds:frame.elapsedSeconds,intervalSeconds:seconds,valid,cpuPercent:valid?cpuSeconds/(seconds*header.logicalCores)*100:null,pwsMiB:valid?pwsBytes/1048576:null})
    previous=frame
  }
  if(footer?.kind!=='footer'||!footer.complete)issues.push('session interrupted or missing completion footer')
  if(samples.length!==header.sampleSeconds)issues.push('planned sample count not reached')
  const duration=samples.reduce((n,s)=>n+s.intervalSeconds,0)
  if(duration<header.sampleSeconds)issues.push('sampling span shorter than planned duration')
  const valid=samples.filter(s=>s.valid),cpu=valid.map(s=>s.cpuPercent).sort((a,b)=>a-b),pws=valid.map(s=>s.pwsMiB),first=pws.slice(0,30),last=pws.slice(-30)
  return {status:issues.length?'INCOMPLETE':'COMPLETE',scope:header.scope,logicalCores:header.logicalCores,warmupSeconds:header.warmupSeconds,sampleSeconds:duration,sampleCount:samples.length,validSamples:valid.length,processIdentities:identities.size,events,issues,
    meanCpuPercent:valid.length?valid.reduce((n,s)=>n+s.cpuPercent*s.intervalSeconds,0)/valid.reduce((n,s)=>n+s.intervalSeconds,0):null,p95CpuPercent:cpu.length?cpu[Math.ceil(cpu.length*.95)-1]:null,
    pws: pws.length?{minMiB:Math.min(...pws),meanMiB:mean(pws),maxMiB:Math.max(...pws),first30MeanMiB:mean(first),last30MeanMiB:mean(last),changePercent:mean(first)?(mean(last)/mean(first)-1)*100:null}:null,
    completeness:header.completeness,environment:header.environment,samples}
}
