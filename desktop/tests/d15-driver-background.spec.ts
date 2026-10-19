import {test,expect,_electron as electron} from '@playwright/test'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn,type ChildProcess} from 'node:child_process'
import {seedFormalProfile} from './helpers/formal-fixture'
import {createNativeRpc,collectCleanup,type NativeRpc} from './helpers/d15-native-rpc.mjs'
import {verifyOwnedExit,type NativeExitState} from './helpers/d15-exit-verdict.mjs'

test('D15 driver identities and dead-RPC cleanup work with the real hidden Main',async({},info)=>{
  const profile=mkdtempSync(join(tmpdir(),'workday-desktop-d15-driver-'));seedFormalProfile(profile)
  const formal=join(profile,'lifecycle/settings.json'),before=readFileSync(formal,'utf8')
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined))
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;delete env.WORKDAY_ESCAPE_TEST_PROFILE
  env.WORKDAY_ESCAPE_TEST_MODE='1';env.WORKDAY_ESCAPE_TEST_BACKGROUND='1'
  let app:Awaited<ReturnType<typeof electron.launch>>|undefined,launcher:ChildProcess|undefined,native:NativeRpc|undefined,dead:NativeRpc|undefined
  let nativeExit:NativeExitState|undefined
  let primaryError:unknown
  try{
    app=await electron.launch({args:['.','--user-data-dir='+profile],env});launcher=app.process()
    const page=await app.firstWindow();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-pending','false')
    const mainPid=await app.evaluate(()=>process.pid)
    const hidden=async()=>app!.evaluate(({app,BrowserWindow})=>({background:(app as any).__workdayD08Test.background,
      windows:BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()})),
      attempts:(app as any).__workdayD08Test.interactiveAttempts()}))
    expect(await hidden()).toEqual({background:true,windows:[{visible:false,focused:false,focusable:false}],attempts:[]})
    expect(await app.evaluate(({app})=>app.getPath('userData'))).toBe(join(profile,'lifecycle'))
    const driver=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',resolve('tests/helpers/d15-native-driver.ps1'),'-OwnerProcessId',String(mainPid),'-LauncherProcessId',String(launcher.pid)],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    const journal=(event:unknown)=>writeFileSync(info.outputPath('rpc.jsonl'),JSON.stringify({at:Date.now(),event})+'\n',{flag:'a'})
    driver.stderr!.on('data',data=>writeFileSync(info.outputPath('native-identity-audit.jsonl'),data,{flag:'a'}))
    native=createNativeRpc(driver,{onRecord:journal});const ready=await native.ready
    expect(ready.identity.pid).toBe(mainPid)
    const initial=await native.request({action:'family'})
    for(let i=0;i<3;i++){
      expect((await native.request({action:'ownerExit'})).createdFileTime).toBe(ready.identity.createdFileTime)
      const family=await native.request({action:'family'});expect(family.processes.some((entry:any)=>entry.state.pid===launcher!.pid)).toBe(true)
    }
    // Actual closed Node transport, not a fake success path or native UI action.
    const helper=spawn(process.execPath,['-e',`process.stdout.write(JSON.stringify({ready:true,identity:{pid:process.pid}})+String.fromCharCode(10));process.stdin.resume();process.stdin.on('end',()=>process.exit(0))`],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    helper.stderr!.on('data',data=>writeFileSync(info.outputPath('node-helper-stderr.log'),data,{flag:'a'}))
    dead=createNativeRpc(helper);await dead.ready;await dead.close()
    const errors=await collectCleanup([
      {name:'dead driver diagnostic',milliseconds:1000,run:()=>dead!.request({action:'foreground'})},
      {name:'real controlled quit',milliseconds:10000,run:async()=>{expect(await hidden()).toEqual({background:true,windows:[{visible:false,focused:false,focusable:false}],attempts:[]});await app!.close()}}
    ])
    expect(errors).toHaveLength(1);expect(errors[0].step).toBe('dead driver diagnostic')
    await expect.poll(()=>launcher!.exitCode).toBe(0)
    nativeExit=await native.request({action:'ownerExit'});expect(nativeExit?.exited).toBe(true)
    const family=await native.request({action:'family'}),verdict=verifyOwnedExit(launcher,nativeExit!,ready.identity)
    expect(verdict.status,JSON.stringify(verdict)).toBe('PASS')
    expect(family.processes.every((entry:any)=>entry.state.exited&&entry.state.exitCode===0)).toBe(true)
    expect(readFileSync(formal,'utf8')).toBe(before)
    const closed=native.close();expect(native.close()).toBe(closed);await closed
    await expect(native.request({action:'family'})).rejects.toThrow('not available')
    writeFileSync(info.outputPath('result.json'),JSON.stringify({mainPid,launcherPid:launcher.pid,ready,initial,family,verdict,errors,driver:native.state(),deadDriver:dead.state(),profile,configurationUnchanged:true,hidden:true,interactiveAttempts:[]},null,2))
  }catch(error){primaryError=error;writeFileSync(info.outputPath('primary-error.json'),JSON.stringify({error:String(error)},null,2));throw error}finally{
    const errors=await collectCleanup([
      {name:'owned app quit fallback',milliseconds:10000,run:async()=>{if(app&&launcher?.exitCode===null)await app.close()}},
      {name:'native observer close',milliseconds:6000,run:async()=>{await native?.close()}},
      {name:'Node helper close',milliseconds:6000,run:async()=>{await dead?.close()}}
    ])
    // Preserve unknown/live process profiles for diagnosis; no force kills.
    if(nativeExit?.exited){expect(profile.startsWith(join(tmpdir(),'workday-desktop-d15-driver-'))).toBe(true);rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
    if(errors.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...errors.map(error=>Error(error.step+': '+error.message))],'hidden fixture cleanup failed; primary and cleanup errors retained')
  }
})
