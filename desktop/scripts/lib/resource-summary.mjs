import assert from 'node:assert/strict'

const mean=values=>values.reduce((a,b)=>a+b,0)/values.length
export function summarizeResourceLog(text){
  const records=[],issues=[]
  for(const [index,line]of text.trim().split(/\r?\n/).entries())try{records.push(JSON.parse(line))}catch{issues.push(`invalid JSON line ${index+1}`)}
  const header=records.find(r=>r.kind==='header'),footer=records.at(-1)
  assert.ok(header&&Number.isInteger(header.logicalCores)&&header.logicalCores>0,'missing valid header')
  let previous=records.find(r=>r.kind==='frame'&&r.phase==='baseline')
  const samples=[],identities=new Set(),events=[]
  for(const frame of records.filter(r=>r.kind==='frame')){
    events.push(...frame.events);for(const p of frame.processes)identities.add(p.key)
    if(frame.phase!=='sample')continue
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
