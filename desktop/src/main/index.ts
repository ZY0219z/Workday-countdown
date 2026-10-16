import { app, BrowserWindow, dialog, ipcMain, screen, powerMonitor } from 'electron'
import type { Event } from 'electron'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APPLICATION_ID, APPLICATION_NAME, resolveApplicationPaths } from './app-identity'
import { acquireSingleInstance } from './single-instance'
import { createWindowManager, windowPresentationVisible } from './windows/window-manager'
import type { WindowManager } from './windows/window-manager'
import { restoreWindowBounds, applyRestoredBounds, MAIN_WINDOW_DEFAULT_SIZE, MAIN_WINDOW_MINIMUM_SIZE } from './windows/window-bounds'
import { createOperationBarrier } from './lifecycle/operation-barrier'
import { createQuitCoordinator } from './lifecycle/quit-coordinator'
import type { ExitChoice } from './lifecycle/quit-coordinator'
import { backgroundTestEnabled, blockInteractiveWindowOperations } from './lifecycle/background-testing'
import { success } from '../shared/validation'
import { createSystemClock } from '../adapters/system-clock'
import { createIntlTimeZoneAdapter } from '../adapters/intl-time-zone'
import { createTimeZoneCache } from '../domain/time-zone-cache'
import { loadBundledCalendarStore } from './services/calendar-store'
import { createConfigStore } from './services/config-store'
import { createRuntime } from './services/runtime'
import { createMigrationService } from './services/migration-service'
import { createMigrationFiles } from './services/migration-files'
import { createIpcRouter } from './ipc/router'
import { createTrayController, type TrayController } from './tray/tray-controller'
import { createNativeTray, readTrayIcon } from './tray/native-tray'
import { createBackgroundTray } from './tray/background-tray'

const rendererFile = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
// electron-vite supplies a slash-less HTTP origin; Chromium canonicalizes it.
// Canonicalize only our trusted target, never an incoming sender URL/origin.
const rendererUrl = devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href
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
  app.whenReady().then(async () => {
    // Formal page uses only V2 configuration. Legacy POC files remain untouched.
    const writes = createOperationBarrier()
    let importFileForTest: string | null = null, exportFileForTest: string | null = null
    let exitChoiceForTest: ExitChoice | null = null
    let hideChoiceForTest:boolean|null=null,tray:TrayController|undefined,testTray:ReturnType<typeof createBackgroundTray>|undefined
    let settingsRequested=false
    let feedbackOpen = false
    let interactiveAttempts: string[] = []
    const main = () => windows?.getMain() as BrowserWindow | null
    const quit = createQuitCoordinator({ waitMilliseconds: 3000, confirmationMilliseconds: 120000,
      waitForWrites: writes.drain, restoreMain: () => { if (!background) windows?.showMain() },
      commitQuit() {
        writes.seal(); windows!.beginQuit(); tray?.dispose(); instance.data.beginQuit()
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
    const zones=createTimeZoneCache(createIntlTimeZoneAdapter()),clock=createSystemClock(undefined,zones),calendars=loadBundledCalendarStore()
    if(!calendars.ok)throw new Error('离线日历资源无效。')
    const store=createConfigStore({directory:paths.data.userData,appVersion:app.getVersion(),clock,zones,calendars:calendars.data,maxValidationDates:10000})
    if(!store.ok)throw new Error('正式配置服务不可用。')
    const migration=createMigrationService({store:store.data,clock,zones,calendars:calendars.data,maxValidationDates:10000,
      sources:createMigrationFiles({
        async selectImport(kind) {
          if(paths.data.testProfile && importFileForTest){const selected=importFileForTest;importFileForTest=null;return join(dirname(paths.data.pocSettings),selected)}
          if(background)return null
          const window=main();if(!window)return null
          const selected=await dialog.showOpenDialog(window,{title:`选择${kind==='python-v1'?'Python V1':kind==='electron-poc'?'Electron POC':'V2'}配置（只读预览）`,properties:['openFile'],filters:[{name:'JSON配置',extensions:['json']}]})
          return selected.canceled?null:selected.filePaths[0]??null
        },
        async selectExport() {
          if(paths.data.testProfile && exportFileForTest){const selected=exportFileForTest;exportFileForTest=null;return join(dirname(paths.data.pocSettings),selected)}
          if(background)return null
          const window=main();if(!window)return null
          const selected=await dialog.showSaveDialog(window,{title:'导出V2配置（请选择新文件名）',defaultPath:'Workday-Escape-config.json',filters:[{name:'JSON配置',extensions:['json']}]})
          return selected.canceled?null:selected.filePath??null
        }
      })})
    const runtime=createRuntime({store:store.data,migration,clock,zones,calendars:calendars.data,maxValidationDates:10000,maxHistoryDays:100000,writes,initializeDefaults:{appVersion:app.getVersion()},
      async confirm(){
        if(paths.data.testProfile && exitChoiceForTest!==null)return success(exitChoiceForTest)
        if(background)return {ok:false,error:{code:'UNAVAILABLE',message:'后台退出需要显式测试选择，不弹出原生对话框。'}}
        const window=main();if(!window)return {ok:false,error:{code:'UNAVAILABLE',message:'没有可确认的窗口，退出取消。'}}
        const result=await dialog.showMessageBox(window,{type:'question',title:APPLICATION_NAME,message:'设置尚未保存，是否保存后退出？',buttons:['保存并退出','放弃并退出','继续编辑'],defaultId:2,cancelId:2,noLink:true})
        return success(result.response===0?'save':result.response===1?'discard':'continueEditing')
      }})
    const loadedRuntime=await runtime.start()
    if(!loadedRuntime.ok)throw new Error('正式服务启动失败。')
    const router=createIpcRouter(ipcMain,runtime,{
      quit:()=>requestQuit(false),
      window(command){
        if(!windows)return {ok:false,error:{code:'UNAVAILABLE',message:'窗口尚未创建。'}}
        switch(command.action){case 'showMain':return windows.showMain();case 'showMini':return windows.showMini();case 'hideMini':return windows.hideMini();case 'setMiniTop':return windows.setMiniTop(command.enabled)}
      }
    })
    const areas = () => screen.getAllDisplays().map(display => ({ id: display.id, workArea: display.workArea, scaleFactor: display.scaleFactor }))
    const defaults = { x: screen.getPrimaryDisplay().workArea.x, y: screen.getPrimaryDisplay().workArea.y, ...MAIN_WINDOW_DEFAULT_SIZE }
    const minimum = MAIN_WINDOW_MINIMUM_SIZE
    const bounds = (saved: unknown) => {
      const result = restoreWindowBounds(saved, areas(), screen.getPrimaryDisplay().id, defaults, minimum)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
    windows = createWindowManager(() => {
      const savedConfig = runtime.readConfig()
      const initial = bounds(savedConfig.ok ? savedConfig.data.config.desktop.bounds.main : null)
      const window = new BrowserWindow({ ...initial.bounds, minWidth: initial.minimum.width, minHeight: initial.minimum.height,
        title: 'Workday Escape', show: false, focusable: !background, autoHideMenuBar: true,
        webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
      })
      if (background) interactiveAttempts = blockInteractiveWindowOperations(window)
      const releaseWindow=router.register('main',{sender:window.webContents,frame:()=>window.webContents.mainFrame,url:()=>window.webContents.mainFrame.url,
        destroyed:()=>window.isDestroyed()||window.webContents.isDestroyed(),visible:()=>windowPresentationVisible(window),
        push:(channel,result)=>{if(!window.isDestroyed())window.webContents.send(channel,result)}},rendererUrl)
      window.once('closed',releaseWindow)
      window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)router.revokeSubscription(window.webContents)})
      const presentationChanged=()=>{router.visibilityChanged();if(windowPresentationVisible(window))runtime.refresh.wake()}
      window.on('show',presentationChanged);window.on('hide',presentationChanged)
      window.on('minimize',presentationChanged);window.on('restore',presentationChanged)
      window.setMenu(null)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      window.webContents.session.setPermissionCheckHandler(() => false)
      window.webContents.on('will-prevent-unload', event => { if (quit.isAuthorized()) event.preventDefault() })
      window.once('ready-to-show', () => { if (!quit.isAuthorized()) { if (!background) { windows!.showMain(); void repairBounds() }; instance.data.markReady() } })
      window.webContents.on('did-finish-load',()=>{if(settingsRequested){settingsRequested=false;router.openSettings()}})
      window.on('close', event => { if (!quit.isAuthorized()) { event.preventDefault(); if(tray)void tray.closeMain();else void requestQuit(true) } })
      const loaded = devUrl ? window.loadURL(rendererUrl) : window.loadFile(rendererFile)
      void loaded.catch(() => { if (!quit.isAuthorized() && !window.isDestroyed()) { startupError('页面加载失败，应用将退出；配置未被更改。'); app.exit(1) } })
      return window
    })
    tray=createTrayController({windows,
      create(){if(background){readTrayIcon();testTray=createBackgroundTray();return testTray}return createNativeTray()},
      config(){const read=runtime.readConfig();return read.ok?success(read.data.config):read},
      snapshot:()=>runtime.snapshots.read(),quit:()=>requestQuit(true),exiting:quit.isAuthorized,
      openSettings(){const window=main();if(!window||window.isDestroyed())return {ok:false,error:{code:'UNAVAILABLE',message:'主窗口不可用。'}};if(window.webContents.isLoading()){settingsRequested=true;return success(null)}return router.openSettings()},
      async confirmFirstHide(message){
        if(background)return hideChoiceForTest===null?{ok:false,error:{code:'UNAVAILABLE',message:'后台隐藏需要显式测试选择，不弹出提示。'}}:success(hideChoiceForTest)
        const window=main();if(!window)return {ok:false,error:{code:'UNAVAILABLE',message:'主窗口不可用，未隐藏。'}}
        const result=await dialog.showMessageBox(window,{type:'info',title:APPLICATION_NAME,message,buttons:['知道了，隐藏到托盘','暂不隐藏'],defaultId:0,cancelId:1,noLink:true})
        return success(result.response===0)
      },
      acknowledgeNotice:()=>runtime.acknowledgeTrayNotice(),
      feedback(message){if(background){console.error(message);return}const window=main();if(window&&!window.isDestroyed()&&!feedbackOpen){feedbackOpen=true;void dialog.showMessageBox(window,{type:'warning',title:APPLICATION_NAME,message,buttons:['返回窗口']}).finally(()=>{feedbackOpen=false})}else console.error(message)}
    })
    // Native Electron handles TaskbarCreated. These existing lifecycle events
    // also recheck destroyed ports, without an extra polling timer/service.
    const ensureTray=()=>tray!.ensure()
    ensureTray()
    quit.registerDraft({...runtime.exitAdapter,
      async read(){
        const window=main()
        if(!window||window.isDestroyed()||window.webContents.isLoading())return {ok:false,error:{code:'UNAVAILABLE',message:'页面尚未完成草稿同步，退出取消。'}}
        // This can only veto exit; the authoritative dirty state is still Main.
        const pending=await window.webContents.executeJavaScript(`document.querySelector('[data-workday-root]')?.getAttribute('data-pending')`)
        if(pending!=='false')return {ok:false,error:{code:'IO_BUSY',message:'设置正在同步或保存，请稍后再退出。'}}
        return runtime.exitAdapter.read()
      }
    })
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
    const activated = () => { if (!background && !quit.isAuthorized()) {ensureTray();windows!.showMain()} }
    const beforeQuit = (event: Event) => { if (!quit.isAuthorized()) { event.preventDefault(); void requestQuit(true) } }
    const allClosed = () => { if (!quit.isAuthorized()) windows!.showMain() }
    app.on('activate', activated); app.on('before-quit', beforeQuit); app.on('window-all-closed', allClosed)
    const resumed=()=>{zones.clear();runtime.refresh.wake(true);ensureTray()}
    powerMonitor.on('resume',resumed)
    app.once('will-quit', () => {
      if (boundsTimer) clearTimeout(boundsTimer)
      screen.removeListener('display-removed', displayChanged); screen.removeListener('display-metrics-changed', displayChanged); screen.removeListener('display-added', displayChanged)
      app.removeListener('activate', activated); app.removeListener('before-quit', beforeQuit); app.removeListener('window-all-closed', allClosed)
      powerMonitor.removeListener('resume',resumed);tray?.dispose();router.dispose();runtime.dispose()
      windows!.dispose(); quit.dispose(); instance.data.dispose()
    })
    if (paths.data.testProfile) Object.defineProperty(app, '__workdayD08Test', { value: {
      windows, quit, paths: paths.data, repairBounds, background,
      interactiveAttempts: () => interactiveAttempts.slice(),
      chooseExit(choice: ExitChoice | null) { exitChoiceForTest = choice },
      tray:{close:()=>tray!.closeMain(),menu:()=>tray!.openMenu(),chooseHide(value:boolean|null){hideChoiceForTest=value},
        settings:()=>router.openSettings(),items:()=>testTray?.items().map(({label,type,enabled})=>({label,type,enabled})),
        click(label:string){return testTray?.items().find(item=>item.label===label)?.click?.()},
        icon:()=>({empty:readTrayIcon().isEmpty(),size:readTrayIcon().getSize()}),available:()=>tray!.available()},
      selectFile(kind:'import'|'export',name:string){
        if(!/^[A-Za-z0-9_-]+\.json$/.test(name))throw Error('Test fixture basename only')
        if(kind==='import')importFileForTest=name;else exportFileForTest=name
      }
    } }) // Main-only and disposable test profile, never renderer/IPC.
    const created = windows.ensureMain()
    if (!created.ok) { startupError(created.error.message); app.exit(1) }
  }).catch(() => { startupError('初始化失败，应用将退出；配置未被更改。'); app.exit(1) })
}
