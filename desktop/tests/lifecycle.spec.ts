import { seedFormalProfile } from './helpers/formal-fixture'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { App } from 'electron'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import type { WindowManager } from '../src/main/windows/window-manager'
import type { ExitChoice } from '../src/main/lifecycle/quit-coordinator'

type TestApp = App & { __workdayD08Test: { windows: WindowManager; chooseExit(choice: ExitChoice): void; repairBounds(): unknown; paths: { userData: string; sessionData: string; pocSettings: string } } }
type ProcessInfo = {pid:number;parent:number;created:string;name:string;foreground:boolean}
type NativeDiagnostic = {running:boolean;timedOut:boolean;dropped:boolean;failure:string|null;events:unknown[];processes:unknown[]}
let focusDiagnostic: {status:string;identity:unknown;windows:unknown;native?:NativeDiagnostic;afterCleanup?:NativeDiagnostic;journal:Array<unknown>;remaining?:number[]} | null = null
let primaryTree: ReturnType<typeof trackTree> | null = null
const trackedPids = new Set<number>()
const journal = (event:string, details:object={}) => focusDiagnostic?.journal.push({event,at:Date.now(),...details})
async function trackNative(pid:number,role:string) {
  if(!focusDiagnostic||trackedPids.has(pid))return
  trackedPids.add(pid)
  try {journal('process.handle',{role,record:await observe(`track:${pid}`)})}
  catch(error){journal('process.handle.unavailable',{role,pid,error:String(error)})}
}
const exec = promisify(execFile)
const nativeElectron = createRequire(join(process.cwd(),'package.json'))('electron') as string
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined))
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.WORKDAY_ESCAPE_TEST_PROFILE
delete env.WORKDAY_ESCAPE_TEST_BACKGROUND // Explicit GUI suite only.
env.WORKDAY_ESCAPE_TEST_MODE = '1'
let profiles: string[] = [], applications: ElectronApplication[] = [], children: ChildProcess[] = []
// Reuse ONE hidden observer started before opening windows. Focus ownership
// remains observable; this alone has not resolved the GUI focus assertion.
let observer: ChildProcess, observerBuffer=''
const observations:Array<{resolve(value:unknown):void;reject(error:Error):void}>=[]
test.beforeAll(async()=>{
  // Use the existing inline-command approach; do not alter execution policy.
  observer=spawn('powershell.exe',['-WindowStyle','Hidden','-NoProfile','-NonInteractive','-Command',readFileSync(join(process.cwd(),'tests/helpers/d08-focus-observer.ps1'),'utf8')],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  observer.stdout!.setEncoding('utf8');observer.stdout!.on('data',(chunk:string)=>{observerBuffer+=chunk;let end:number;while((end=observerBuffer.indexOf('\n'))>=0){const line=observerBuffer.slice(0,end).trim();observerBuffer=observerBuffer.slice(end+1);const pending=observations.shift();if(pending){try{const value=JSON.parse(line);if(value?.error)pending.reject(new Error(value.error));else pending.resolve(value)}catch{pending.reject(new Error('Invalid process-observer response'))}}}})
  observer.on('error',error=>{for(const pending of observations.splice(0))pending.reject(error)})
  observer.on('exit',()=>{for(const pending of observations.splice(0))pending.reject(new Error('Process observer exited'))})
  await processes()
})
test.afterAll(async()=>{if(observer&&observer.exitCode===null){observer.stdin!.end();await new Promise<void>(done=>{const timer=setTimeout(()=>{observer.kill();done()},3000);observer.once('exit',()=>{clearTimeout(timer);done()})})}})
const profile = () => { const path=mkdtempSync(join(tmpdir(),'workday-d08-desktop-'));profiles.push(path);return path }
async function launch(path: string) {
  seedFormalProfile(path)
  const app=await electron.launch({args:['.',`--user-data-dir=${path}`],env});applications.push(app)
  const page=await app.firstWindow();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false');const open=page.getByRole('button',{name:'设置',exact:true});if(await open.count())await open.click()
  return {app,page}
}
async function processes(): Promise<ProcessInfo[]> {
  return observe<ProcessInfo[]>('snapshot')
}
async function observe<T=unknown>(command:string):Promise<T> {
  return new Promise((resolve,reject)=>{observations.push({resolve:value=>resolve(value as T),reject});observer.stdin!.write(command+'\n')})
}
function trackTree(root:number) {
  const seen=new Map<number,string|undefined>([[root,undefined]])
  return { async live() {
    const snapshot=await processes();let added=true
    while(added){added=false;for(const item of snapshot){const parent=seen.get(item.parent),actualParent=snapshot.find(p=>p.pid===item.parent)
      if(!seen.has(item.pid)&&seen.has(item.parent)&&(!parent||!actualParent||actualParent.created===parent)){seen.set(item.pid,item.created);added=true}
    }}
    for(const item of snapshot)if(seen.has(item.pid)&&seen.get(item.pid)===undefined)seen.set(item.pid,item.created)
    const live=snapshot.filter(item=>seen.has(item.pid)&&seen.get(item.pid)===item.created)
    if(focusDiagnostic)for(const item of live)await trackNative(item.pid,'captured-child')
    return live.map(item=>item.pid)
  } }
}
async function second(path:string,args:string[]=[]):Promise<void> {
  journal('secondary.request')
  const child=spawn(nativeElectron,['.',`--user-data-dir=${path}`,...args],{env,cwd:process.cwd(),windowsHide:true,stdio:'ignore'});children.push(child)
  journal('secondary.spawn',{pid:child.pid});child.once('exit',(code,signal)=>journal('secondary.exit.callback',{pid:child.pid,code,signal}))
  if(focusDiagnostic)await trackNative(child.pid!,'secondary')
  const tree=trackTree(child.pid!);await tree.live()
  await expect.poll(()=>child.exitCode,{timeout:10000}).toBe(0)
  journal('secondary.exit.asserted',{pid:child.pid})
  await expect.poll(()=>tree.live(),{timeout:10000}).toEqual([])
  journal('secondary.tree.empty',{pid:child.pid})
}
test.afterEach(async()=>{
  for(const app of applications){await app.evaluate(({app})=>(app as TestApp).__workdayD08Test.chooseExit('discard')).catch(()=>{});await app.close().catch(()=>{})}
  for(const child of children)if(child.pid&&child.exitCode===null)await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{})
  if(focusDiagnostic){
    try {
      if(primaryTree){await expect.poll(()=>primaryTree!.live(),{timeout:10000}).toEqual([]);focusDiagnostic.remaining=await primaryTree.live()}
      focusDiagnostic.afterCleanup=await observe<NativeDiagnostic>('diagnostic')
    } finally {writeFileSync(join(process.cwd(),'test-results/d08-last-focus-diagnostic.json'),JSON.stringify(focusDiagnostic,null,2));focusDiagnostic=null;primaryTree=null;trackedPids.clear()}
  }
  for(const path of profiles){expect(isAbsolute(path)&&path.startsWith(join(tmpdir(),'workday-d08-'))).toBe(true);rmSync(path,{recursive:true,force:true,maxRetries:10,retryDelay:200})}
  applications=[];children=[];profiles=[]
})

test('runtime userData is stable, POC settings cannot overwrite formal V2 sentinel',async()=>{
  const path=profile(),formal=join(path,'lifecycle','settings.json'),original='{"schemaVersion":3,"revision":99,"sentinel":"must remain unchanged"}'
  const pocSentinel='legacy unchanged';writeFileSync(join(path,'settings.json'),pocSentinel);mkdirSync(join(path,'lifecycle'));writeFileSync(formal,original)
  const {app,page}=await launch(path)
  const identity=await app.evaluate(({app})=>({name:app.getName(),userData:app.getPath('userData'),sessionData:app.getPath('sessionData'),paths:(app as TestApp).__workdayD08Test.paths}))
  expect(identity.name).toBe('Workday Escape');expect(identity.userData).toBe(join(path,'lifecycle'));expect(identity.sessionData).toBe(join(path,'lifecycle','runtime'));expect(identity.paths.pocSettings).toBe(join(path,'settings.json'))
  await expect(page.getByRole('button',{name:'保存设置'})).toBeDisabled();expect(readFileSync(formal,'utf8')).toBe(original);expect(readFileSync(join(path,'settings.json'),'utf8')).toBe(pocSentinel)
})
test('sequential secondary starts ignore arbitrary commands and retain exactly one window',async()=>{
  focusDiagnostic={status:'FAIL',identity:null,windows:null,journal:[]}
  await observe('start');await trackNative(process.pid,'playwright-worker');await trackNative(observer.pid!,'hidden-observer')
  journal('primary.launch.request')
  const path=profile(),{app}=await launch(path);journal('primary.launch.returned',{launcherPid:app.process().pid})
  app.process().once('exit',(code,signal)=>journal('primary.launcher.exit.callback',{code,signal}))
  const identity=await app.evaluate(({app,BrowserWindow})=>{
    const w=BrowserWindow.getAllWindows()[0],handle=w.getNativeWindowHandle(),hwnd='0x'+handle.readBigUInt64LE(0).toString(16),pid=process.pid,trace:Array<unknown>=[]
    ;(app as unknown as {d08FocusTrace:unknown}).d08FocusTrace=trace
    const record=(event:string)=>trace.push({event,at:Date.now(),pid,hwnd,id:w.id,focused:w.isFocused(),visible:w.isVisible(),minimized:w.isMinimized()})
    w.on('focus',()=>record('focus'));w.on('blur',()=>record('blur'));w.on('show',()=>record('show'));w.on('hide',()=>record('hide'));w.on('restore',()=>record('restore'));w.on('minimize',()=>record('minimize'))
    app.prependListener('second-instance',()=>record('second.before'));app.on('second-instance',()=>record('second.after'))
    const target=w as unknown as Record<string,(...args:unknown[])=>unknown>
    for(const method of ['show','focus','restore','hide','blur','minimize']){
      const original=target[method]
      target[method]=function(...args:unknown[]){record(`call.${method}.before`);try{return original.apply(this,args)}finally{record(`call.${method}.after`)}}
    }
    record('diagnostic.attached');return {id:w.id,pid,hwnd}
  })
  focusDiagnostic.identity=identity;await trackNative(app.process().pid!,'playwright-launcher');await trackNative(identity.pid,'electron-main')
  primaryTree=trackTree(app.process().pid!);await primaryTree.live()
  try {
    await second(path,['--import-config=untrusted.json','--execute=never']);await second(path)
    journal('focus.assertion.begin')
    // Same native id/count/visible/focused assertion and finite 2-second bound.
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),focused:w.isFocused()}))),{timeout:2000}).toEqual([{id:identity.id,visible:true,focused:true}])
    focusDiagnostic.status='PASS';journal('focus.assertion.pass')
  } finally {
    focusDiagnostic.windows=await app.evaluate(({app})=>(app as unknown as {d08FocusTrace:unknown}).d08FocusTrace)
    focusDiagnostic.native=await observe<NativeDiagnostic>('stop')
    writeFileSync(join(process.cwd(),'test-results/d08-last-focus-diagnostic.json'),JSON.stringify(focusDiagnostic,null,2))
    console.log('D08 diagnostic identity',identity,'assertion',focusDiagnostic.status,'foreground events',focusDiagnostic.native.events.length)
  }
})
test('second start restores a minimized primary without creating another window',async()=>{
  const path=profile(),{app}=await launch(path)
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize())
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true)
  await second(path)
  expect(await app.evaluate(({BrowserWindow})=>({count:BrowserWindow.getAllWindows().length,minimized:BrowserWindow.getAllWindows()[0].isMinimized(),visible:BrowserWindow.getAllWindows()[0].isVisible()}))).toEqual({count:1,minimized:false,visible:true})
})
test('hidden real primary recovers on second start with controlled recovery capability, no real tray',async()=>{
  const path=profile(),{app}=await launch(path)
  const result=await app.evaluate(({app})=>{const windows=(app as TestApp).__workdayD08Test.windows;windows.registerTrayRecovery({isAvailable:()=>true,registerRestore:()=>()=>{}});return windows.hideMain()})
  expect(result.ok).toBe(true);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
  await second(path);expect(await app.evaluate(({BrowserWindow})=>({count:BrowserWindow.getAllWindows().length,visible:BrowserWindow.getAllWindows()[0].isVisible()}))).toEqual({count:1,visible:true})
})
test('concurrent secondary starts terminate and primary keeps one window',async()=>{
  const path=profile(),{app}=await launch(path);await Promise.all([second(path),second(path)])
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1)
})
test('different disposable profiles can run independently',async()=>{
  const a=await launch(profile()),b=await launch(profile());expect(a.app.process().pid).not.toBe(b.app.process().pid)
  expect(await a.app.evaluate(({app})=>app.getPath('userData'))).not.toBe(await b.app.evaluate(({app})=>app.getPath('userData')))
})
test('no recovery capability refuses hide and keeps real main accessible',async()=>{
  const {app}=await launch(profile());const result=await app.evaluate(({app})=>(app as TestApp).__workdayD08Test.windows.hideMain())
  expect(result.ok).toBe(false);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
})
test('dirty formal continue editing preserves input and cancels native close',async()=>{
  const {app,page}=await launch(profile());await page.getByLabel('下班时间').fill('19:00')
  await app.evaluate(({app,BrowserWindow})=>{(app as TestApp).__workdayD08Test.chooseExit('continueEditing');BrowserWindow.getAllWindows()[0].close()})
  await expect(page.getByLabel('下班时间')).toHaveValue('19:00');expect(app.process().exitCode).toBe(null)
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
})
test('dirty formal save commits before true exit; launcher/main and captured children stop',async()=>{
  const path=profile(),{app,page}=await launch(path),processHandle=app.process(),tree=trackTree(processHandle.pid!);await tree.live()
  await page.getByLabel('设置分组').selectOption('appearance');await page.getByLabel('配色',{exact:true}).selectOption('coral');await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false');await app.evaluate(({app})=>(app as TestApp).__workdayD08Test.chooseExit('save'))
  const ended=app.waitForEvent('close');await page.getByRole('button',{name:'退出',exact:true}).click();await ended
  expect(JSON.parse(readFileSync(join(path,'lifecycle','settings.json'),'utf8')).appearance.accent).toBe('coral');await expect.poll(()=>processHandle.exitCode).toBe(0)
  await expect.poll(()=>tree.live(),{timeout:10000}).toEqual([])
})
test('explicit discard exits without writing edited formal time',async()=>{
  const path=profile(),{app,page}=await launch(path);const before=readFileSync(join(path,'lifecycle','settings.json'),'utf8')
  await page.getByLabel('下班时间').fill('19:00');await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false');await app.evaluate(({app})=>(app as TestApp).__workdayD08Test.chooseExit('discard'))
  const ended=app.waitForEvent('close');await page.getByRole('button',{name:'退出',exact:true}).click();await ended;expect(readFileSync(join(path,'lifecycle','settings.json'),'utf8')).toBe(before)
})
test('invalid unsaved formal save cancels exit and preserves values',async()=>{
  const {app,page}=await launch(profile());await page.getByLabel('上班时间').fill('22:00');await page.getByLabel('下班时间').fill('06:00');await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false');await app.evaluate(({app})=>(app as TestApp).__workdayD08Test.chooseExit('save'))
  await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page.locator('.app-error')).toBeVisible();expect(app.process().exitCode).toBe(null);await expect(page.getByLabel('上班时间')).toHaveValue('22:00')
})
test('normal formal dirty close offers save/discard/continue and continues editing',async()=>{
  const {app,page}=await launch(profile());await page.getByLabel('下班时间').fill('19:00')
  await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')
  const feedback=await app.evaluate(async({BrowserWindow,dialog})=>{
    const previous=dialog.showMessageBox;let offered:unknown=null
    // Controlled native-dialog adapter; real window/form/close path remains active.
    dialog.showMessageBox=(async(...args:unknown[])=>{offered=args[1];return {response:2,checkboxChecked:false}}) as typeof dialog.showMessageBox
    try {BrowserWindow.getAllWindows()[0].close();const deadline=Date.now()+5000;while(!offered&&Date.now()<deadline)await new Promise(done=>setTimeout(done,20));return offered}
    finally {dialog.showMessageBox=previous}
  }) as {buttons:string[]}
  expect(feedback.buttons).toEqual(['保存并退出','放弃并退出','继续编辑']);await expect(page.getByLabel('下班时间')).toHaveValue('19:00');expect(app.process().exitCode).toBe(null)
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
})
test('screen workArea repairs off-screen bounds, small native window keeps controls scrollable',async()=>{
  const {app,page}=await launch(profile())
  const result=await app.evaluate(async({app,BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({x:100000,y:100000,width:600,height:560});const repair=await (app as TestApp).__workdayD08Test.repairBounds();return {repair,bounds:w.getBounds(),areas:screen.getAllDisplays().map(d=>d.workArea),scales:screen.getAllDisplays().map(d=>d.scaleFactor)}})
  expect(result.areas.some(a=>result.bounds.x>=a.x&&result.bounds.y>=a.y&&result.bounds.x+result.bounds.width<=a.x+a.width&&result.bounds.y+result.bounds.height<=a.y+a.height),JSON.stringify(result)).toBe(true)
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(320,280);w.setBounds({width:320,height:280})})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true)
  await page.getByRole('button',{name:'保存设置'}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'保存设置'})).toBeVisible()
  await page.getByRole('button',{name:'退出',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'退出',exact:true})).toBeVisible()
})
test('abnormal termination can restart with the same profile and a usable main',async()=>{
  const path=profile(),first=await launch(path),processHandle=first.app.process(),pid=processHandle.pid!
  await exec('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true});await expect.poll(()=>processHandle.exitCode,{timeout:10000}).not.toBe(null)
  const reopened=await launch(path);await expect(reopened.page.getByRole('heading',{name:'Workday Escape'})).toBeVisible()
})
