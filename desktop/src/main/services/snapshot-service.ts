import type { AppConfig, DashboardSnapshot, Result } from '../../shared/contracts'
import { success, validateJsonDto } from '../../shared/validation'
import type { Clock, ClockReading } from '../../domain/clock'
import type { DashboardData, DashboardEngine } from '../../domain/dashboard'

export interface SnapshotEngine extends Omit<DashboardEngine,'calculate'> { calculate(now:ClockReading):Result<DashboardData>|Promise<Result<DashboardData>> }
export function createSnapshotService(clock:Clock, factory:(config:AppConfig)=>Result<SnapshotEngine>) {
  let engine:SnapshotEngine|null=null,generation=0,ticket=0,sequence=0,calendarRevision=0,disposed=false,lastInstant:number|null=null
  let cachedKey='',cached:Result<DashboardSnapshot>|null=null,inflight:{key:string;promise:Promise<Result<DashboardSnapshot>>}|null=null,reading:ClockReading|null=null
  const listeners=new Set<(result:Result<DashboardSnapshot>)=>void>()
  const unavailable=():Result<DashboardSnapshot>=>({ok:false,error:{code:'UNAVAILABLE',message:'正式配置尚未初始化或不可用。'}})
  const copy=<T>(value:T):T=>structuredClone(value)
  const emit=(value:Result<DashboardSnapshot>)=>{for(const listener of listeners)try{listener(copy(value))}catch{/* One consumer must not break others. */}}
  return {
    setConfig(config:AppConfig|null,revision:number):Result<null>{
      if(disposed)return {ok:false,error:{code:'UNAVAILABLE',message:'快照服务已退出。'}}
      let next:Result<SnapshotEngine|null>
      try{next=config?factory(copy(config)):success(null)}catch{next={ok:false,error:{code:'INTERNAL',message:'快照配置准备失败。'}}}
      generation++;ticket++;engine=next.ok?next.data:null;calendarRevision=revision;cached=null;cachedKey='';inflight=null;lastInstant=null
      if(!next.ok){engine=null;return next}
      return success(null)
    },
    invalidate(){generation++;ticket++;engine?.invalidate();cached=null;cachedKey='';inflight=null;lastInstant=null},
    async read():Promise<Result<DashboardSnapshot>>{
      if(disposed)return unavailable()
      let now:ReturnType<Clock['read']>
      try{now=clock.read()}catch{now={ok:false,error:{code:'UNAVAILABLE',message:'无法读取系统时钟。'}}}
      if(!now.ok){generation++;ticket++;engine?.invalidate();cached=null;inflight=null;emit(now);return now}
      if(!engine)return unavailable()
      if(lastInstant!==null&&now.data.instant<lastInstant){engine.invalidate();generation++;ticket++;cached=null;inflight=null}
      lastInstant=now.data.instant
      reading=copy(now.data)
      const key=JSON.stringify([generation,now.data]),version=generation,currentEngine=engine
      if(key===cachedKey&&cached)return copy(cached)
      if(inflight?.key===key)return copy(await inflight.promise)
      const current=++ticket
      const promise=(async():Promise<Result<DashboardSnapshot>>=>{
        let result:Result<DashboardData>
        try{result=await currentEngine.calculate(now.data)}catch{result={ok:false,error:{code:'INTERNAL',message:'快照计算失败。'}}}
        if(disposed||version!==generation||current!==ticket)return {ok:false,error:{code:'CANCELLED',message:'快照任务已失效。'}}
        let output:Result<DashboardSnapshot>=result
          .ok?success({...result.data,sequence:sequence+1,calendarRevision}):result
        const dto=validateJsonDto(output)
        if(!dto.ok)output={ok:false,error:{code:'INTERNAL',message:'快照结果不可序列化。'}}
        if(output.ok)sequence++
        cached=copy(output);cachedKey=key;emit(output);return copy(output)
      })()
      inflight={key,promise};try{return await promise}finally{if(inflight?.promise===promise)inflight=null}
    },
    subscribe(listener:(result:Result<DashboardSnapshot>)=>void){listeners.add(listener);let released=false;return()=>{if(!released){released=true;listeners.delete(listener)}}},
    peek:()=>cached?copy(cached):null,
    clockReading:()=>reading?copy(reading):null,
    dispose(){disposed=true;generation++;ticket++;listeners.clear();inflight=null;cached=null;engine=null}
  }
}
export type SnapshotService=ReturnType<typeof createSnapshotService>
