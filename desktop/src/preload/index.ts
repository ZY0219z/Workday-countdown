import { contextBridge, ipcRenderer } from 'electron'
import type { WorkdayApi } from '../shared/settings'

const api: WorkdayApi = {
  loadSettings: () => ipcRenderer.invoke('workday:load-settings'),
  saveSettings: settings => ipcRenderer.invoke('workday:save-settings', settings),
  quit: () => ipcRenderer.invoke('workday:quit')
}

contextBridge.exposeInMainWorld('workday', Object.freeze(api))
