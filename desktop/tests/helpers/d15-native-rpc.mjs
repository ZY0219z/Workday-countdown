// Test-only JSON-lines transport. Each request has an id and a deadline;
// a dead/closing driver never accepts work, including failure diagnostics.
export function createNativeRpc(child,{timeoutMs=5000,readyTimeoutMs=10000,onRecord=()=>{}}={}){
  let phase='starting',failure=null,nextId=0,buffer='',closing,ended=false,endCode=null,endSignal=null
  const pending=new Map()
  let resolveReady,rejectReady
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
  ready.catch(()=>{}) // Still rejects to callers; safe if spawn fails before they await.
  const state=()=>({phase,exitCode:child.exitCode??endCode,signalCode:child.signalCode??endSignal,error:failure?.message??null,pending:pending.size})
  function stop(error){
    if(!failure)failure=error
    if(phase!=='closed')phase='failed'
    clearTimeout(readyTimer);rejectReady(error)
    for(const request of pending.values()){clearTimeout(request.timer);request.reject(error)}
    pending.clear()
    try{onRecord({event:'rpc-stopped',...state()})}catch(error){failure=Error(failure.message+'; RPC journal failed: '+error.message)}
  }
  const readyTimer=setTimeout(()=>stop(Error('Native driver readiness timed out')),readyTimeoutMs)
  function exited(code,signal){
    if(ended)return
    ended=true;endCode=code;endSignal=signal
    const normal=phase==='closing'&&code===0&&!signal
    if(normal){phase='closed';clearTimeout(readyTimer)}
    else stop(Error(`Native driver exited code=${code} signal=${signal}`))
    try{onRecord({event:'driver-exit',code,signal})}catch(error){stop(Error('RPC journal failed: '+error.message))}
  }
  child.on('error',error=>stop(Error('Native driver process error: '+error.message)))
  child.on('exit',exited)
  child.on('close',exited)
  child.stdin?.on('error',error=>stop(Error('Native driver stdin error: '+error.message)))
  child.stdin?.on('close',()=>{if(phase==='ready'||phase==='starting')stop(Error('Native driver stdin closed'))})
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('error',error=>stop(Error('Native driver stdout error: '+error.message)))
  child.stdout?.on('end',()=>{if(phase==='ready'||phase==='starting')stop(Error('Native driver stdout ended'))})
  child.stdout?.on('data',data=>{
    buffer+=data
    let end
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1)
      if(!line||phase==='failed'||phase==='closed')continue
      try{
        const packet=JSON.parse(line)
        if(phase==='starting'&&packet.ready===true){clearTimeout(readyTimer);phase='ready';resolveReady(packet);continue}
        const request=pending.get(packet.id)
        if(!request)throw Error('Unmatched native response id '+packet.id)
        onRecord({event:'rpc-response',id:packet.id,value:packet.value,error:packet.error})
        pending.delete(packet.id);clearTimeout(request.timer)
        packet.error?request.reject(Error(packet.error)):request.resolve(packet.value)
      }catch(error){stop(Error('Native driver protocol error: '+error.message))}
    }
  })
  function request(value){
    if(phase!=='ready'||child.exitCode!==null||child.signalCode!==null||!child.stdin?.writable||child.stdin.destroyed){
      return Promise.reject(failure??Error('Native driver is not available: '+phase))
    }
    const id=++nextId
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>stop(Error('Native RPC timed out id='+id)),timeoutMs)
      pending.set(id,{resolve,reject,timer})
      try{onRecord({event:'rpc-request',id,request:value});child.stdin.write(JSON.stringify({...value,id})+'\n',error=>{if(error)stop(Error('Native driver write failed: '+error.message))})}
      catch(error){stop(Error('Native driver write failed: '+error.message))}
    })
  }
  function close(){
    if(closing)return closing
    closing=(async()=>{
      const priorFailure=failure
      phase='closing';clearTimeout(readyTimer)
      const cancelled=Error('Native RPC cancelled by driver cleanup');rejectReady(cancelled)
      for(const item of pending.values()){clearTimeout(item.timer);item.reject(cancelled)}pending.clear()
      if(!ended&&child.exitCode===null&&child.signalCode===null){
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{unlisten();stop(Error('Native driver cleanup timed out; owned PID '+child.pid));reject(failure)},timeoutMs)
          function unlisten(){child.off('exit',done);child.off('close',done)}
          function done(){clearTimeout(timer);unlisten();resolve()}
          child.once('exit',done);child.once('close',done)
          try{child.stdin.end()}catch(error){clearTimeout(timer);unlisten();reject(error)}
        })
      }
      if(priorFailure||failure)throw priorFailure??failure
      if(state().exitCode!==0||state().signalCode)throw Error(`Native driver cleanup exit code=${state().exitCode} signal=${state().signalCode}`)
      phase='closed';return state()
    })()
    return closing
  }
  if(child.exitCode!==null||child.signalCode!==null)exited(child.exitCode,child.signalCode)
  return {ready,request,close,state}
}

export async function within(label,operation,milliseconds){
  let timer
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),milliseconds)})])}
  finally{clearTimeout(timer)}
}

// Diagnostic failure must not skip the owned application's actual quit step.
// Callers must fail the test if any returned step failed.
export async function collectCleanup(steps,onFailure=()=>{}){
  const errors=[]
  for(const step of steps)try{await within(step.name,step.run,step.milliseconds)}catch(error){
    errors.push({step:step.name,message:String(error)})
    try{onFailure(step.name,error)}catch(loggingError){errors.push({step:step.name+' failure logging',message:String(loggingError)})}
  }
  return errors
}
