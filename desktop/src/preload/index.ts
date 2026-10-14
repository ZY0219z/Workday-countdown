import { contextBridge, ipcRenderer } from 'electron'
import type { WorkdayApi } from '../shared/settings'
import { createV2Bridge } from '../shared/bridge'

const api: WorkdayApi = {
  loadSettings: () => ipcRenderer.invoke('workday:load-settings'),
  saveSettings: settings => ipcRenderer.invoke('workday:save-settings', settings),
  quit: () => ipcRenderer.invoke('workday:quit')
}

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('workday', Object.freeze(api))
  contextBridge.exposeInMainWorld('workdayV2', createV2Bridge('main', {
    invoke: (channel, input) => ipcRenderer.invoke(channel, input),
    listen(channel, listener) {
      const callback = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on(channel, callback)
      return () => ipcRenderer.removeListener(channel, callback)
    }
  }))
}
