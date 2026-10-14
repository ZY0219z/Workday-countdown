import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { App, WebPreferences } from 'electron'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ExitChoice } from '../src/main/lifecycle/quit-coordinator'
import type { AppConfig, EditableConfig, Result, DashboardSnapshot, JsonObject } from '../src/shared/contracts'
import { createAppConfig } from '../src/shared/config-schema'
import { V2_CHANNELS } from '../src/shared/ipc'

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

function formalFixture():AppConfig {
  const result=createAppConfig({startDate:null,startTime:'09:00',endTime:'18:00',salaryDay:10,themeMode:'system',themeAccent:'ocean',updatedAt:'2026-10-14T00:00:00.000Z',appVersion:'2.0.0'})
  if(!result.ok)throw Error('Invalid fixed test fixture')
  // A valid explicit Sunday-only week bounds the real first-save validation
  // cost. Active shift states use fixed clocks in the service suite; these
  // integration tests still use the production timezone adapter and validator.
  result.data.schedule.workWeek=[7]
  return result.data
}
function formalSettings():EditableConfig {
  const c=formalFixture()
  return {employee:c.employee,schedule:c.schedule,salary:c.salary,overtime:c.overtime,
    calendar:{region:c.calendar.region,enabledYears:c.calendar.enabledYears,overrides:c.calendar.overrides},appearance:c.appearance,desktop:c.desktop}
}
function passed<T>(result:Result<T>):T { expect(result.ok,JSON.stringify(result)).toBe(true);if(!result.ok)throw Error('Expected successful DTO');return result.data }

test('D09 actual fixed Preload and uninitialized Main leave both config domains untouched',async()=>{
  const page=await launch()
  const surface=await page.evaluate(()=>({keys:Object.keys(window.workdayV2).sort(),config:Object.keys(window.workdayV2.config).sort(),
    draft:Object.keys(window.workdayV2.settingsDraft).sort(),dynamic:'invoke' in window.workdayV2||'send' in window.workdayV2,
    node:typeof globalThis.require,process:typeof globalThis.process,old:Object.keys(window.workday).sort()}))
  expect(surface).toEqual({keys:['app','calendar','config','contractVersion','data','role','settingsDraft','snapshot','window'],config:['read','save'],draft:['discard','read','update'],dynamic:false,node:'undefined',process:'undefined',old:['loadSettings','quit','saveSettings']})
  const result=await page.evaluate(async()=>({config:await window.workdayV2.config.read(),draft:await window.workdayV2.settingsDraft.read(),snapshot:await window.workdayV2.snapshot.read()}))
  expect(result.config.ok).toBe(false);expect(result.snapshot.ok).toBe(false);expect(passed(result.draft).saved).toBe(null)
  expect(existsSync(join(profile,'lifecycle','settings.json'))).toBe(false)
  await page.getByLabel('下班时间').fill('19:00');await page.getByRole('button',{name:'保存时间'}).click();await expect(page.getByRole('status')).toHaveText('时间已保存。')
  expect(existsSync(join(profile,'lifecycle','settings.json'))).toBe(false);await hidden()
})

test('D09 real IPC explicit save initializes formal revision and pushes shared serializable snapshots',async()=>{
  const page=await launch(),settings=formalSettings()
  const initial=passed(await page.evaluate(s=>window.workdayV2.config.save({settings:s,expectedRevision:0}),settings))
  expect(initial.config.revision).toBe(1);expect(existsSync(join(profile,'settings.json'))).toBe(false)
  expect(JSON.parse(readFileSync(join(profile,'lifecycle','settings.json'),'utf8')).schemaVersion).toBe(2)
  const snapshot=passed(await page.evaluate(()=>window.workdayV2.snapshot.read()))
  expect(snapshot.configRevision).toBe(1);expect(snapshot.employment.status).toBe('unset');if(snapshot.activeShift===null)expect(snapshot.progress).toBe(null)
  await page.evaluate(async()=>{
    const w=window as unknown as {d09Snapshots:Result<DashboardSnapshot>[]};w.d09Snapshots=[]
    const listen=(result:Result<DashboardSnapshot>)=>w.d09Snapshots.push(result)
    await window.workdayV2.snapshot.subscribe(listen);await window.workdayV2.snapshot.subscribe(listen)
  })
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {d09Snapshots:unknown[]}).d09Snapshots.length)).toBeGreaterThan(0)
  settings.salary.day=15
  const saved=passed(await page.evaluate(s=>window.workdayV2.config.save({settings:s,expectedRevision:1}),settings));expect(saved.config.revision).toBe(2)
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {d09Snapshots:Result<DashboardSnapshot>[]}).d09Snapshots.some(r=>r.ok&&r.data.configRevision===2))).toBe(true)
  const events=await page.evaluate(()=>(window as unknown as {d09Snapshots:Result<DashboardSnapshot>[]}).d09Snapshots)
  expect(events.filter(r=>r.ok).every(r=>Object.keys(r).sort().join(',')==='data,ok')).toBe(true)
  passed(await page.evaluate(()=>window.workdayV2.snapshot.unsubscribe()));passed(await page.evaluate(()=>window.workdayV2.snapshot.unsubscribe()))
  const old=await page.evaluate(()=>window.workday.loadSettings());expect(old.settings).toEqual({workStartTime:'08:30',workEndTime:'18:00'})
  await hidden()
})

test('D09 Main draft survives renderer reload; failed save retains authority and dirty session',async()=>{
  const page=await launch(),settings=formalSettings();passed(await page.evaluate(s=>window.workdayV2.config.save({settings:s,expectedRevision:0}),settings))
  settings.schedule.endTime='08:00'
  passed(await page.evaluate(d=>window.workdayV2.settingsDraft.update({draft:d as unknown as JsonObject,expectedRevision:1}),settings))
  await page.reload();await expect(page.getByRole('button',{name:'保存时间'})).toBeEnabled()
  const draft=passed(await page.evaluate(()=>window.workdayV2.settingsDraft.read()));expect(draft.dirty).toBe(true);expect((draft.draft.schedule as JsonObject).endTime).toBe('08:00')
  const before=readFileSync(join(profile,'lifecycle','settings.json'),'utf8')
  const failed=await page.evaluate(s=>window.workdayV2.config.save({settings:s,expectedRevision:1}),settings);expect(failed.ok).toBe(false)
  expect(readFileSync(join(profile,'lifecycle','settings.json'),'utf8')).toBe(before)
  const retained=passed(await page.evaluate(()=>window.workdayV2.settingsDraft.read()));expect(retained.save.status).toBe('failed');expect(retained.dirty).toBe(true)
  expect(passed(await page.evaluate(()=>window.workdayV2.config.read())).config.revision).toBe(1)
  expect(passed(await page.evaluate(()=>window.workdayV2.snapshot.read())).configRevision).toBe(1)
  passed(await page.evaluate(()=>window.workdayV2.settingsDraft.discard()));expect(passed(await page.evaluate(()=>window.workdayV2.settingsDraft.read())).dirty).toBe(false)
  await hidden()
})

test('D09 formal dirty exit save failure and continue-edit preserve the live process',async()=>{
  const page=await launch(),settings=formalSettings();settings.schedule.endTime='08:00'
  passed(await page.evaluate(d=>window.workdayV2.settingsDraft.update({draft:d as unknown as JsonObject,expectedRevision:0}),settings))
  for(const choice of ['save','continueEditing'] as const){
    await application!.evaluate(({app},c)=>(app as TestApp).__workdayD08Test.chooseExit(c),choice)
    const result=await page.evaluate(()=>window.workdayV2.app.quit());expect(result.ok).toBe(false)
    expect(passed(await page.evaluate(()=>window.workdayV2.settingsDraft.read())).dirty).toBe(true);expect(application!.process().exitCode).toBe(null)
  }
  expect(existsSync(join(profile,'lifecycle','settings.json'))).toBe(false);await hidden()
})

test('D09 formal dirty exit saves only after the injected explicit confirmation',async()=>{
  const formal=join(profile,'lifecycle','settings.json');mkdirSync(join(profile,'lifecycle'));writeFileSync(formal,JSON.stringify(formalFixture()))
  const page=await launch(),settings=formalSettings();settings.salary.day=15
  passed(await page.evaluate(d=>window.workdayV2.settingsDraft.update({draft:d as unknown as JsonObject,expectedRevision:0}),settings))
  await application!.evaluate(({app})=>(app as TestApp).__workdayD08Test.chooseExit('save'))
  const handle=application!.process(),closed=application!.waitForEvent('close')
  // Successful quit destroys this renderer. Check the saved file and actual
  // process exit instead of requiring a reply in an already destroyed page.
  await page.evaluate(()=>{void window.workdayV2.app.quit()});await closed;await expect.poll(()=>handle.exitCode).toBe(0);application=undefined
  expect(JSON.parse(readFileSync(join(profile,'lifecycle','settings.json'),'utf8')).revision).toBe(1);expect(existsSync(join(profile,'settings.json'))).toBe(false)
})

test('D09 corrupt formal source is read-only and fixed import/calendar routes return UNAVAILABLE',async()=>{
  const formal=join(profile,'lifecycle','settings.json'),bytes='{corrupt';mkdirSync(join(profile,'lifecycle'));writeFileSync(formal,bytes)
  const page=await launch();expect((await page.evaluate(()=>window.workdayV2.config.read())).ok).toBe(false)
  const result=await page.evaluate(async()=>[await window.workdayV2.data.previewImport({sourceKind:'v2'}),await window.workdayV2.calendar.previewImport()])
  for(const item of result){expect(item.ok).toBe(false);if(!item.ok)expect(item.error.code).toBe('UNAVAILABLE')}
  expect(readFileSync(formal,'utf8')).toBe(bytes);await hidden()
})

test('D09 actual handlers reject other frames, unknown senders, hostile DTO and arbitrary paths',async()=>{
  const page=await launch()
  const denied=await application!.evaluate(async({ipcMain,BrowserWindow},channels)=>{
    // Privileged test harness supplies hostile events to the ACTUAL registered
    // handlers. No reflection or raw channel is exposed to the renderer API.
    const handlers=(ipcMain as unknown as {_invokeHandlers:Map<string,(event:unknown,input:unknown)=>Promise<Result<unknown>>>})._invokeHandlers
    const w=BrowserWindow.getAllWindows()[0],sender=w.webContents,frame=sender.mainFrame
    return [await handlers.get(channels['snapshot.read'])!({sender,senderFrame:{}},null),
      await handlers.get(channels['snapshot.read'])!({sender:{},senderFrame:frame},null),
      await handlers.get(channels['window.perform'])!({sender,senderFrame:frame},{action:'showMain',windowId:123}),
      await handlers.get(channels['data.previewImport'])!({sender,senderFrame:frame},{sourceKind:'v2',path:'C:\\secret'})]
  },V2_CHANNELS)
  expect(denied.map(r=>r.ok?null:r.error.code)).toEqual(['FORBIDDEN','FORBIDDEN','VALIDATION','VALIDATION'])
  expect(JSON.stringify(denied)).not.toContain('C:\\secret')
  expect((await page.evaluate(()=>window.workdayV2.window.perform({action:'showMini'}))).ok).toBe(false)
  await hidden()
})
