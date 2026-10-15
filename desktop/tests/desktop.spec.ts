import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { App, WebPreferences } from 'electron'
import type { EditableConfig } from '../src/shared/contracts'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedFormalProfile } from './helpers/formal-fixture'
let application:ElectronApplication|undefined,profile:string
test.setTimeout(60000)
test.beforeEach(()=>{profile=mkdtempSync(join(tmpdir(),'workday-desktop-'))})
test.afterEach(async()=>{
  if(application&&application.process().exitCode===null){
    const owned=application
    await owned.evaluate(({app})=>(app as App&{__workdayD08Test:{chooseExit(choice:string):void}}).__workdayD08Test.chooseExit('discard')).catch(()=>{})
    await owned.close().catch(async()=>{await owned.evaluate(({app,BrowserWindow})=>{(app as App&{__workdayD08Test:{windows:{beginQuit():void}}}).__workdayD08Test.windows.beginQuit();for(const window of BrowserWindow.getAllWindows())window.destroy();setImmediate(()=>app.exit(0))}).catch(()=>{})})
  }
  application=undefined;expect(profile.startsWith(join(tmpdir(),'workday-desktop-'))).toBe(true);rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200})
})
async function launch(){
  seedFormalProfile(profile)
  const env=Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>pair[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_TEST_PROFILE;delete env.WORKDAY_ESCAPE_TEST_BACKGROUND
  env.WORKDAY_ESCAPE_TEST_MODE='1'
  application=await electron.launch({args:['.', '--user-data-dir='+profile],env})
  const page=await application.firstWindow();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')
  return page
}
async function settings(page:Awaited<ReturnType<typeof launch>>){const open=page.getByRole('button',{name:'设置',exact:true});if(await open.count())await open.click()}

test('visible formal window, renderer sandbox and limited V2 preload',async()=>{
  const page=await launch();await expect(page.getByRole('heading',{name:'Workday Escape',exact:true})).toBeVisible()
  const prefs=await application!.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows()[0].webContents as unknown as {getLastWebPreferences():WebPreferences}).getLastWebPreferences())
  expect(prefs.contextIsolation).toBe(true);expect(prefs.sandbox).toBe(true);expect(prefs.nodeIntegration).toBe(false)
  expect(await page.evaluate(()=>({legacy:typeof window.workday,require:typeof globalThis.require,process:typeof globalThis.process,generic:'invoke'in window.workdayV2}))).toEqual({legacy:'undefined',require:'undefined',process:'undefined',generic:false})
  await page.screenshot({path:'test-results/d11-gui-window.png'})
})
test('formal save, authoritative one-second snapshot updates, offline reload and reopening',async()=>{
  let page=await launch();await settings(page);await page.getByLabel('下班时间',{exact:true}).fill('19:00');await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.locator('.app-notice[role=status]')).toHaveText('设置已保存。',{timeout:30000})
  expect(JSON.parse(readFileSync(join(profile,'lifecycle','settings.json'),'utf8')).schedule.endTime).toBe('19:00')
  await expect(page.getByRole('region',{name:'工作日仪表盘'})).toBeVisible()
  await page.evaluate(async()=>{const samples:number[]=[];(window as unknown as {__guiSequences:number[]}).__guiSequences=samples;await window.workdayV2.snapshot.subscribe(result=>{if(result.ok)samples.push(result.data.sequence)})})
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__guiSequences:number[]}).__guiSequences.length),{timeout:2500}).toBeGreaterThan(1)
  await page.context().setOffline(true);await page.reload();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false');await settings(page);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00')
  await application!.close();application=undefined;page=await launch();await settings(page);await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00')
})
test('invalid same-day inputs and malformed IPC remain rejected',async()=>{
  const page=await launch();await settings(page);const before=readFileSync(join(profile,'lifecycle','settings.json'),'utf8')
  await page.getByLabel('下班时间',{exact:true}).fill('08:00');await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.locator('.app-error')).toBeVisible();expect(readFileSync(join(profile,'lifecycle','settings.json'),'utf8')).toBe(before)
  const result=await page.evaluate(async()=>{const session=await window.workdayV2.settingsDraft.read();if(!session.ok)throw Error('Missing draft');const settings=session.data.draft as unknown as EditableConfig;return window.workdayV2.config.save({settings:{...settings,schedule:{...settings.schedule,startTime:'25:00',endTime:'26:00'}},expectedRevision:session.data.expectedRevision})})
  expect(result).toMatchObject({ok:false,error:{code:'VALIDATION'}})
})
test('corrupt formal configuration stays intact and offers recovery instead of default overwrite',async()=>{
  mkdirSync(join(profile,'lifecycle'));writeFileSync(join(profile,'lifecycle','settings.json'),'{broken');const page=await launch()
  await expect(page.getByRole('heading',{name:'配置恢复',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存设置',exact:true})).toBeDisabled();expect(readFileSync(join(profile,'lifecycle','settings.json'),'utf8')).toBe('{broken')
})
test('save obstruction preserves editor and last applied authoritative values',async()=>{
  const page=await launch();await settings(page);const path=join(profile,'lifecycle','settings.json');renameSync(path,path+'.preserved');mkdirSync(path)
  await page.getByLabel('下班时间',{exact:true}).fill('19:00');await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.locator('.app-error')).toBeVisible();await expect(page.getByLabel('下班时间',{exact:true})).toHaveValue('19:00')
  expect(await page.evaluate(async()=>{const saved=await window.workdayV2.config.read();return saved.ok?saved.data.config.schedule.endTime:null})).toBe('18:00')
})
for(const native of [false,true])test(native?'native clean close terminates process':'explicit clean exit terminates process',async()=>{
  const page=await launch();await settings(page);const process=application!.process(),closed=application!.waitForEvent('close');if(native)await application!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());else await page.getByRole('button',{name:'退出程序',exact:true}).click();await closed;await expect.poll(()=>process.exitCode).toBe(0);application=undefined
})
