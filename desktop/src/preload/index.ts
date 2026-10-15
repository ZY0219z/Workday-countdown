import { contextBridge, ipcRenderer } from 'electron'
import { createV2Bridge } from '../shared/bridge'

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('workdayV2', createV2Bridge('main', {
    invoke: (channel, input) => ipcRenderer.invoke(channel, input),
    listen(channel, listener) {
      const callback = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(channel, callback)
      return () => ipcRenderer.removeListener(channel, callback)
    }
  }))
}
