import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication, Locator } from '@playwright/test'
import type { App, WebPreferences } from 'electron'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAppConfig } from '../src/shared/config-schema'
import { loadBundledCalendarStore } from '../src/main/services/calendar-store'
import type { AppConfig, Result, MainWindowApi } from '../src/shared/contracts'
import type { ExitChoice } from '../src/main/lifecycle/quit-coordinator'
import { V2_CHANNELS } from '../src/shared/ipc'
type TestApp=App & {__workdayD08Test:{background:boolean;windows:{beginQuit():void};quit:{requestQuit():Promise<Result<null>>};chooseExit(choice:ExitChoice|null):void;selectFile(kind:'import'|'export',name:string):void}}
// Native-hidden integration stimulates real DOM handlers. Pixel hit-testing and
// stable rendering frames are verified by real Headless clicks, not by showing
// Electron or forcing native focus. Disabled/DOM visibility assertions remain.
test.setTimeout(60_000) // Bounded complete 366-day validation, not a product timeout.
async function activate(locator:Locator){await expect(locator).toBeVisible();await expect(locator).toBeEnabled();await locator.dispatchEvent('click')}
let application:ElectronApplication|undefined,profile:string
const value=<T>(result:Result<T>):T=>{expect(result.ok,JSON.stringify(result)).toBe(true);if(!result.ok)throw Error('Expected success');return result.data}
const formal=()=>join(profile,'lifecycle','settings.json')
function fixture():AppConfig {
  const config=value(createAppConfig({startDate:'2026-10-01',startTime:'09:00',endTime:'18:00',salaryDay:10,themeMode:'system',themeAccent:'ocean',updatedAt:'2026-10-15T00:00:00.000Z',appVersion:'2.0.0'}))
  config.revision=1;config.calendar.enabledYears=[2024,2025,2026];config.calendar.datasets=value(loadBundledCalendarStore()).listMetadata();return config
}
test.beforeEach(()=>{profile=mkdtempSync(join(tmpdir(),'workday-d08-background-'))})
async function hidden(){
  expect(await application!.evaluate(({app,BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return{background:(app as TestApp).__workdayD08Test.background,visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable()}})).toEqual({background:true,visible:false,focused:false,focusable:false})
}
test.afterEach(async()=>{
  if(application){
    const owned=application;application=undefined
    try { if(owned.process().exitCode===null){application=owned;await hidden();application=undefined} }
    finally{
      // Cleanup is not an exit assertion. Product exit is checked in test bodies.
      if(owned.process().exitCode===null){const closed=owned.waitForEvent('close');await owned.evaluate(({app,BrowserWindow})=>{(app as TestApp).__workdayD08Test.windows.beginQuit();for(const window of BrowserWindow.getAllWindows())window.destroy();setImmediate(()=>app.exit(0))}).catch(()=>{});await closed}
    }
  }
  expect(profile.startsWith(join(tmpdir(),'workday-d08-background-'))).toBe(true)
  rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200})
})
async function launch(seed=true){
  if(seed&&!existsSync(formal())){mkdirSync(join(profile,'lifecycle'),{recursive:true});writeFileSync(formal(),JSON.stringify(fixture()))}
  const env=Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>pair[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_GUI_TESTS
  env.WORKDAY_ESCAPE_TEST_MODE='1';env.WORKDAY_ESCAPE_TEST_PROFILE=profile;env.WORKDAY_ESCAPE_TEST_BACKGROUND='1'
  application=await electron.launch({args:['.'],env});const page=await application.firstWindow()
  await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false');await hidden();return page
}
async function settings(page:Awaited<ReturnType<typeof launch>>){const button=page.getByRole('button',{name:'设置',exact:true});if(await button.count())await activate(button)}
async function settled(page:Awaited<ReturnType<typeof launch>>){await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')}
async function choose(choice:ExitChoice|null){await application!.evaluate(({app},choice)=>(app as TestApp).__workdayD08Test.chooseExit(choice),choice)}
async function file(kind:'import'|'export',name:string){await application!.evaluate(({app},data)=>(app as TestApp).__workdayD08Test.selectFile(data.kind,data.name),{kind,name})}
test('formal main stays hidden; real Preload and renderer sandbox deny legacy/Node/general IPC',async()=>{
  const page=await launch();await expect(page.getByRole('heading',{name:'Workday Escape',exact:true})).toBeVisible()
  const prefs=await application!.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows()[0].webContents as unknown as {getLastWebPreferences():WebPreferences}).getLastWebPreferences())
  expect({sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,webSecurity:prefs.webSecurity}).toEqual({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true})
  expect(await page.evaluate(()=>({legacy:typeof window.workday,require:typeof globalThis.require,process:typeof globalThis.process,generic:'invoke'in window.workdayV2}))).toEqual({legacy:'undefined',require:'undefined',process:'undefined',generic:false})
  value(await page.evaluate(()=>window.workdayV2.snapshot.read()))
})
test('missing configuration shows explicit empty first setup and preserves POC sentinel',async()=>{
  const sentinel='{"workStartTime":"08:30","workEndTime":"18:00"}';writeFileSync(join(profile,'settings.json'),sentinel)
  const page=await launch(false);await expect(page.getByRole('heading',{name:'首次设置'})).toBeVisible();await expect(page.getByLabel('上班时间',{exact:true})).toHaveValue('');expect(existsSync(formal())).toBe(false);expect(readFileSync(join(profile,'settings.json'),'utf8')).toBe(sentinel)
})
test('explicit first UI save initializes only formal config and produces a real dashboard',async()=>{
  const page=await launch(false);await page.getByLabel('上班时间',{exact:true}).fill('09:00');await page.getByLabel('下班时间',{exact:true}).fill('18:00');await page.getByLabel('设置分组').selectOption('salary');await page.getByLabel('每月发薪日',{exact:true}).fill('10');await activate(page.getByRole('button',{name:'保存设置',exact:true}));await expect(page.getByRole('status')).toHaveText('设置已保存。',{timeout:40000})
  expect(JSON.parse(readFileSync(formal(),'utf8')).revision).toBe(1);expect(existsSync(join(profile,'settings.json'))).toBe(false)
  await activate(page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}));await expect(page.getByRole('region',{name:'工作日仪表盘'})).toBeVisible();expect(value(await page.evaluate(()=>window.workdayV2.snapshot.read())).configRevision).toBe(1)
})
test('actual form saves schedule, survives offline reload and never touches old POC file',async()=>{
  const sentinel='legacy-preserve';writeFileSync(join(profile,'settings.json'),sentinel);let page=await launch();await settings(page)
  await page.getByLabel('下班时间',{exact:true}).fill('19:00');await activate(page.getByRole('button',{name:'保存设置',exact:true}));await expect(page.getByRole('status')).toHaveText('设置已保存。',{timeout:40000})
  expect(JSON.parse(readFileSync(formal(),'utf8')).schedule.endTime).toBe('19:00');await page.context().setOffline(true);await page.reload();await settled(page);await settings(page);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00');expect(readFileSync(join(profile,'settings.json'),'utf8')).toBe(sentinel)
})
test('invalid same-day schedule is rejected by real service and UI retains input',async()=>{
  const page=await launch(),original=readFileSync(formal(),'utf8');await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('08:00');await activate(page.getByRole('button',{name:'保存设置',exact:true}))
  await expect(page.locator('.app-error')).toBeVisible();await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('08:00');expect(readFileSync(formal(),'utf8')).toBe(original)
  expect((await page.evaluate(()=>window.workdayV2.config.save({settings:{path:'C:/arbitrary'} as never,expectedRevision:1}))).ok).toBe(false)
})
test('external file obstruction fails save without changing editor or preserved valid file',async()=>{
  const page=await launch(),original=readFileSync(formal(),'utf8');renameSync(formal(),join(profile,'lifecycle','preserved.json'));mkdirSync(formal());await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('19:00');await activate(page.getByRole('button',{name:'保存设置',exact:true}));await expect(page.locator('.app-error')).toBeVisible()
  await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00');expect(readFileSync(join(profile,'lifecycle','preserved.json'),'utf8')).toBe(original)
})
test('external revision conflict is visible and never overwrites external content',async()=>{
  const page=await launch();const changed=fixture();changed.revision=2;changed.appearance.accent='coral';writeFileSync(formal(),JSON.stringify(changed));await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('19:00');await activate(page.getByRole('button',{name:'保存设置',exact:true}));await expect(page.locator('.app-error')).toContainText('配置修订冲突')
  await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00');expect(JSON.parse(readFileSync(formal(),'utf8')).appearance.accent).toBe('coral')
})
test('Main dirty draft survives renderer reload and group switching; leave continues or explicitly discards',async()=>{
  const page=await launch();await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('19:00');await settled(page);await page.getByLabel('设置分组').selectOption('appearance');await page.getByLabel('设置分组').selectOption('schedule');await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00')
  await page.reload();await settled(page);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00');await activate(page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}));await activate(page.getByRole('dialog').getByRole('button',{name:'继续编辑',exact:true}));await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00')
  await activate(page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}));await activate(page.getByRole('dialog').getByRole('button',{name:'放弃',exact:true}));await settings(page);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('18:00')
})
test('leave save keeps dialog and input on failure, then saves only after correction',async()=>{
  const page=await launch();await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('08:00');await settled(page);await activate(page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}));await activate(page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}));await expect(page.getByRole('dialog')).toBeVisible()
  await activate(page.getByRole('dialog').getByRole('button',{name:'继续编辑',exact:true}));await page.getByLabel('下班时间',{exact:true}).fill('19:00');await settled(page);await activate(page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}));await activate(page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}));await expect(page.getByRole('region',{name:'工作日仪表盘'})).toBeVisible({timeout:40000});expect(JSON.parse(readFileSync(formal(),'utf8')).schedule.endTime).toBe('19:00')
})
for(const action of ['explicit','close'] as const)test('real clean '+action+' ends the actual Electron process',async()=>{
  const page=await launch(),handle=application!.process(),closed=application!.waitForEvent('close');if(action==='explicit')await activate(page.getByRole('button',{name:'退出',exact:true}));else await application!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;await expect.poll(()=>handle.exitCode).toBe(0);application=undefined
})
test('dirty exit without test choice refuses native prompts, keeps Main draft and process alive',async()=>{
  const page=await launch();await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('19:00');await settled(page);await choose(null);await activate(page.getByRole('button',{name:'退出',exact:true}));await expect(page.locator('.app-error')).toBeVisible();expect(application!.process().exitCode).toBe(null);expect(value(await page.evaluate(()=>window.workdayV2.settingsDraft.read())).dirty).toBe(true);await hidden()
})
for(const choice of ['save','discard','continueEditing'] as const)test('formal native exit protocol with injected choice '+choice,async()=>{
  const page=await launch();await settings(page);await page.getByLabel('设置分组').selectOption('appearance');await page.getByLabel('配色',{exact:true}).selectOption('coral');await settled(page);await choose(choice);const handle=application!.process()
  if(choice==='continueEditing'){await activate(page.getByRole('button',{name:'退出',exact:true}));expect(handle.exitCode).toBe(null);expect(value(await page.evaluate(()=>window.workdayV2.settingsDraft.read())).dirty).toBe(true);await hidden()}
  else{const closed=application!.waitForEvent('close');await activate(page.getByRole('button',{name:'退出',exact:true}));await closed;await expect.poll(()=>handle.exitCode).toBe(0);application=undefined;expect(JSON.parse(readFileSync(formal(),'utf8')).appearance.accent).toBe(choice==='save'?'coral':'ocean')}
})
test('exit save validation failure cancels real exit and preserves invalid input',async()=>{
  const page=await launch(),original=readFileSync(formal(),'utf8');await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('08:00');await settled(page);await choose('save');await activate(page.getByRole('button',{name:'退出',exact:true}));await expect(page.locator('.app-error')).toBeVisible();expect(application!.process().exitCode).toBe(null);expect(readFileSync(formal(),'utf8')).toBe(original);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('08:00')
})
test('pending-local-edit marker vetoes clean native close instead of discarding unsynchronized data',async()=>{
  const page=await launch();await page.evaluate(()=>document.querySelector('[data-workday-root]')!.setAttribute('data-pending','true'));const result=await application!.evaluate(async({app,BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();return (app as TestApp).__workdayD08Test.quit.requestQuit()});expect(result).toMatchObject({ok:false,error:{code:'IO_BUSY'}});expect(application!.process().exitCode).toBe(null);await hidden()
})
test('native source adapter uses owned fixture; actual preview selection applies only confirmed fields',async()=>{
  const page=await launch(),source='{"workStartTime":"08:30","workEndTime":"19:00"}';writeFileSync(join(profile,'source.json'),source);await file('import','source.json');await settings(page);await page.getByLabel('设置分组').selectOption('data');await page.getByLabel('导入来源').selectOption('electron-poc');await activate(page.getByRole('button',{name:'选择配置并预览',exact:true}))
  await expect(page.getByRole('region',{name:'导入预览'})).toBeVisible();expect(JSON.parse(readFileSync(formal(),'utf8')).schedule.endTime).toBe('18:00');await page.getByRole('region',{name:'导入预览'}).getByLabel('上班时间',{exact:true}).uncheck();await activate(page.getByRole('button',{name:'确认备份并应用所选字段',exact:true}));await expect(page.getByText('导入 / 恢复成功，源文件保持不变。')).toBeVisible({timeout:40000})
  const saved=JSON.parse(readFileSync(formal(),'utf8'));expect(saved.schedule.startTime).toBe('09:00');expect(saved.schedule.endTime).toBe('19:00');expect(readFileSync(join(profile,'source.json'),'utf8')).toBe(source)
})
test('real export chooser writes only selected new destination and history remains; annual endpoints unavailable',async()=>{
  const page=await launch();await file('export','export.json');await settings(page);await page.getByLabel('设置分组').selectOption('data');await activate(page.getByRole('button',{name:'导出已保存配置',exact:true}));await expect(page.getByText('已导出保存的V2配置（含历史加班，不含缓存和私有路径）。')).toBeVisible();expect(JSON.parse(readFileSync(join(profile,'export.json'),'utf8')).schemaVersion).toBe(2)
  const results=await page.evaluate(async()=>[await window.workdayV2.calendar.previewImport(),await window.workdayV2.calendar.applyImport({previewToken:'invalid',expectedCalendarRevision:0})]);expect(results.every(x=>!x.ok&&x.error.code==='UNAVAILABLE')).toBe(true)
})
test('real backup restore UI previews first and preserves corrupt primary in archive',async()=>{
  const page=await launch();await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('19:00');await activate(page.getByRole('button',{name:'保存设置',exact:true}));await expect(page.getByRole('status')).toHaveText('设置已保存。',{timeout:40000});writeFileSync(formal(),'{broken');await page.getByLabel('设置分组').selectOption('data');await activate(page.getByRole('button',{name:'预览最近有效备份',exact:true}));await expect(page.getByRole('region',{name:'导入预览'})).toBeVisible();expect(readFileSync(formal(),'utf8')).toBe('{broken')
  await activate(page.getByRole('button',{name:'确认备份并应用所选字段',exact:true}));await expect(page.getByText('导入 / 恢复成功，源文件保持不变。')).toBeVisible({timeout:40000});expect(JSON.parse(readFileSync(formal(),'utf8')).schedule.endTime).toBe('18:00');expect(readdirSync(join(profile,'lifecycle')).some(name=>name.startsWith('settings.corrupt.'))).toBe(true)
})
test('future schema remains untouched and is not treated as new user initialization',async()=>{
  mkdirSync(join(profile,'lifecycle'));writeFileSync(formal(),'{"schemaVersion":99}');const page=await launch(false);await expect(page.getByRole('button',{name:'保存设置',exact:true})).toBeDisabled();await expect(page.getByText('当前正式配置不可写', {exact:false})).toBeVisible();expect(readFileSync(formal(),'utf8')).toBe('{"schemaVersion":99}')
})
test('actual router still rejects iframe, foreign senders and hostile DTOs',async()=>{
  const page=await launch();expect(await page.evaluate(()=>window.workdayV2.window.perform({action:'showMain',windowId:1} as never))).toMatchObject({ok:false,error:{code:'VALIDATION'}})
  const channel=V2_CHANNELS['config.read'];const result=await application!.evaluate(async({ipcMain,BrowserWindow},channel)=>{
    const handler=(ipcMain as unknown as {_invokeHandlers:Map<string,(event:unknown,input:unknown)=>Promise<unknown>>})._invokeHandlers.get(channel)!
    const contents=BrowserWindow.getAllWindows()[0].webContents
    return [await handler({sender:{},senderFrame:contents.mainFrame},null),await handler({sender:contents,senderFrame:{}},null)]
  },channel);expect(result.every(x=>(x as Result<unknown>).ok===false)).toBe(true);await hidden()
})
