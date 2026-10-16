/// <reference types="electron-vite/node" />
import { Menu, Tray, nativeImage } from 'electron'
import iconPath from './moyu-tray.png?asset'
import type { TrayPort } from './tray-controller'

export function readTrayIcon(){
  const image=nativeImage.createFromPath(iconPath)
  if(image.isEmpty())throw new Error('内置托盘图标不可用。')
  return image
}
export function createNativeTray():TrayPort {
  const tray=new Tray(readTrayIcon())
  return {isDestroyed:()=>tray.isDestroyed(),on:(event,listener)=>event==='click'?tray.on('click',listener):tray.on('right-click',listener),removeListener:(event,listener)=>event==='click'?tray.removeListener('click',listener):tray.removeListener('right-click',listener),
    setToolTip:text=>tray.setToolTip(text),popUpMenu:items=>tray.popUpContextMenu(Menu.buildFromTemplate(items)),destroy:()=>tray.destroy()}
}
