import type {AppConfig,Result,WindowPresentation} from '../../shared/contracts'
import {success} from '../../shared/validation'
import type {ManagedWindow,WindowManager} from './window-manager'

const unavailable=(message:string):Result<never>=>({ok:false,error:{code:'UNAVAILABLE',message}})
export function createMiniController(options:{
  windows:WindowManager;config():Result<AppConfig>;pending():Promise<Result<boolean>>
  create():Promise<Result<ManagedWindow>>;destroy(window:ManagedWindow):void;exiting():boolean;changed():void
  repair? (window:ManagedWindow):Promise<Result<unknown>>
}) {
  let disposed=false,top=false,savedTop:boolean|undefined,creating:Promise<Result<ManagedWindow>>|null=null,showing:Promise<Result<null>>|null=null
  const active=()=>!disposed&&!options.exiting()
  function preferencesChanged():Result<null>{
    const config=options.config();if(!config.ok)return config
    const pref=config.data.desktop
    const enabled=options.windows.setMiniEnabled(pref.miniEnabled);if(!enabled.ok)return enabled
    if(savedTop!==pref.alwaysOnTop){if(options.windows.getMini()){const changed=options.windows.setMiniTop(pref.alwaysOnTop);if(!changed.ok)return changed}savedTop=pref.alwaysOnTop;top=pref.alwaysOnTop}
    return success(null)
  }
  async function prepare():Promise<Result<ManagedWindow>>{
    if(!active())return unavailable('应用正在退出，不能打开迷你窗。')
    const config=options.config();if(!config.ok)return config
    if(!config.data.desktop.miniEnabled)return unavailable('请在更多设置 → 窗口与托盘启用迷你窗并保存。')
    const configured=preferencesChanged();if(!configured.ok)return configured
    const existing=options.windows.getMini();if(existing)return success(existing)
    if(creating)return creating
    creating=(async()=>{
      const result=await options.create();if(!result.ok)return result
      const latest=options.config()
      if(!active()||!latest.ok||!latest.data.desktop.miniEnabled){options.destroy(result.data);return unavailable('启用状态已变化，未显示迷你窗。')}
      const registered=options.windows.registerMini(result.data)
      if(!registered.ok){options.destroy(result.data);return registered}
      const pin=options.windows.setMiniTop(top);if(!pin.ok){options.destroy(result.data);return pin}
      return result
    })().catch(()=>unavailable('迷你窗创建失败，主窗口与输入保留。')).finally(()=>{creating=null})
    return creating
  }
  async function show():Promise<Result<null>>{
    const navigation=options.windows.navigation()
    const pending=await options.pending();if(!pending.ok)return pending
    if(pending.data)return {ok:false,error:{code:'IO_BUSY',message:'设置正在同步、保存或输入法组合输入，请完成后再切换。'}}
    const prepared=await prepare();if(!prepared.ok){if(active())options.windows.showMain();return prepared}
    const repaired=await options.repair?.(prepared.data);if(repaired&&!repaired.ok){if(active())options.windows.showMain();return repaired}
    const recheck=await options.pending();if(!recheck.ok)return recheck
    const config=options.config()
    if(navigation!==options.windows.navigation())return {ok:false,error:{code:'CANCELLED',message:'已有更新的窗口操作，未覆盖当前显示状态。'}}
    if(!active()||recheck.data||!config.ok||!config.data.desktop.miniEnabled)return unavailable('状态已变化，未切换窗口，输入保留。')
    const result=options.windows.showMini();if(result.ok)options.changed();return result
  }
  return {
    prepare,preferencesChanged,
    show(){if(showing)return showing;showing=show().catch(()=>unavailable('迷你切换失败，主窗口与输入保留。')).finally(()=>{showing=null});return showing},
    hide(){if(!active())return unavailable('应用正在退出。');const result=options.windows.hideMini();options.changed();return result},
    setTop(enabled:boolean){const config=options.config();if(!active()||!config.ok||!config.data.desktop.miniEnabled)return unavailable('迷你功能尚未启用或应用正在退出。');const result=options.windows.setMiniTop(enabled);if(result.ok){top=enabled;options.changed()}return result},
    enabled(){const config=options.config();return active()&&config.ok&&config.data.desktop.miniEnabled},
    visible:()=>!!options.windows.getMini()?.isVisible(),
    presentation():Result<Omit<WindowPresentation,'sequence'>>{const config=options.config();return config.ok?success({appearance:structuredClone(config.data.appearance),miniEnabled:config.data.desktop.miniEnabled,alwaysOnTop:top}):config},
    dispose(){disposed=true}
  }
}
export type MiniController=ReturnType<typeof createMiniController>
