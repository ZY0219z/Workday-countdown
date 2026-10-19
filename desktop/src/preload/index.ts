import { contextBridge, ipcRenderer } from 'electron'
import { createV2Bridge } from '../shared/bridge'
import { preloadRole } from '../shared/preload-role'

if (process.isMainFrame) {
  const role=preloadRole(process.argv)
  const transport={
    invoke: (channel, input) => ipcRenderer.invoke(channel, input),
    listen(channel:string, listener:(payload:unknown)=>void) {
      const callback = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(channel, callback)
      return () => ipcRenderer.removeListener(channel, callback)
    }
  } satisfies import('../shared/bridge').BridgeTransport
  if(role)contextBridge.exposeInMainWorld('workdayV2',role==='main'?createV2Bridge('main',transport):createV2Bridge('mini',transport))
}
