import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,renameSync,mkdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {createRequire} from 'node:module'
import {performance} from 'node:perf_hooks'
import {seedFormalProfile} from './helpers/formal-fixture'
import {summarizeResourceLog,verifyMetricCoverage} from '../scripts/lib/resource-summary.mjs'
import {verifyOwnedExit,type NativeExitState} from './helpers/d15-exit-verdict.mjs'
import {createNativeRpc,collectCleanup,type NativeRpc} from './helpers/d15-native-rpc.mjs'
import {prepareResourceMain,resourceModeIssues,classifyResourceInput,type ResourceInputActivity} from './helpers/d15-resource-preparation.mjs'

let root:string
const nativeElectron=createRequire(resolve('package.json'))('electron') as string
let app:ElectronApplication,page:Page,profile:string,driver:ChildProcess,mainPid:number,appProcess:ChildProcess
let mainIdentity:NativeExitState|undefined
let nativeRpc:NativeRpc|undefined
const env=Object.fromEntries(Object.entries(process.env).filter((p):p is [string,string]=>p[1]!==undefined))
delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_TEST_BACKGROUND;delete env.WORKDAY_ESCAPE_TEST_PROFILE
env.WORKDAY_ESCAPE_TEST_MODE='1'
const result=(v:any)=>{expect(v.ok,JSON.stringify(v)).toBe(true);return v.data}
const save=(name:string,v:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(v,null,2))
const phase=(event:string,data:unknown=null)=>writeFileSync(join(root,'cleanup.jsonl'),JSON.stringify({event,at:Date.now(),mainPid,data})+'\n',{flag:'a'})
function rpc(request:unknown):Promise<any>{return nativeRpc?nativeRpc.request(request):Promise.reject(Error('Native driver unavailable'))}
async function settled(){await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')}
async function settings(){if(await page.getByRole('button',{name:'设置',exact:true}).count())await page.getByRole('button',{name:'设置',exact:true}).click();await settled()}
async function nativeState(){return app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL().endsWith('/mini.html')?'mini':'main',visible:w.isVisible(),focused:w.isFocused(),minimized:w.isMinimized(),bounds:w.getBounds(),hwnd:'0x'+w.getNativeWindowHandle().readBigUInt64LE().toString(16)})))}
async function exclusive(role:'main'|'mini'|null){await expect.poll(async()=>{const s=await nativeState();return s.filter(w=>w.visible&&!w.minimized).map(w=>w.url)}).toEqual(role?[role]:[])}
async function mainPage(){return (await app.windows()).find(p=>!p.url().endsWith('/mini.html'))!}
async function miniPage(){return (await app.windows()).find(p=>p.url().endsWith('/mini.html'))!}
async function showMini(){result(await page.evaluate(()=>window.workdayV2.window.perform({action:'showMini'})));await exclusive('mini');return miniPage()}
async function showMain(){const small=await miniPage();result(await small.evaluate(()=>window.workdayV2.window.perform({action:'showMain'})));await exclusive('main')}
async function trayMenu(name:string){await rpc({action:'tray',right:true});await expect.poll(async()=>{try{await rpc({action:'menu',name});return true}catch{return false}},{timeout:3000}).toBe(true)}
async function dialog(name:string){await expect.poll(async()=>{try{await rpc({action:'dialog',name});return true}catch{return false}},{timeout:5000}).toBe(true)}
async function recordedDialog(name:string){
  let snapshot:any
  await expect.poll(async()=>{snapshot=await rpc({action:'dialogSnapshot'});return snapshot.windows.flatMap((w:any)=>w.buttons).filter((button:string)=>button===name).length},{timeout:5000}).toBe(1)
  phase('native-dialog-ready',{choice:name,snapshot})
  const invoked=await rpc({action:'dialog',name}) // One Invoke only; never retry a selection.
  phase('native-dialog-returned',invoked)
}
async function quitFromPage(){await settings();await page.getByRole('button',{name:'退出程序',exact:true}).click()}

test.beforeEach(async({},info)=>{
  root=info.outputPath('evidence');mkdirSync(root,{recursive:true})
  app=undefined!;appProcess=undefined!;driver=undefined!;profile=undefined!;mainPid=0;mainIdentity=undefined;nativeRpc=undefined
  profile=mkdtempSync(join(tmpdir(),'workday-desktop-d15-'));seedFormalProfile(profile)
  // The desktop session is after 18:00. Keep this isolated fixture working
  // until 23:59 so Main/Mini G05 includes the normal working animation load.
  const file=join(profile,'lifecycle/settings.json'),config=JSON.parse(readFileSync(file,'utf8'));config.desktop.miniEnabled=true;config.schedule.endTime='23:59';writeFileSync(file,JSON.stringify(config))
  app=await electron.launch({args:['.','--user-data-dir='+profile],env});appProcess=app.process();page=await app.firstWindow();await settled()
  writeFileSync(join(root,'owned-profiles.jsonl'),JSON.stringify({profile,launcher:appProcess.pid,at:Date.now()})+'\n',{flag:'a'})
  mainPid=await app.evaluate(()=>process.pid)
  phase('main-ready',{launcherPid:appProcess.pid})
  appProcess.once('exit',(code,signal)=>phase('launcher-exit',{code,signal}))
  appProcess.stdout?.on('data',data=>writeFileSync(join(root,'launcher-stdout.log'),data,{flag:'a'}))
  appProcess.stderr?.on('data',data=>writeFileSync(join(root,'launcher-stderr.log'),data,{flag:'a'}))
  driver=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',resolve('tests/helpers/d15-native-driver.ps1'),'-OwnerProcessId',String(mainPid),'-LauncherProcessId',String(appProcess.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  nativeRpc=createNativeRpc(driver,{onRecord:event=>writeFileSync(join(root,'native-actions.jsonl'),JSON.stringify({at:Date.now(),mainPid,event})+'\n',{flag:'a'})})
  driver.stderr!.on('data',data=>writeFileSync(join(root,'native-driver-errors.log'),data,{flag:'a'}))
  const ready=await nativeRpc.ready;expect(ready.identity.pid).toBe(mainPid);mainIdentity=ready.identity
  const paths=await app.evaluate(({app,screen})=>({executable:app.getPath('exe'),userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),electron:process.versions.electron,displays:screen.getAllDisplays().map(d=>({id:d.id,scaleFactor:d.scaleFactor,workArea:d.workArea}))}))
  expect(paths.sessionData).toBe(join(profile,'lifecycle/runtime'))
  save('initial-identities',{at:Date.now(),launcher:appProcess.pid,mainIdentity,family:await rpc({action:'family'}),windows:await nativeState(),paths})
  expect(await app.evaluate(({app})=>(app as any).__workdayD08Test.background)).toBe(false)
  expect(await app.evaluate(({app})=>app.getPath('userData'))).toBe(join(profile,'lifecycle'))
  expect(await app.evaluate(({app})=>(app as any).__workdayD08Test.tray.available())).toBe(true)
  await app.evaluate(({app})=>{(app as any).__d15Trace=[];for(const event of ['browser-window-focus','browser-window-blur'])app.on(event as any,(_e:unknown,w:any)=>{(app as any).__d15Trace.push({event,at:Date.now(),hwnd:'0x'+w.getNativeWindowHandle().readBigUInt64LE().toString(16),visible:w.isVisible(),focused:w.isFocused()})})})
  await app.evaluate(({app})=>{for(const event of ['before-quit','will-quit'])app.on(event as any,()=>process.stdout.write('D15_NATIVE_EVENT '+JSON.stringify({event,at:Date.now(),pid:process.pid})+'\n'))})
})
test.afterEach(async({},info)=>{
  const exitObservation:{native:NativeExitState|null}={native:null}
  phase('cleanup-start',{status:info.status,mainIdentity})
  const errors=await collectCleanup([
    {name:'failure diagnostics',milliseconds:4000,run:async()=>{
      if(appProcess?.exitCode===null&&info.status!==info.expectedStatus){const state=await nativeState();save('failure',{state,driver:nativeRpc?.state()});if(nativeRpc?.state().phase==='ready')save('failure-foreground',await rpc({action:'foreground'}))}
    }},
    {name:'choose cleanup discard',milliseconds:3000,run:async()=>{if(appProcess?.exitCode===null){phase('request-quit');await app.evaluate(({app})=>(app as any).__workdayD08Test.chooseExit('discard'))}}},
    {name:'controlled app close',milliseconds:10000,run:async()=>{if(appProcess?.exitCode===null){await app.close();phase('app-close-returned')}}},
    {name:'native exit observation',milliseconds:12000,run:async()=>{
      if(nativeRpc?.state().phase==='ready')await expect.poll(async()=>{exitObservation.native=await rpc({action:'ownerExit'});return exitObservation.native?.exited},{timeout:10000}).toBe(true)
    }},
    {name:'verify owned exits',milliseconds:12000,run:async()=>{
      if(appProcess)await expect.poll(()=>appProcess.exitCode!==null||appProcess.signalCode!==null,{timeout:10000}).toBe(true)
      const verdict=verifyOwnedExit(appProcess,exitObservation.native,mainIdentity)
      const family=nativeRpc?.state().phase==='ready'?await rpc({action:'family'}):null
      save('exit-verdict',{...verdict,main:exitObservation.native,expected:mainIdentity,family,driver:nativeRpc?.state(),launcher:{pid:appProcess?.pid,exitCode:appProcess?.exitCode,signalCode:appProcess?.signalCode}})
      expect(verdict.status,JSON.stringify(verdict)).toBe('PASS');expect(family?.processes.length).toBeGreaterThanOrEqual(2)
      expect(family.processes.every((entry:any)=>entry.state.exited&&entry.state.exitCode===0),'all captured owned native processes exit normally').toBe(true)
    }},
    {name:'close native driver',milliseconds:6000,run:async()=>{await nativeRpc?.close()}},
    {name:'owned profile cleanup',milliseconds:4000,run:async()=>{if(exitObservation.native?.exited&&profile){expect(profile.startsWith(join(tmpdir(),'workday-desktop-d15-'))).toBe(true);rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})}}}
  ],(step,error)=>phase('cleanup-step-failed',{step,error:String(error)}))
  phase('cleanup-end',{native:exitObservation.native,launcherExit:appProcess?.exitCode,driver:nativeRpc?.state(),errors})
  expect(errors,'all cleanup failures must remain visible').toEqual([])
})

test('D15 native main: production page, real foreground, countdown, fish and sandbox',async()=>{
  await exclusive('main');await expect(page.getByRole('heading',{name:'今天你摸鱼了吗',exact:true})).toBeVisible()
  expect((await rpc({action:'foreground'})).pid).toBe(mainPid)
  const data=result(await page.evaluate(()=>window.workdayV2.snapshot.read()));expect(data.state).not.toBe('incomplete');expect(data.countdown).not.toBeNull();await expect(page.locator('[role=timer]').first()).toBeVisible()
  await expect(page.locator('.fish-progress')).toBeVisible()
  const prefs=await app.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences());expect(prefs).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true})
  await page.screenshot({path:join(root,'main.png')});save('main',{data,state:await nativeState(),foreground:await rpc({action:'foreground'})})
})

test('D15 native mini: exclusive activation, pin, real mouse drag, restored position and dirty draft',async()=>{
  await settings();await page.getByLabel('上班时间',{exact:true}).fill('08:');await settled();const before=readFileSync(join(profile,'lifecycle/settings.json'),'utf8')
  await page.getByRole('button',{name:'迷你模式',exact:true}).click();await exclusive('mini');let small=await miniPage()
  await small.getByRole('button',{name:'置顶',exact:true}).click();expect(await app.evaluate(({app})=>((app as any).__workdayD08Test.windows.getMini()).isAlwaysOnTop())).toBe(true)
  const initial=(await nativeState()).find(w=>w.url==='mini')!;await rpc({action:'drag',hwnd:initial.hwnd.replace('0x','')})
  await expect.poll(async()=>((await nativeState()).find(w=>w.url==='mini')!.bounds.x)).not.toBe(initial.bounds.x)
  const moved=(await nativeState()).find(w=>w.url==='mini')!.bounds
  // Record the independent return/draft requirement before any Shell provider
  // lookup, retaining the physical tray assertions below as separate evidence.
  await small.screenshot({path:join(root,'mini-dragged.png')});await small.getByRole('button',{name:'打开主窗口',exact:true}).click();await exclusive('main')
  await expect(page.getByLabel('上班时间',{exact:true})).toHaveValue('08:');expect(readFileSync(join(profile,'lifecycle/settings.json'),'utf8')).toBe(before)
  save('mini-independent',{initial,moved,pin:true,returnedToMain:true,draftPreserved:true,configurationUnchanged:true})
  small=await showMini();await small.getByRole('button',{name:'隐藏迷你窗',exact:true}).click();await exclusive(null)
  await trayMenu('显示迷你窗');await exclusive('mini');expect((await nativeState()).find(w=>w.url==='mini')!.bounds).toEqual(moved)
  await small.screenshot({path:join(root,'mini.png')});await small.getByRole('button',{name:'打开主窗口',exact:true}).click();await exclusive('main');await expect(page.getByLabel('上班时间',{exact:true})).toHaveValue('08:');expect(readFileSync(join(profile,'lifecycle/settings.json'),'utf8')).toBe(before)
  save('mini-drag',{initial,moved,restored:await nativeState()})
})

test('D15 native tray: first hide notice, close hides, physical tray restore, mini menu and minimize',async()=>{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await dialog('知道了，隐藏到托盘');await exclusive(null)
  await rpc({action:'tray',right:false});await exclusive('main');expect((await rpc({action:'foreground'})).pid).toBe(mainPid)
  await trayMenu('显示迷你窗');await exclusive('mini');await trayMenu('打开主窗口');await exclusive('main')
  await app.evaluate(({app})=>(app as any).__workdayD08Test.windows.getMain().minimize());await expect.poll(async()=>((await nativeState()).find(w=>w.url==='main')!.minimized)).toBe(true)
  const clicked=await rpc({action:'tray',right:false});await exclusive('main');const front=await rpc({action:'foreground'});expect(front.pid).toBe(mainPid);const elapsed=front.at-clicked.at;expect(elapsed).toBeLessThanOrEqual(1000);save('main-restore',{milliseconds:elapsed,foreground:front})
  const closed=app.waitForEvent('close');await trayMenu('退出程序');await closed;expect(appProcess.exitCode).toBe(0)
})

for(const choice of ['继续编辑','保存并退出','放弃并退出','保存失败'] as const)test('D15 native unsaved dialog: '+choice,async()=>{
  const initialForeground=await rpc({action:'foreground'});save('scenario-foreground',{initialForeground});expect(initialForeground.pid,'owned Main must own foreground after launch').toBe(mainPid)
  await settings();const file=join(profile,'lifecycle/settings.json'),before=readFileSync(file,'utf8');await page.getByLabel('下班时间',{exact:true}).fill(choice==='保存失败'?'08:00':'19:00');await settled();phase('product-exit-click',{choice});await quitFromPage()
  if(choice==='继续编辑'){
    await recordedDialog(choice);await settled()
    const foreground=await rpc({action:'foreground'});save('continued-foreground',foreground);expect(foreground.pid,'external foreground interference after continue editing').toBe(mainPid)
    await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00')
    const live=await rpc({action:'ownerExit'});expect(live.exited).toBe(false);expect(appProcess.exitCode).toBe(null)
    expect(readFileSync(file,'utf8')).toBe(before);await exclusive('main');expect((await nativeState()).length).toBe(1)
    // A fresh ordinary edit proves the recovered Renderer is usable, not just visible.
    await page.getByLabel('下班时间',{exact:true}).fill('19:01');await settled();await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:01')
    expect(readFileSync(file,'utf8')).toBe(before)
    save('continued-editing',{at:Date.now(),live,windows:await nativeState(),family:await rpc({action:'family'}),trace:await app.evaluate(({app})=>(app as any).__d15Trace),draft:'19:01',effectiveConfigUnchanged:true})
    await page.screenshot({path:join(root,'continued-editing.png')})
    phase('product-discard-exit-click');const closed=app.waitForEvent('close');await quitFromPage();await recordedDialog('放弃并退出');await closed
    await expect.poll(()=>appProcess.exitCode,{timeout:10000}).toBe(0)
    expect(readFileSync(file,'utf8')).toBe(before)
    let family:any
    await expect.poll(async()=>{family=await rpc({action:'family'});return family.processes.every((entry:any)=>entry.state.exited)},{timeout:10000}).toBe(true)
    expect(family.processes.every((entry:any)=>entry.state.exitCode===0)).toBe(true)
    save('controlled-discard-exit',{at:Date.now(),family,effectiveConfigUnchanged:true,usedProductDialog:true})
    return
  }
  if(choice==='保存并退出'||choice==='放弃并退出'){const closed=app.waitForEvent('close');await dialog(choice);await closed;await expect.poll(()=>appProcess.exitCode,{timeout:10000}).toBe(0);if(choice==='保存并退出')expect(JSON.parse(readFileSync(file,'utf8')).schedule.endTime).toBe('19:00');else expect(readFileSync(file,'utf8')).toBe(before)}
  else{await dialog(choice==='保存失败'?'保存并退出':choice);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue(choice==='保存失败'?'08:00':'19:00');expect(appProcess.exitCode).toBe(null);expect(readFileSync(file,'utf8')).toBe(before);if(choice==='保存失败')await expect(page.locator('.app-error')).toBeVisible()}
})

test('D15 native second-instance: original focus assertion and foreground evidence',async()=>{
  const trace:unknown[]=[]
  const observer=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',readFileSync(resolve('tests/helpers/d08-focus-observer.ps1'),'utf8')],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  const waiting:Array<(value:any)=>void>=[];let lines=''
  observer.stdout!.setEncoding('utf8');observer.stdout!.on('data',data=>{lines+=data;let end:number;while((end=lines.indexOf('\n'))>=0){const line=lines.slice(0,end);lines=lines.slice(end+1);waiting.shift()?.(JSON.parse(line))}})
  const observe=(command:string)=>new Promise<any>(done=>{waiting.push(done);observer.stdin!.write(command+'\n')})
  await observe('start');await observe('track:'+mainPid);await observe('track:'+process.pid)
  await app.evaluate(({app,BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];(app as any).__d15Trace=[];for(const event of ['focus','blur','show','hide','restore','minimize'])w.on(event as any,()=>{(app as any).__d15Trace.push({event,at:Date.now(),focused:w.isFocused(),visible:w.isVisible()})});app.on('second-instance',()=>{(app as any).__d15Trace.push({event:'second-instance',at:Date.now()})})})
  try{for(let i=0;i<2;i++){
    const child=spawn(nativeElectron,['.','--user-data-dir='+profile,'--execute=never'],{env,windowsHide:true,stdio:'ignore'});trace.push({event:'secondary-start',pid:child.pid,at:Date.now()});trace.push({nativeProcess:await observe('track:'+child.pid)})
    await new Promise<void>((done,reject)=>{child.once('error',reject);child.once('exit',code=>{trace.push({event:'secondary-exit',pid:child.pid,at:Date.now(),code});code===0?done():reject(Error('Secondary exit '+code))})})
  }
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused()}))),{timeout:2000}).toEqual([{visible:true,focused:true}]);expect((await rpc({action:'foreground'})).pid).toBe(mainPid)}finally{const native=await observe('stop');save('second-instance',{trace,native,windows:await app.evaluate(({app})=>(app as any).__d15Trace),foreground:await rpc({action:'foreground'}),state:await nativeState()});observer.stdin!.end();await new Promise<void>(done=>observer.once('exit',()=>done()))}
})

test('D15 native 100 switches: real exclusive windows, focus, listeners, subscriptions, draft and recovery',async()=>{
  test.setTimeout(180000);await settings();await page.getByLabel('上班时间',{exact:true}).fill('08:');await settled();const before=readFileSync(join(profile,'lifecycle/settings.json'),'utf8'),points=[]
  const small=await showMini();await showMain()
  const initial=await app.evaluate(({app,BrowserWindow})=>({ids:BrowserWindow.getAllWindows().map(w=>w.id),listeners:BrowserWindow.getAllWindows().map(w=>w.eventNames().reduce((n,k)=>n+w.listenerCount(k),0)),subscribers:(app as any).__workdayD08Test.snapshotSubscribers()}))
  for(let i=0;i<100;i++){
    result(await page.evaluate(()=>window.workdayV2.window.perform({action:'showMini'})));await exclusive('mini');expect((await nativeState()).find(w=>w.url==='mini')!.focused).toBe(true)
    const began=performance.now();result(await small.evaluate(()=>window.workdayV2.window.perform({action:'showMain'})));await exclusive('main');expect(performance.now()-began).toBeLessThanOrEqual(1000);expect((await nativeState()).find(w=>w.url==='main')!.focused).toBe(true)
    expect((await rpc({action:'foreground'})).pid).toBe(mainPid)
    await expect(page.getByLabel('上班时间',{exact:true})).toHaveValue('08:')
    const state=await app.evaluate(({app,BrowserWindow})=>({ids:BrowserWindow.getAllWindows().map(w=>w.id),listeners:BrowserWindow.getAllWindows().map(w=>w.eventNames().reduce((n,k)=>n+w.listenerCount(k),0)),subscribers:(app as any).__workdayD08Test.snapshotSubscribers(),metrics:app.getAppMetrics()}));expect(state.ids).toEqual(initial.ids);expect(state.listeners).toEqual(initial.listeners);expect(state.subscribers).toBeLessThanOrEqual(1);if(i%25===24){points.push({cycle:i+1,...state});save('switch-checkpoints',{initial,points})}
  }
  expect(readFileSync(join(profile,'lifecycle/settings.json'),'utf8')).toBe(before);save('100-switches',{initial,points,foreground:await rpc({action:'foreground'})})
  await showMini();await app.evaluate(({app})=>(app as any).__workdayD08Test.windows.getMini().destroy());await rpc({action:'tray',right:false});await exclusive('main');await expect(page.getByLabel('上班时间',{exact:true})).toHaveValue('08:')
})

test('D15 native resources: visible main, visible mini and real tray-only, 30+120 seconds each',async()=>{
  await measureNativeResources(['main','mini','tray'])
})

test('D15 native resources main: visible main only, 30+120 seconds',async()=>{
  await measureNativeResources(['main'],true)
})

async function measureNativeResources(modes:ReadonlyArray<'main'|'mini'|'tray'>,directMain=false){
  // Ten hidden samples took 12.67s on this machine. Leave a bounded margin for
  // actual CIM collection intervals, without changing 30+120 or any G05 budget.
  test.setTimeout(directMain?270000:780000);const summaries=[]
  if(directMain){
    // Instantiate the second Renderer while its native window stays hidden.
    // Main-only sampling never shows Mini or closes/hides/restores Main.
    result(await app.evaluate(({app})=>(app as any).__workdayD08Test.mini.prepare()))
    await exclusive('main')
  }else{await showMini();await showMain()}
  // Resource isolation does not depend on locating the Shell icon. This is
  // the real window service and real native tray, NOT a tray click verdict.
  await app.evaluate(({app,BrowserWindow})=>{
    const trace=(app as any).__d15Trace
    for(const w of BrowserWindow.getAllWindows())for(const event of ['close','show','hide','minimize','restore'])w.on(event as any,()=>trace.push({event,at:Date.now(),id:w.id,visible:w.isVisible(),minimized:w.isMinimized()}))
    const api=(app as any).__workdayD08Test
    for(const [port,methods]of [[api.windows,['showMain','hideMain','showMini','hideMini']],[api.tray,['close']]] as const)for(const operation of methods){
      const original=port[operation]
      port[operation]=function(this:unknown,...args:unknown[]){
        trace.push({event:'service-call',operation,at:Date.now()})
        const value:any=Reflect.apply(original,this,args)
        const returned=(result:any)=>trace.push({event:'service-return',operation,at:Date.now(),ok:result?.ok})
        if(value?.then)void value.then(returned,()=>trace.push({event:'service-reject',operation,at:Date.now()}));else returned(value)
        return value
      }
    }
  })
  if(!directMain)await prepareResourceMain({
    closeMain:()=>app.evaluate(({app})=>(app as any).__workdayD08Test.tray.close()),
    confirmHide:()=>dialog('知道了，隐藏到托盘'),assertTrayOnly:()=>exclusive(null),
    showMain:()=>app.evaluate(({app})=>(app as any).__workdayD08Test.windows.showMain()),assertMain:()=>exclusive('main'),
    record:(event,data)=>phase('resource-'+event,data)
  })
  const inputHwnd=directMain?(await nativeState()).find(w=>w.url==='main')!.hwnd.replace('0x',''):undefined
  const initialInput=directMain?await rpc({action:'input',hwnd:inputHwnd}):null
  if(directMain){
    const prepared=await app.evaluate(({app})=>{const api=(app as any).__workdayD08Test;return {at:Date.now(),state:api.windows.state(),trayAvailable:api.tray.available(),metrics:app.getAppMetrics(),trace:(app as any).__d15Trace}})
    const snapshot=result(await page.evaluate(()=>window.workdayV2.snapshot.read()))
    expect(snapshot.state).toBe('working');expect(prepared.state).toBe('mainVisible');expect(prepared.trayAvailable).toBe(true)
    expect(prepared.metrics.filter((m:any)=>m.type==='Tab').length).toBe(2)
    await expect(page.locator('.fish-waves--flowing')).toHaveCount(1)
    const timer=page.locator('[role=timer]').first(),timerBefore=await timer.innerText()
    await expect(timer).not.toHaveText(timerBefore)
    await page.screenshot({path:join(root,'main-prepared.png')})
    save('main-prepared',{...prepared,windows:await nativeState(),input:initialInput,family:await rpc({action:'family'}),mainIdentity,launcherPid:appProcess.pid,snapshotState:snapshot.state,timerBefore,timerAfter:await timer.innerText()})
  }
  for(const mode of modes){
    if(mode==='mini'){const start=performance.now();await showMini();const ms=performance.now()-start;expect(ms).toBeLessThanOrEqual(1000);save('mini-restore',{milliseconds:ms})}
    if(mode==='tray'){await (await miniPage()).getByRole('button',{name:'隐藏迷你窗',exact:true}).click();await exclusive(null)}
    const file=join(root,mode+'-verified-resources.jsonl'),feed=join(root,mode+'-metric-hints.jsonl'),observations:any[]=[]
    const expectedId=(await nativeState()).find(w=>w.url===mode)?.id
    const modeFailures:Array<{at:number;issues:string[]}>=[]
    const environmentNotes:any[]=[],environmentIssues:any[]=[]
    phase('resource-mode-start',{mode,expectedId})
    writeFileSync(feed,'',{flag:'wx'})
    const sampling=promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',resolve('scripts/measure-owned-processes.ps1'),'-RootProcessId',String(appProcess.pid),'-ElectronProcessId',String(mainPid),'-OutputFile',file,'-MetricsFile',feed,'-Mode',mode,'-WarmupSeconds','30','-SampleSeconds','120'],{windowsHide:true,timeout:240000,maxBuffer:1048576})
    let complete=false,failure:unknown,interrupted=false,nextInputCheck=0,previousInput=initialInput,activity:ResourceInputActivity|undefined;void sampling.then(()=>{complete=true},e=>{failure=e;complete=true})
    while(!complete){
      const point=await app.evaluate(({app,BrowserWindow})=>({at:Date.now(),windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),minimized:w.isMinimized()})),subscribers:(app as any).__workdayD08Test.snapshotSubscribers(),trayAvailable:(app as any).__workdayD08Test.tray.available(),metrics:app.getAppMetrics()}))
      observations.push(point);writeFileSync(feed,JSON.stringify({at:point.at,metrics:point.metrics})+'\n',{flag:'a'})
      const issues=resourceModeIssues(point,mode,expectedId)
      if(issues.length){if(!modeFailures.length)save(mode+'-first-mode-failure',{point,issues,trace:await app.evaluate(({app})=>(app as any).__d15Trace)});modeFailures.push({at:point.at,issues})}
      if(directMain&&Date.now()>=nextInputCheck){
        const input=await rpc({action:'input',hwnd:inputHwnd});nextInputCheck=Date.now()+1000
        input.renderer=await page.evaluate(()=>({at:Date.now(),visibility:document.visibilityState,hidden:document.hidden,wavesFlowing:!!document.querySelector('.fish-waves--flowing'),gifPlaying:!!document.querySelector('.moyu-animated[src]')}))
        const assessment=classifyResourceInput(input,previousInput,activity);activity=assessment.activity;previousInput=input
        input.assessment=assessment
        writeFileSync(join(root,'main-native-input.jsonl'),JSON.stringify(input)+'\n',{flag:'a'})
        if(assessment.changed)environmentNotes.push({at:input.at,input,point,reason:'input changed without proven GUI interference'})
        if(assessment.uncertainReasons.length)environmentIssues.push({at:input.at,reasons:assessment.uncertainReasons})
        if(input.renderer.hidden||input.renderer.visibility!=='visible'||!input.renderer.wavesFlowing||!input.renderer.gifPlaying)environmentIssues.push({at:input.at,reasons:['representative Renderer visibility or animation load changed'],renderer:input.renderer})
        if(assessment.stopReasons.length){save('main-external-interference',{initialInput,input,point,inputIssues:assessment.stopReasons});interrupted=true}
      }
      if(directMain&&(issues.length||interrupted)){
        interrupted=true;phase('resource-interrupted',{mode,samplerPid:sampling.child.pid,modeIssues:issues})
        sampling.child.kill() // Only this owned sampler; never count forced cleanup as PASS.
        break
      }
      await new Promise(r=>setTimeout(r,250))
    }
    if(interrupted){await sampling.catch(error=>{failure=error});save('main-interrupted',{at:Date.now(),failure:String(failure),modeFailures,observations,environmentNotes,environmentIssues,trace:await app.evaluate(({app})=>(app as any).__d15Trace)});throw Error('Main resource sampling stopped on mode or explicit desktop safety failure; evidence is INCOMPLETE')}
    await sampling;if(failure)throw failure
    const raw=readFileSync(file,'utf8'),protocol=summarizeResourceLog(raw),coverage=verifyMetricCoverage(raw,observations)
    const summary={...protocol,status:protocol.status==='COMPLETE'&&coverage.status==='COMPLETE'?'COMPLETE':'INCOMPLETE',coverage}
    const environmentQuality=directMain?{status:environmentIssues.length?'INCONCLUSIVE':'COMPLETE',notes:environmentNotes,issues:environmentIssues}:undefined
    save(mode+'-verified-summary',{summary,observations,modeFailures,environmentQuality,trace:await app.evaluate(({app})=>(app as any).__d15Trace)});summaries.push({mode,...summary,environmentQuality})
    expect(modeFailures,'mode must remain correct throughout warmup and sampling').toEqual([])
    expect(coverage.status,JSON.stringify(coverage.missing)).toBe('COMPLETE')
    for(const point of observations){expect(point.trayAvailable).toBe(true);expect(point.windows.filter((w:any)=>w.visible&&!w.minimized).map((w:any)=>w.id)).toEqual(mode==='tray'?[]:[expectedId]);expect(point.subscribers).toBeLessThanOrEqual(1)}
    expect(summary.status,JSON.stringify(summary.issues)).toBe('COMPLETE');await exclusive(mode==='tray'?null:mode);console.log('D15 native resource',mode,JSON.stringify({cpu:summary.meanCpuPercent,p95:summary.p95CpuPercent,pws:summary.pws}))
    if(directMain)expect(environmentIssues,'ENVIRONMENT_INCONCLUSIVE: unresolved sustained activity or Renderer workload change').toEqual([])
  }
  save(directMain?'main-g05-result':'three-modes',summaries);for(const s of summaries){expect(s.meanCpuPercent!).toBeLessThanOrEqual(s.mode==='tray'?.5:2);expect(s.pws!.maxMiB).toBeLessThanOrEqual(s.mode==='tray'?200:250)}
}
