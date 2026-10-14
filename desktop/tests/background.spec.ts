import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { App, WebPreferences } from 'electron'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ExitChoice } from '../src/main/lifecycle/quit-coordinator'
import type { Result } from '../src/shared/contracts'

type TestApp = App & { __workdayD08Test: { background: boolean; chooseExit(choice: ExitChoice): void; quit: { requestQuit(): Promise<Result<null>> } } }
let application: ElectronApplication | undefined, profile: string
test.beforeEach(()=>{profile=mkdtempSync(join(tmpdir(),'workday-d08-background-'))})
async function hidden() {
  expect(await application!.evaluate(({app,BrowserWindow})=>{
    const w=BrowserWindow.getAllWindows()[0]
    return {background:(app as TestApp).__workdayD08Test.background,visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()}
  })).toEqual({background:true,visible:false,focused:false,focusable:false})
}
test.afterEach(async()=>{
  if(application){
    await hidden()
    await application.evaluate(({app})=>(app as TestApp).__workdayD08Test.chooseExit('discard'))
    await application.close();application=undefined
  }
  expect(isAbsolute(profile)&&profile.startsWith(join(tmpdir(),'workday-d08-background-'))).toBe(true)
  rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200})
})
async function launch() {
  const env=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>item[1]!==undefined))
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_GUI_TESTS
  env.WORKDAY_ESCAPE_TEST_MODE='1';env.WORKDAY_ESCAPE_TEST_PROFILE=profile;env.WORKDAY_ESCAPE_TEST_BACKGROUND='1'
  application=await electron.launch({args:['.'],env})
  const page=await application.firstWindow();await expect(page.getByRole('button',{name:'保存时间'})).toBeEnabled();await hidden();return page
}

test('actual main stays hidden and nonfocusable; production renderer/preload safety remains active',async()=>{
  const page=await launch();await expect(page.getByRole('heading',{name:'Workday Escape'})).toHaveText('Workday Escape')
  writeFileSync('test-results/d08-display.json',JSON.stringify(await application!.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}))),null,2))
  const preferences=await application!.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows()[0].webContents as unknown as {getLastWebPreferences():WebPreferences}).getLastWebPreferences())
  expect(preferences.contextIsolation).toBe(true);expect(preferences.sandbox).toBe(true);expect(preferences.nodeIntegration).toBe(false);expect(preferences.webSecurity).toBe(true)
  expect(await page.evaluate(()=>({keys:Object.keys(window.workday).sort(),require:typeof globalThis.require,process:typeof globalThis.process})))
    .toEqual({keys:['loadSettings','quit','saveSettings'],require:'undefined',process:'undefined'})
  await expect(page.getByLabel('上班时间')).toHaveValue('08:30');await expect(page.getByLabel('下班时间')).toHaveValue('18:00')
})
test('hidden renderer saves, ticks at 1Hz, reloads offline and reopens its isolated configuration',async()=>{
  let page=await launch();await page.getByLabel('上班时间').fill('00:00');await page.getByLabel('下班时间').fill('23:59');await page.getByRole('button',{name:'保存时间'}).click()
  await expect(page.getByRole('status')).toHaveText('时间已保存。');expect(JSON.parse(readFileSync(join(profile,'settings.json'),'utf8'))).toEqual({workStartTime:'00:00',workEndTime:'23:59'})
  const first=await page.getByTestId('countdown').innerText();if(first!=='00:00:00')await expect(page.getByTestId('countdown')).not.toHaveText(first,{timeout:2500})
  await page.context().setOffline(true);await page.reload();await expect(page.getByLabel('下班时间')).toHaveValue('23:59');await hidden()
  await application!.close();application=undefined;page=await launch();await expect(page.getByLabel('上班时间')).toHaveValue('00:00');await expect(page.getByLabel('下班时间')).toHaveValue('23:59')
})
test('hidden renderer and existing IPC both reject invalid times',async()=>{
  const page=await launch();await page.getByLabel('上班时间').fill('22:00');await page.getByLabel('下班时间').fill('06:00');await page.getByRole('button',{name:'保存时间'}).click()
  await expect(page.getByRole('status')).toContainText('下班时间必须晚于上班时间')
  expect(await page.evaluate(async()=>{try{await window.workday.saveSettings({workStartTime:'25:00',workEndTime:'26:00'});return 'accepted'}catch{return 'rejected'}})).toBe('rejected')
})
test('hidden startup keeps corrupt configuration and reports the error in the renderer',async()=>{
  writeFileSync(join(profile,'settings.json'),'{broken');const page=await launch();await expect(page.getByRole('status')).toContainText('配置读取失败');expect(readFileSync(join(profile,'settings.json'),'utf8')).toBe('{broken')
})
test('hidden save failure preserves applied values',async()=>{
  mkdirSync(join(profile,'settings.json.tmp'));const page=await launch();await page.getByLabel('下班时间').fill('19:00');await page.getByRole('button',{name:'保存时间'}).click()
  await expect(page.getByRole('status')).toContainText('无法保存时间');await expect(page.locator('.countdown')).toContainText('今日 08:30 — 18:00')
})
test('hidden explicit exit ends the actual Electron main process, not just its window',async()=>{
  const page=await launch(),processHandle=application!.process(),closed=application!.waitForEvent('close')
  await page.getByRole('button',{name:'退出',exact:true}).click();await closed;await expect.poll(()=>processHandle.exitCode).toBe(0);application=undefined
})
test('close of an already-hidden clean window reaches the real exit protocol',async()=>{
  await launch();const processHandle=application!.process(),closed=application!.waitForEvent('close')
  await application!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;await expect.poll(()=>processHandle.exitCode).toBe(0);application=undefined
})
test('hidden POC handlers never write the formal configuration sentinel',async()=>{
  const formal=join(profile,'lifecycle','settings.json'),original='{"schemaVersion":99,"sentinel":"preserve"}';mkdirSync(join(profile,'lifecycle'));writeFileSync(formal,original)
  const page=await launch();await page.getByLabel('下班时间').fill('19:00');await page.getByRole('button',{name:'保存时间'}).click();await expect(page.getByRole('status')).toHaveText('时间已保存。');expect(readFileSync(formal,'utf8')).toBe(original)
})
test('dirty background exit without confirmation adapter refuses to show a dialog or drop edits',async()=>{
  const page=await launch();await page.getByLabel('下班时间').fill('19:00');await page.getByRole('button',{name:'退出',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('退出失败')
  expect(await page.evaluate(async()=>{try{await window.workday.quit();return 'accepted'}catch(error){return String(error)}})).toContain('后台测试未注入确认')
  await expect(page.getByLabel('下班时间')).toHaveValue('19:00');expect(existsSync(join(profile,'settings.json'))).toBe(false);expect(application!.process().exitCode).toBe(null);await hidden()
})
for(const choice of ['save','discard','continueEditing'] as const)test(`hidden real form supports injected exit choice ${choice}, without native prompts`,async()=>{
  const page=await launch();await page.getByLabel('下班时间').fill('19:00');await application!.evaluate(({app},value)=>(app as TestApp).__workdayD08Test.chooseExit(value),choice)
  const processHandle=application!.process()
  if(choice==='continueEditing'){
    await page.getByRole('button',{name:'退出',exact:true}).click();await expect(page.getByRole('status')).toContainText('退出失败')
    const result=await application!.evaluate(({app})=>(app as TestApp).__workdayD08Test.quit.requestQuit());expect(result.ok).toBe(false);if(!result.ok)expect(result.error.code).toBe('CANCELLED')
    await expect(page.getByLabel('下班时间')).toHaveValue('19:00');expect(existsSync(join(profile,'settings.json'))).toBe(false);await hidden();expect(processHandle.exitCode).toBe(null)
  }else{
    const closed=application!.waitForEvent('close');await page.getByRole('button',{name:'退出',exact:true}).click();await closed;await expect.poll(()=>processHandle.exitCode).toBe(0);application=undefined
    if(choice==='save')expect(JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).workEndTime).toBe('19:00')
    else expect(existsSync(join(profile,'settings.json'))).toBe(false)
  }
})
