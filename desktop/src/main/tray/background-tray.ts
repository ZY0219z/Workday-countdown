import type { TrayItem,TrayPort } from './tray-controller'
// Main-only adapter selected exclusively by validated, unpackaged background
// test profiles. Never touches the real Windows notification area.
export function createBackgroundTray():TrayPort & {emit(event:'click'|'right-click'):void;items():TrayItem[]} {
  let destroyed=false,menu:TrayItem[]=[]
  const listeners=new Map<string,Set<()=>void>>()
  return {isDestroyed:()=>destroyed,on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn)},removeListener(event,fn){listeners.get(event)?.delete(fn)},
    setToolTip(){},popUpMenu(items){if(destroyed)throw Error('Tray destroyed');menu=items},destroy(){destroyed=true;listeners.clear();menu=[]},
    emit(event){if(!destroyed)for(const fn of listeners.get(event)??[])fn()},items:()=>menu}
}
