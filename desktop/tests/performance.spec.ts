import {test,expect,_electron as electron} from '@playwright/test'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createAppConfig} from '../src/shared/config-schema'
import {loadBundledCalendarStore} from '../src/main/services/calendar-store'
import type {Result} from '../src/shared/contracts'
// Pure test tooling; not imported into Main/Preload/Renderer or app.asar.
import {summarizeResourceLog} from '../scripts/lib/resource-summary.mjs'

const value=<T>(result:Result<T>):T=>{expect(result.ok,JSON.stringify(result)).toBe(true);if(!result.ok)throw Error('Expected success');return result.data}
const evidenceRoot=resolve('test-results/d15-performance');mkdirSync(evidenceRoot,{recursive:true})
for(const mode of ['smoke','baseline'] as const)test(`D15 ${mode}: owned native-hidden process family observation`,async()=>{
  test.skip(process.platform!=='win32','Windows native counters are required')
  const profile=mkdtempSync(join(tmpdir(),'workday-d08-background-')),run=mkdtempSync(join(evidenceRoot,mode+'-'))
  const config=value(createAppConfig({startDate:'2026-10-01',startTime:'09:00',endTime:'18:00',salaryDay:10,themeMode:'system',themeAccent:'ocean',updatedAt:'2026-10-19T00:00:00.000Z',appVersion:'2.0.0'}))
  config.revision=1;config.desktop.miniEnabled=true;config.calendar.enabledYears=[2024,2025,2026];config.calendar.datasets=value(loadBundledCalendarStore()).listMetadata()
  mkdirSync(join(profile,'lifecycle'));writeFileSync(join(profile,'lifecycle/settings.json'),JSON.stringify(config))
  const env=Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>pair[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_GUI_TESTS
  env.WORKDAY_ESCAPE_TEST_MODE='1';env.WORKDAY_ESCAPE_TEST_PROFILE=profile;env.WORKDAY_ESCAPE_TEST_BACKGROUND='1'
  const app=await electron.launch({args:['.'],env}),child=app.process()
  const audit=async()=>app.evaluate(({app,BrowserWindow,screen})=>({background:(app as any).__workdayD08Test.background,
    windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})),
    attempts:(app as any).__workdayD08Test.interactiveAttempts(),subscriptions:(app as any).__workdayD08Test.snapshotSubscribers(),
    metrics:app.getAppMetrics().map(p=>({pid:p.pid,type:p.type})),displays:screen.getAllDisplays().map(d=>({id:d.id,scaleFactor:d.scaleFactor,workArea:d.workArea})),electron:process.versions.electron}))
  try{
    const main=await app.firstWindow();await expect(main.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')
    value(await app.evaluate(({app})=>(app as any).__workdayD08Test.mini.prepare()))
    const before=await audit();expect(before.background).toBe(true);expect(before.windows).toHaveLength(2);expect(before.windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);expect(before.attempts).toEqual([])
    const identity=await app.evaluate(()=>({pid:process.pid,executable:process.execPath}))
    writeFileSync(join(run,'identity.json'),JSON.stringify({...identity,launchRootPid:child.pid},null,2))
    const file=join(run,'resources.jsonl'),warmup=mode==='baseline'?30:0,seconds=mode==='baseline'?120:5
    const sampling=promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',resolve('scripts/measure-owned-processes.ps1'),'-RootProcessId',String(child.pid),'-ElectronProcessId',String(identity.pid),'-OutputFile',file,'-WarmupSeconds',String(warmup),'-SampleSeconds',String(seconds)],{windowsHide:true,timeout:(warmup+seconds+45)*1000,maxBuffer:1024*1024})
    // Keep a handler attached while the smoke probe waits for its baseline.
    let samplingFailure:unknown;void sampling.catch(error=>{samplingFailure=error})
    let probe:number|undefined
    if(mode==='smoke'){
      await expect.poll(()=>{if(samplingFailure)throw samplingFailure;return existsSync(file)&&readFileSync(file,'utf8').includes('"phase":"baseline"')},{timeout:20000}).toBe(true)
      probe=await app.evaluate(()=>{const spawned=process.getBuiltinModule('child_process').spawn(process.execPath,['-e','setTimeout(()=>{const end=Date.now()+120;while(Date.now()<end){}},1600);setTimeout(()=>process.exit(0),2400)'],{windowsHide:true,stdio:'ignore',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});return spawned.pid})
    }
    await sampling
    const text=readFileSync(file,'utf8'),summary=summarizeResourceLog(text),after=await audit(),frames=text.trim().split(/\r?\n/).map(line=>JSON.parse(line)).filter(r=>r.kind==='frame')
    writeFileSync(join(run,'summary.json'),JSON.stringify({mode,summary,before,after,probe,formalG05:'NOT RUN: native-hidden windows and memory tray; no Portable launcher or visible-mode measurement'},null,2))
    expect(summary.status,JSON.stringify(summary.issues)).toBe('COMPLETE');expect(summary.sampleCount).toBe(seconds);expect(summary.sampleSeconds).toBeGreaterThanOrEqual(seconds)
    const ids=new Set(frames.flatMap(frame=>frame.processes.map((p:{pid:number})=>p.pid)))
    expect(ids.has(child.pid!)).toBe(true);expect(ids.has(identity.pid)).toBe(true)
    for(const metric of [...before.metrics,...after.metrics])expect(ids.has(metric.pid),`unobserved app metric PID ${metric.pid}`).toBe(true)
    expect(after.attempts).toEqual([]);expect(after.windows.map(w=>w.id)).toEqual(before.windows.map(w=>w.id));expect(after.windows.every(w=>!w.visible&&!w.focused&&!w.focusable)).toBe(true);expect(after.subscriptions).toBe(0)
    if(probe){expect(summary.events.some(e=>e.event==='exit'&&e.pid===probe)).toBe(true);expect(frames.some(f=>f.processes.some((p:{pid:number;cpuSeconds:number;exited:boolean})=>p.pid===probe&&p.exited&&p.cpuSeconds>0))).toBe(true)}
    console.log('D15 resource evidence:',JSON.stringify({mode,run,meanCpuPercent:summary.meanCpuPercent,p95CpuPercent:summary.p95CpuPercent,pws:summary.pws,identities:summary.processIdentities,sampleSeconds:summary.sampleSeconds}))
  }finally{
    if(child.exitCode===null){const closed=app.waitForEvent('close');await app.evaluate(({app,BrowserWindow})=>{(app as any).__workdayD08Test.windows.beginQuit();for(const w of BrowserWindow.getAllWindows())w.destroy();setImmediate(()=>app.exit(0))});await closed}
    expect(child.exitCode).toBe(0);expect(resolve(profile).startsWith(join(tmpdir(),'workday-d08-background-'))).toBe(true);rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100})
  }
})
