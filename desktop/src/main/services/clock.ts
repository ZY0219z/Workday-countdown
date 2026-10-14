import type { Result, DashboardSnapshot } from '../../shared/contracts'
import type { SnapshotService } from './snapshot-service'
export interface TimerPort { set(callback:()=>void,milliseconds:number):unknown; clear(handle:unknown):void }
export const systemTimers:TimerPort={set:(fn,ms)=>setTimeout(fn,ms),clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)}
export function createRefreshCoordinator(snapshots:SnapshotService,timers:TimerPort=systemTimers) {
  const clients=new Map<object,{visible:()=>boolean;push:(result:Result<DashboardSnapshot>)=>void}>()
  let timer:unknown=null,started=false,disposed=false,running=false,again=false
  const release=snapshots.subscribe(result=>{for(const client of clients.values())try{client.push(structuredClone(result))}catch{/* Isolate destroyed/failed consumers. */}})
  function schedule(){
    if(timer!==null)timers.clear(timer)
    if(!started||disposed){timer=null;return}
    let delay=[...clients.values()].some(client=>{try{return client.visible()}catch{return false}})?1000:60000
    const current=snapshots.peek()
    if(current?.ok){const s=current.data,shift=s.activeShift
      const boundaries=shift?[shift.startsAt,shift.normalEndsAt,shift.finalEndsAt,...shift.breaks.flatMap(b=>[b.startsAt,b.endsAt])]:[]
      for(const at of boundaries)if(at>s.computedAt)delay=Math.min(delay,at-s.computedAt)
      // Short polling around local midnight without guessing a DST endpoint.
      const reading=snapshots.clockReading()
      if(reading)delay=Math.min(delay,Math.max(1,86400000-((reading.time.hour*3600+reading.time.minute*60+reading.time.second)*1000+reading.time.millisecond)))
    }
    timer=timers.set(()=>{timer=null;void refresh()},Math.max(1,delay))
  }
  async function refresh(){if(disposed)return;if(running){again=true;return}running=true
    try{do{again=false;await snapshots.read()}while(again&&!disposed)}finally{running=false;schedule()}}
  return {
    start(){if(!started&&!disposed){started=true;void refresh()}},
    wake(invalidate=false){if(disposed)return;if(invalidate)snapshots.invalidate();if(timer!==null){timers.clear(timer);timer=null}void refresh()},
    visibilityChanged:schedule,
    subscribe(key:object,client:{visible:()=>boolean;push:(result:Result<DashboardSnapshot>)=>void}){if(disposed)return;if(!clients.has(key))clients.set(key,client);schedule();void snapshots.read().then(result=>{if(clients.get(key)===client)client.push(result)}).catch(()=>{})},
    unsubscribe(key:object){clients.delete(key);schedule()},
    dispose(){disposed=true;started=false;release();clients.clear();if(timer!==null)timers.clear(timer);timer=null},
    subscriberCount:()=>clients.size
  }
}
export type RefreshCoordinator=ReturnType<typeof createRefreshCoordinator>
