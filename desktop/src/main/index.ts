import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import type { IpcMainInvokeEvent, Event } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadSettings, saveSettings } from './settings-store'
import { APPLICATION_ID, APPLICATION_NAME, resolveApplicationPaths } from './app-identity'
import { acquireSingleInstance } from './single-instance'
import { createWindowManager } from './windows/window-manager'
import type { WindowManager } from './windows/window-manager'
import { restoreWindowBounds, applyRestoredBounds } from './windows/window-bounds'
import { createOperationBarrier } from './lifecycle/operation-barrier'
import { createQuitCoordinator } from './lifecycle/quit-coordinator'
import type { ExitChoice } from './lifecycle/quit-coordinator'
import { createPocDraftAdapter } from './lifecycle/poc-draft'
import { backgroundTestEnabled, blockInteractiveWindowOperations } from './lifecycle/background-testing'
import { DEFAULT_SETTINGS } from '../shared/settings'
import type { WorkSettings } from '../shared/settings'
import { success } from '../shared/validation'

const rendererFile = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererUrl = devUrl || pathToFileURL(rendererFile).href
// Packaged EXEs NEVER accept test profile overrides, injected exit choices or
// background window substitutes, regardless of environment/command-line input.
const testMode = !app.isPackaged && process.env.WORKDAY_ESCAPE_TEST_MODE === '1'
const paths = resolveApplicationPaths({ appData: app.getPath('appData'), temp: app.getPath('temp'), testMode,
  testProfile: process.env.WORKDAY_ESCAPE_TEST_PROFILE || app.commandLine.getSwitchValue('user-data-dir') || null })
// Normal startup ignores arbitrary profile argv. Test override needs explicit
// environment opt-in AND a disposable directory owned by our test scripts.
app.commandLine.removeSwitch('user-data-dir')
if (!paths.ok) throw new Error(paths.error.message)
const background = backgroundTestEnabled(!app.isPackaged, paths.data.testProfile, process.env.WORKDAY_ESCAPE_TEST_BACKGROUND)
const startupError = (message: string) => { if (background) console.error(message); else dialog.showErrorBox(APPLICATION_NAME, message) }
mkdirSync(paths.data.sessionData, { recursive: true })
app.setName(APPLICATION_NAME)
app.setPath('userData', paths.data.userData)
app.setPath('sessionData', paths.data.sessionData)
if (process.platform === 'win32') app.setAppUserModelId(APPLICATION_ID)

let windows: WindowManager | undefined
const instance = acquireSingleInstance(app, () => { windows?.showMain() })
if (!instance.ok) { startupError(instance.error.message); app.quit() }
else if (instance.data.primary) {
  app.whenReady().then(() => {
    // POC compatibility: the old two-field handlers NEVER write the formal
    // userData/settings.json. D07 runtime configuration remains unattached.
    const configPath = paths.data.pocSettings
    let applied: WorkSettings = { ...DEFAULT_SETTINGS }
    const writes = createOperationBarrier()
    let exitChoiceForTest: ExitChoice | null = null
    let feedbackOpen = false
    let interactiveAttempts: string[] = []
    const main = () => windows?.getMain() as BrowserWindow | null
    const quit = createQuitCoordinator({ waitMilliseconds: 3000, confirmationMilliseconds: 120000,
      waitForWrites: writes.drain, restoreMain: () => { windows?.showMain() },
      commitQuit() {
        writes.seal(); windows!.beginQuit(); instance.data.beginQuit()
        setImmediate(() => app.quit()) // Permit the existing IPC reply to settle.
        return success(null)
      }
    })
    const requestQuit = async (feedback: boolean) => {
      const result = await quit.requestQuit()
      if (!background && !result.ok && feedback && result.error.code !== 'CANCELLED' && !feedbackOpen) {
        const window = main()
        if (window && !window.isDestroyed()) {
          feedbackOpen = true
          try { await dialog.showMessageBox(window, { type: 'warning', title: APPLICATION_NAME, message: result.error.message, buttons: ['返回编辑'] }) }
          finally { feedbackOpen = false }
        }
      }
      return result
    }
    const areas = () => screen.getAllDisplays().map(display => ({ id: display.id, workArea: display.workArea, scaleFactor: display.scaleFactor }))
    const defaults = { x: screen.getPrimaryDisplay().workArea.x, y: screen.getPrimaryDisplay().workArea.y, width: 600, height: 560 }
    const minimum = { width: 420, height: 500 }
    const bounds = (saved: unknown) => {
      const result = restoreWindowBounds(saved, areas(), screen.getPrimaryDisplay().id, defaults, minimum)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
    windows = createWindowManager(() => {
      const initial = bounds(null)
      const window = new BrowserWindow({ ...initial.bounds, minWidth: initial.minimum.width, minHeight: initial.minimum.height,
        title: 'Workday Escape — V2.0 POC', show: false, focusable: !background, autoHideMenuBar: true,
        webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
      })
      if (background) interactiveAttempts = blockInteractiveWindowOperations(window)
      window.setMenu(null)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      window.webContents.session.setPermissionCheckHandler(() => false)
      window.webContents.on('will-prevent-unload', event => { if (quit.isAuthorized()) event.preventDefault() })
      window.once('ready-to-show', () => { if (!quit.isAuthorized()) { if (!background) { windows!.showMain(); void repairBounds() }; instance.data.markReady() } })
      // No tray in D08: native close still requests real exit, never orphaned hide.
      window.on('close', event => { if (!quit.isAuthorized()) { event.preventDefault(); void requestQuit(true) } })
      const loaded = devUrl ? window.loadURL(devUrl) : window.loadFile(rendererFile)
      void loaded.catch(() => { if (!quit.isAuthorized() && !window.isDestroyed()) { startupError('页面加载失败，应用将退出；配置未被更改。'); app.exit(1) } })
      return window
    })
    function assertSender(event: IpcMainInvokeEvent): void {
      const window = main()
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('不允许的请求来源。')
    }
    const savePoc = (value: unknown) => writes.run(async () => {
      try { applied = saveSettings(configPath, value); return success(null) }
      catch { return { ok: false as const, error: { code: 'UNAVAILABLE' as const, message: '无法保存时间，请检查POC配置目录权限或占用后重试。' } } }
    })
    const readForm = async (): Promise<unknown> => {
      const window = main()
      if (!window || window.isDestroyed() || window.webContents.isLoading()) return null
      return window.webContents.executeJavaScript(`(() => {
        const fields = document.querySelectorAll('input[type="time"]');
        const button = document.querySelector('button[type="submit"]');
        if (fields.length !== 2 || !button) return null;
        return { workStartTime: fields[0].value, workEndTime: fields[1].value, busy: button.disabled };
      })()`)
    }
    quit.registerDraft(createPocDraftAdapter({ readForm, saved: () => applied, save: savePoc,
      async confirm() {
        if (paths.data.testProfile && exitChoiceForTest !== null) return success(exitChoiceForTest)
        if (background) return { ok: false, error: { code: 'UNAVAILABLE', message: '后台测试未注入确认适配器，不打开原生提示或丢弃草稿。' } }
        const window = main()
        if (!window) return { ok: false, error: { code: 'UNAVAILABLE', message: '没有可操作窗口，退出未获许可。' } }
        // Minimal POC safety feedback only; the actual three-choice UI and
        // authoritative V2 draft session remain D09/D11. Injected adapters
        // exercise save/discard/continue without developing that UI early.
        await dialog.showMessageBox(window, { type: 'warning', title: APPLICATION_NAME,
          message: '时间尚未保存，退出已取消。请先保存更改，或恢复原时间后退出。', buttons: ['返回编辑'], defaultId: 0, cancelId: 0 })
        return success('continueEditing')
      },
      async discardForm() {
        const window = main()
        if (!window) return { ok: false, error: { code: 'UNAVAILABLE', message: '无法恢复表单，退出未获许可。' } }
        await window.webContents.executeJavaScript(`(() => {
          const fields = document.querySelectorAll('input[type="time"]');
          const values = ${JSON.stringify([applied.workStartTime, applied.workEndTime])};
          fields.forEach((field, index) => { field.value = values[index]; field.dispatchEvent(new Event('input', { bubbles: true })); });
        })()`)
        return success(null)
      }
    }))
    ipcMain.handle('workday:load-settings', event => { assertSender(event); const loaded = loadSettings(configPath); applied = loaded.settings; return loaded })
    ipcMain.handle('workday:save-settings', async (event, value: unknown) => { assertSender(event); const result = await savePoc(value); if (!result.ok) throw new Error(result.error.message); return applied })
    ipcMain.handle('workday:quit', async event => { assertSender(event); const result = await requestQuit(false); if (!result.ok) throw new Error(result.error.message) })
    let repairing: Promise<unknown> | null = null
    let boundsTimer: ReturnType<typeof setTimeout> | null = null
    const repairBounds = (): Promise<unknown> => {
      if (repairing) return repairing
      repairing = (async () => {
        const window = main()
        if (!window || quit.isAuthorized()) return
        const restored = bounds(window.isMinimized() || window.isMaximized() ? window.getNormalBounds() : window.getBounds())
        const appliedBounds = await applyRestoredBounds(window, restored)
        if (!appliedBounds.ok) windows!.showMain()
        return appliedBounds
      })().catch(() => { windows!.showMain(); return { ok: false, error: { code: 'UNAVAILABLE', message: '显示器位置恢复失败，主窗口保留。' } } }).finally(() => { repairing = null })
      return repairing
    }
    const displayChanged = () => { if (background) return; if (boundsTimer) clearTimeout(boundsTimer); boundsTimer = setTimeout(() => { boundsTimer = null; void repairBounds() }, 100) }
    screen.on('display-removed', displayChanged)
    screen.on('display-metrics-changed', displayChanged)
    screen.on('display-added', displayChanged)
    const activated = () => { if (!background && !quit.isAuthorized()) windows!.showMain() }
    const beforeQuit = (event: Event) => { if (!quit.isAuthorized()) { event.preventDefault(); void requestQuit(true) } }
    const allClosed = () => { if (!quit.isAuthorized()) windows!.showMain() }
    app.on('activate', activated); app.on('before-quit', beforeQuit); app.on('window-all-closed', allClosed)
    app.once('will-quit', () => {
      for (const method of ['workday:load-settings', 'workday:save-settings', 'workday:quit']) ipcMain.removeHandler(method)
      if (boundsTimer) clearTimeout(boundsTimer)
      screen.removeListener('display-removed', displayChanged); screen.removeListener('display-metrics-changed', displayChanged); screen.removeListener('display-added', displayChanged)
      app.removeListener('activate', activated); app.removeListener('before-quit', beforeQuit); app.removeListener('window-all-closed', allClosed)
      windows!.dispose(); quit.dispose(); instance.data.dispose()
    })
    if (paths.data.testProfile) Object.defineProperty(app, '__workdayD08Test', { value: {
      windows, quit, paths: paths.data, repairBounds, background,
      interactiveAttempts: () => interactiveAttempts.slice(),
      chooseExit(choice: ExitChoice | null) { exitChoiceForTest = choice }
    } }) // Main-only and disposable test profile, never renderer/IPC.
    const created = windows.ensureMain()
    if (!created.ok) { startupError(created.error.message); app.exit(1) }
  }).catch(() => { startupError('初始化失败，应用将退出；配置未被更改。'); app.exit(1) })
}
