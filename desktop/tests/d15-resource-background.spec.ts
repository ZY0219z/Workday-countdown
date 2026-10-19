import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,realpathSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn,execFile,type ChildProcess} from 'node:child_process'
import {promisify} from 'node:util'
import {seedFormalProfile} from './helpers/formal-fixture'
import {createNativeRpc,collectCleanup,type NativeRpc} from './helpers/d15-native-rpc.mjs'
import {verifyOwnedExit,type NativeExitState} from './helpers/d15-exit-verdict.mjs'
import {summarizeResourceLog,verifyMetricCoverage} from '../scripts/lib/resource-summary.mjs'

test('D15 resource snapshots and live metric hints cover the real hidden owned family',async({},info)=>{
  for(const file of ['d15-gui-lease.json','d08-gui-lease.json'])expect(existsSync(resolve('test-results',file))).toBe(false)
  const root=info.outputPath('evidence');mkdirSync(root,{recursive:true})
  const save=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2))
  const profile=mkdtempSync(join(tmpdir(),'workday-desktop-d15-resource-'));seedFormalProfile(profile)
  const configFile=join(profile,'lifecycle/settings.json'),config=JSON.parse(readFileSync(configFile,'utf8'));config.desktop.miniEnabled=true;writeFileSync(configFile,JSON.stringify(config))
  const before=readFileSync(configFile,'utf8')
  const env=Object.fromEntries(Object.entries(process.env).filter((pair):pair is [string,string]=>pair[1]!==undefined));delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_TEST_PROFILE
  env.WORKDAY_ESCAPE_TEST_MODE='1';env.WORKDAY_ESCAPE_TEST_BACKGROUND='1'
  let app:ElectronApplication|undefined,launcher:ChildProcess|undefined,native:NativeRpc|undefined,nativeExit:NativeExitState|undefined
  let identity:NativeExitState|undefined,mainPid:number|undefined,sampling:Promise<unknown>|undefined,primaryError:unknown
  try{
    app=await electron.launch({args:['.','--user-data-dir='+profile],env});launcher=app.process()
    const page=await app.firstWindow();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')
    mainPid=await app.evaluate(()=>process.pid)
    expect(await app.evaluate(({app})=>(app as any).__workdayD08Test.mini.prepare())).toMatchObject({ok:true})
    const driver=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',resolve('tests/helpers/d15-native-driver.ps1'),'-OwnerProcessId',String(mainPid),'-LauncherProcessId',String(launcher.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    driver.stderr!.on('data',data=>writeFileSync(join(root,'native-audit.jsonl'),data,{flag:'a'}))
    native=createNativeRpc(driver);identity=(await native.ready).identity
    const initialFamily=await native.request({action:'family'})
    const observe=()=>app!.evaluate(({app,BrowserWindow})=>({at:Date.now(),metrics:app.getAppMetrics(),
      windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable(),prefs:(w.webContents as any).getLastWebPreferences()})),
      attempts:(app as any).__workdayD08Test.interactiveAttempts(),userData:app.getPath('userData'),background:(app as any).__workdayD08Test.background}))
    const beforeWindow=await observe();expect(beforeWindow.background).toBe(true);expect(beforeWindow.userData).toBe(join(profile,'lifecycle'))
    expect(beforeWindow.windows).toHaveLength(2)
    for(const w of beforeWindow.windows){expect(w).toMatchObject({visible:false,focused:false,focusable:false});expect(w.prefs).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true})}
    const feed=join(root,'metrics.jsonl'),file=join(root,'resources.jsonl'),observations:Awaited<ReturnType<typeof observe>>[]=[]
    const record=(point:Awaited<ReturnType<typeof observe>>)=>{observations.push(point);writeFileSync(feed,JSON.stringify({at:point.at,metrics:point.metrics})+'\n',{flag:'a'})}
    record(beforeWindow)
    let complete=false,failure:unknown,probe:number|undefined
    sampling=promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',resolve('scripts/measure-owned-processes.ps1'),'-RootProcessId',String(launcher.pid),'-ElectronProcessId',String(mainPid),'-OutputFile',file,'-MetricsFile',feed,'-Mode','background','-WarmupSeconds','0','-SampleSeconds','10'],{windowsHide:true,timeout:35000,maxBuffer:1048576})
    void sampling.then(()=>{complete=true},error=>{failure=error;complete=true})
    while(!complete){
      record(await observe())
      if(!probe&&existsSync(file)&&readFileSync(file,'utf8').includes('"phase":"baseline"')){
        // A finite, owned Node child verifies retained final CPU/exit handling.
        // It is not labelled as an Electron GPU or used to substitute PWS.
        probe=await app.evaluate((_electron,node)=>process.getBuiltinModule('child_process').spawn(node,['-e','setTimeout(()=>{let n=0;for(let i=0;i<1000000;i++)n+=i},500);setTimeout(()=>process.exit(0),1800)'],{windowsHide:true,stdio:'ignore'}).pid,realpathSync(process.execPath))
        await native.request({action:'family'})
      }
      await new Promise(done=>setTimeout(done,250))
    }
    try{await sampling}catch(error){save('sampler-failure',{error:String(error)});throw error}
    if(failure)throw failure
    const raw=readFileSync(file,'utf8'),summary=summarizeResourceLog(raw),coverage=verifyMetricCoverage(raw,observations)
    const frames=raw.trim().split(/\r?\n/).map(line=>JSON.parse(line)).filter(row=>row.kind==='frame')
    const gpuIdentities=observations.flatMap(point=>point.metrics.filter(p=>p.type==='GPU').map(p=>({pid:p.pid,creationTime:p.creationTime})))
    save('sampling',{summary,coverage,gpuIdentities,observations,initialFamily,mainPid,launcherPid:launcher.pid,probe,profile,formalG05:'NOT RUN: hidden tool validation only'})
    expect(summary.status,JSON.stringify(summary.issues)).toBe('COMPLETE');expect(coverage.status,JSON.stringify(coverage)).toBe('COMPLETE')
    expect(summary.sampleCount).toBe(10);expect(summary.sampleSeconds).toBeGreaterThanOrEqual(10);expect(gpuIdentities.length).toBeGreaterThan(0)
    for(const type of ['Browser','Tab','GPU','Utility'])expect(observations.some(p=>p.metrics.some(m=>m.type===type)),type).toBe(true)
    for(const point of observations){expect(point.attempts).toEqual([]);for(const w of point.windows)expect(w).toMatchObject({visible:false,focused:false,focusable:false})}
    const rows=frames.flatMap(f=>f.processes)
    for(const pid of [mainPid,launcher.pid])expect(rows.some(p=>p.pid===pid)).toBe(true)
    expect(rows.some(p=>p.pid===probe&&p.exited&&p.exitCode===0&&p.cpuSeconds>0&&p.pwsBytes===null)).toBe(true)
    expect(rows.every(p=>Number.isFinite(p.cpuSeconds)&&p.cpuSeconds>=0&&(p.exited||Number.isFinite(p.pwsBytes)&&p.pwsBytes>=0))).toBe(true)
    expect(readFileSync(configFile,'utf8')).toBe(before)
    console.log(JSON.stringify({mainPid,launcherPid:launcher.pid,coverage:coverage.status,gpuIdentities:[...new Set(gpuIdentities.map(p=>p.pid))],identities:summary.processIdentities,samples:summary.sampleCount,hidden:true}))
  }catch(error){primaryError=error;save('primary-error',{error:String(error)});throw error}
  finally{
    const errors=await collectCleanup([
      {name:'finish owned sampler',milliseconds:40000,run:async()=>{if(sampling)await sampling}},
      {name:'controlled app close',milliseconds:12000,run:async()=>{if(app&&launcher?.exitCode===null)await app.close()}},
      {name:'native exits',milliseconds:12000,run:async()=>{
        if(native&&identity&&launcher){await expect.poll(()=>launcher!.exitCode,{timeout:5000}).toBe(0);nativeExit=await native.request({action:'ownerExit'});let family:any;await expect.poll(async()=>{family=await native!.request({action:'family'});return family.processes.every((p:any)=>p.state.exited)},{timeout:5000}).toBe(true);const verdict=verifyOwnedExit(launcher,nativeExit!,identity);save('exit',{mainPid,launcherPid:launcher.pid,identity,nativeExit,verdict,family});expect(verdict.status).toBe('PASS');expect(family.processes.every((p:any)=>p.state.exitCode===0)).toBe(true)}else{throw Error('Native exit evidence unavailable')}
      }},
      {name:'close driver',milliseconds:6000,run:async()=>{await native?.close()}},
      {name:'profile cleanup',milliseconds:4000,run:async()=>{if(nativeExit?.exited&&launcher?.exitCode===0){expect(profile.startsWith(join(tmpdir(),'workday-desktop-d15-resource-'))).toBe(true);rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}}
    ])
    save('cleanup',{errors,driver:native?.state(),profileExists:existsSync(profile),primaryError:primaryError?String(primaryError):null})
    expect(errors).toEqual([])
    for(const file of ['d15-gui-lease.json','d08-gui-lease.json'])expect(existsSync(resolve('test-results',file))).toBe(false)
  }
})
