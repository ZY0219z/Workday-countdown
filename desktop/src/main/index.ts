import { app, BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSettings, saveSettings } from './settings-store'

let mainWindow: BrowserWindow | null = null
const rendererFile = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererUrl = devUrl || pathToFileURL(rendererFile).href

function assertSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      event.senderFrame.url !== rendererUrl) {
    throw new Error('不允许的请求来源。')
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 560,
    minWidth: 420,
    minHeight: 500,
    title: 'Workday Escape — V2.0 POC',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  mainWindow.setMenu(null)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(rendererFile)
}

app.whenReady().then(() => {
  // Respect Chromium's profile switch so verification can use disposable data.
  app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') ||
    join(app.getPath('appData'), 'Workday Escape POC'))
  const configPath = join(app.getPath('userData'), 'settings.json')
  ipcMain.handle('workday:load-settings', event => {
    assertSender(event)
    return loadSettings(configPath)
  })
  ipcMain.handle('workday:save-settings', (event, value: unknown) => {
    assertSender(event)
    return saveSettings(configPath, value)
  })
  ipcMain.handle('workday:quit', event => {
    assertSender(event)
    setImmediate(() => app.quit())
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
