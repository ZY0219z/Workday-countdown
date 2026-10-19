import {onScopeDispose, toValue, watch, type MaybeRefOrGetter} from 'vue'
import type {DashboardSnapshot, Result, SnapshotApi} from '../../../shared/contracts'

// One Main clock; no renderer interval. Hidden windows release their snapshot
// subscription, keep only the low-frequency native visibility notification.
export function useSnapshotFeed(api:SnapshotApi, visible:MaybeRefOrGetter<boolean>, accept:(result:Result<DashboardSnapshot>)=>void){
  let started=false,disposed=false,version=0,queue:Promise<unknown>=Promise.resolve()
  const listener=(result:Result<DashboardSnapshot>)=>{if(!disposed&&toValue(visible))accept(result)}
  function sync(){
    const current=++version
    queue=queue.then(async()=>{
      if(disposed||current!==version)return
      await api.unsubscribe()
      if(disposed||current!==version||!toValue(visible))return
      const latest=await api.read();if(disposed||current!==version||!toValue(visible))return
      accept(latest);const subscribed=await api.subscribe(listener)
      if(!subscribed.ok&&!disposed&&current===version)accept(subscribed)
      if(disposed||current!==version||!toValue(visible))await api.unsubscribe()
    }).catch(()=>{if(!disposed&&current===version)accept({ok:false,error:{code:'UNAVAILABLE',message:'倒计时数据暂不可用。'}})})
  }
  watch(()=>toValue(visible),()=>{if(started)sync()})
  onScopeDispose(()=>{disposed=true;version++;void queue.finally(()=>api.unsubscribe()).catch(()=>{})})
  return {async start(){if(started||disposed)return;started=true;const result=await api.read();if(!disposed)accept(result);sync()}}
}
