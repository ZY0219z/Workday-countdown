import type { AppConfig, DashboardSnapshot, Result } from '../../shared/contracts'
import { success } from '../../shared/validation'
import type { WindowManager } from '../windows/window-manager'

export interface TrayItem { label?:string; enabled?:boolean; type?:'separator'; click?:()=>unknown }
export interface TrayPort {
  isDestroyed():boolean
  on(event:'click'|'right-click',listener:()=>void):unknown
  removeListener(event:'click'|'right-click',listener:()=>void):unknown
  setToolTip(text:string):void
  popUpMenu(items:TrayItem[]):void
  destroy():void
}
export const FIRST_HIDE_MESSAGE='窗口将隐藏到系统托盘。点击任务栏通知区域的图标可以重新打开；如需完全退出，请右键托盘图标选择“退出程序”。'
const unavailable=(message:string):Result<never>=>({ok:false,error:{code:'UNAVAILABLE',message}})
export function trayStatus(snapshot:Result<DashboardSnapshot>):string {
  if(!snapshot.ok)return '倒计时暂不可用'
  const data=snapshot.data,states={beforeWork:'上班前',working:'工作中',break:'午休中',overtime:'加班中',finished:'已下班',rest:'休息日',incomplete:'数据不完整'}
  const label=states[data.state],countdown=data.countdown
  if(data.state==='incomplete')return '数据不完整 · 倒计时暂不可用'
  if(!countdown)return label
  const minutes=Math.ceil(Math.max(0,countdown.seconds)/60),hours=Math.floor(minutes/60),remaining=minutes%60
  return `${label} · 距${countdown.target==='workStart'?'上班':'下班'}约 ${hours?`${hours} 小时 `:''}${remaining} 分${countdown.quality.approximate?'（估算）':''}`
}
export function createTrayController(options:{
  create():TrayPort
  windows:Pick<WindowManager,'showMain'|'hideMain'|'registerTrayRecovery'>
  config():Result<AppConfig>
  snapshot():Promise<Result<DashboardSnapshot>>
  quit():Promise<Result<null>>
  openSettings():Result<null>
  confirmFirstHide(message:string):Promise<Result<boolean>>
  acknowledgeNotice():void
  feedback(message:string):void
  exiting():boolean
}) {
  let native:TrayPort|null=null,releaseRecovery:(()=>void)|null=null,disposed=false,exiting=false,acknowledged=false
  let closing:Promise<Result<null>>|null=null,menu:Promise<Result<null>>|null=null
  let restore:(()=>void)|null=null,generation=0
  let bound:{click:()=>void;right:()=>void}|null=null
  const active=()=>!disposed&&!exiting&&!options.exiting()
  const available=()=>{try{return active()&&native!==null&&restore!==null&&!native.isDestroyed()}catch{return false}}
  const fail=(message:string)=>{try{options.feedback(message)}catch{/* Feedback never hides the window. */}return unavailable(message)}
  function remove(){
    generation++;const old=native,callbacks=bound;native=null;bound=null
    if(old){try{if(callbacks){old.removeListener('click',callbacks.click);old.removeListener('right-click',callbacks.right)}}catch{/* Generation guards invalidate callbacks. */}try{old.destroy()}catch{/* Still revoke recovery. */}}
    const release=releaseRecovery;releaseRecovery=null;try{release?.()}catch{/* Continue idempotent disposal. */}
  }
  function restoreMain():Result<null>{if(!active())return unavailable('应用正在退出，未恢复窗口。');const result=options.windows.showMain();return result.ok?result:fail(result.error.message)}
  async function requestExit():Promise<Result<null>>{
    if(!active())return unavailable('退出已在处理中。')
    exiting=true
    try{return await options.quit()}finally{exiting=false}
  }
  function ensure():Result<null>{
    if(!active())return unavailable('应用正在退出。')
    if(available())return success(null)
    remove()
    try{
      native=options.create();if(native.isDestroyed())throw Error('Empty tray')
      native.setToolTip('Workday Escape · 点击打开，右键查看倒计时')
      const current=native,version=generation
      bound={click:()=>{if(version===generation&&current===native&&available())restoreMain()},right:()=>{if(version===generation&&current===native&&available())void openMenu()}}
      native.on('click',bound.click);native.on('right-click',bound.right)
      const registered=options.windows.registerTrayRecovery({isAvailable:available,registerRestore(callback){restore=callback;return()=>{if(restore===callback)restore=null}}})
      if(!registered.ok)throw Error('Recovery unavailable');releaseRecovery=registered.data
      return success(null)
    }catch{remove();return fail('系统托盘不可用；主窗口不会隐藏，请使用设置中的退出程序。')}
  }
  async function openMenu():Promise<Result<null>>{
    if(menu)return menu
    if(!available()){const checked=ensure();if(!checked.ok)return checked}
    const current=native!,version=generation
    menu=(async()=>{
      let result:Result<DashboardSnapshot>;try{result=await options.snapshot()}catch{result=unavailable('快照不可用')}
      if(!active()||version!==generation||current!==native||!available())return unavailable('托盘已释放，未打开旧菜单。')
      const guarded=(action:()=>unknown)=>()=>{if(active()&&version===generation&&current===native&&available())return action()}
      current.popUpMenu([
        {label:trayStatus(result),enabled:false},
        {label:'打开主窗口',click:guarded(restoreMain)},
        {label:'打开设置',click:guarded(()=>{const shown=restoreMain();if(shown.ok){const opened=options.openSettings();if(!opened.ok)fail(opened.error.message)}})},
        {type:'separator'},
        {label:'退出程序',click:guarded(()=>requestExit().catch(()=>fail('退出调用失败，窗口与草稿保留。')))}
      ])
      return success(null)
    })().catch(()=>{remove();return fail('托盘菜单不可用，已撤销隐藏能力，请返回主窗口。')}).finally(()=>{menu=null})
    return menu
  }
  async function close():Promise<Result<null>>{
    if(!active())return unavailable('退出处理中，窗口与草稿保留。')
    const config=options.config();if(!config.ok)return fail('正式配置不可用，未隐藏窗口；请检查设置或使用退出程序。')
    if(config.data.desktop.closeAction==='quit')return requestExit()
    const ready=ensure();if(!ready.ok)return ready
    if(!acknowledged&&!config.data.desktop.tray.firstHideNoticeAcknowledged){
      const notice=await options.confirmFirstHide(FIRST_HIDE_MESSAGE);if(!notice.ok)return notice;if(!notice.data)return {ok:false,error:{code:'CANCELLED',message:'已取消隐藏，窗口保留。'}}
      acknowledged=true;options.acknowledgeNotice()
    }
    if(!active())return unavailable('退出处理中，未隐藏窗口。')
    const latest=options.config();if(!latest.ok)return fail('配置已不可用，未隐藏窗口。')
    if(latest.data.desktop.closeAction==='quit')return requestExit()
    if(!available())return fail('托盘恢复能力已失效，未隐藏窗口。')
    return options.windows.hideMain()
  }
  return {
    ensure,available,openMenu,restoreMain,requestExit,
    closeMain():Promise<Result<null>>{if(closing)return closing;closing=Promise.resolve().then(close).catch(()=>fail('关闭操作失败，窗口与草稿保留。')).finally(()=>{closing=null});return closing},
    dispose(){if(disposed)return;disposed=true;remove();restore=null}
  }
}
export type TrayController=ReturnType<typeof createTrayController>
