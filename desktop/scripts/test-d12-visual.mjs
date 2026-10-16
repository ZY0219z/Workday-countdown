import assert from 'node:assert/strict'
import {expect} from '@playwright/test'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {cpus} from 'node:os'
import {execFileSync} from 'node:child_process'

// Observe real native browser resources; wrappers delegate, never fake callbacks.
export async function installD12Instrumentation(page){await page.addInitScript(()=>{
  const observers=new Map(),Native=window.ResizeObserver,add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document),visibility=new Set(),raf=window.requestAnimationFrame.bind(window);let rafCalls=0,draws=0
  window.ResizeObserver=class extends Native{constructor(fn){super(fn);observers.set(this,new Set())}observe(target,options){observers.get(this).add(target);super.observe(target,options)}unobserve(target){observers.get(this).delete(target);super.unobserve(target)}disconnect(){observers.get(this).clear();super.disconnect()}}
  document.addEventListener=(name,fn,...args)=>{if(name==='visibilitychange')visibility.add(fn);return add(name,fn,...args)}
  document.removeEventListener=(name,fn,...args)=>{if(name==='visibilitychange')visibility.delete(fn);return remove(name,fn,...args)}
  window.requestAnimationFrame=(fn)=>{rafCalls++;return raf(fn)}
  const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(...args){draws++;return draw.apply(this,args)}
  window.__d12Resources=()=>({targets:[...observers.values()].reduce((n,set)=>n+set.size,0),visibilityListeners:visibility.size,rafCalls,draws})
})}

export async function runD12Visual({page,browser,check,goto,group,screenshot,directory,fixture}){
  const animated=page.locator('img.moyu-animated'),marker=page.locator('.fish-marker'),track=page.locator('.fish-track'),progress=page.locator('progress')
  const push=name=>page.evaluate(name=>window.__d11.push(name),name)
  const percent=value=>page.evaluate(value=>window.__d12.progress(value),value)
  async function stopped(){await expect(animated).toHaveCount(0);await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.ready==='true')}
  async function position(value){await expect(progress).toHaveAttribute('value',String(value));await expect.poll(()=>marker.evaluate((element,p)=>{const t=element.parentElement,actual=new DOMMatrix(getComputedStyle(element).transform).m41;return Math.abs(actual-p/100*Math.max(0,t.clientWidth-element.offsetWidth))<1},value)).toBe(true)}
  await goto()
  await check('original GIF really changes pixels; only one cat, correct source and aspect ratio',async()=>{
    await expect(animated).toBeVisible();await page.waitForFunction(()=>{const img=document.querySelector('img.moyu-animated');return img?.complete&&img.naturalWidth>0})
    assert.ok((await animated.getAttribute('src')).includes('moyu_original'));assert.equal(await page.locator('.we-countdown-illustration img,.we-countdown-illustration canvas').count(),1)
    const hashes=[];for(let i=0;i<5;i++){hashes.push(createHash('sha256').update(await animated.screenshot({animations:'allow'})).digest('hex'));await page.waitForTimeout(140)}
    assert.ok(new Set(hashes).size>1,'GIF must visibly change frames, not just have an animated attribute')
    await writeFile(resolve(directory,'gif-frame-hashes.json'),JSON.stringify({source:'original 226x217, 12 frames, 100ms/frame',hashes},null,2));await page.locator('.we-countdown-illustration').screenshot({path:resolve(directory,'d12-gif-frame.png')})
  })
  await check('zero, quarter, half, three-quarter and complete map to exact single-track positions',async()=>{for(const p of [0,25,50,75,100]){await percent(p);await position(p);await expect(page.locator('.dashboard-progress-heading strong')).toHaveText(p+'%')}assert.equal(await track.count(),1)})
  await check('overtime rollback follows actual D09 progress backwards; timer stays supplied',async()=>{
    await push('working');await position(fixture.snapshots.working.progress.percent);const prior=await marker.evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).m41)
    await push('rollback');await position(fixture.snapshots.rollback.progress.percent);assert.ok(await marker.evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).m41)<prior)
    await page.evaluate(()=>window.__d11.tick(1));await expect(page.getByRole('timer')).toHaveText('00:00:01')
  })
  await check('lunch freezes true net progress and replaces GIF with one static raster',async()=>{
    const old=await animated.elementHandle();await push('break');await stopped();assert.equal(await old.evaluate(img=>img.getAttribute('src')),null);assert.equal(await old.evaluate(img=>img.isConnected),false)
    await position(fixture.snapshots.break.progress.percent);const before=await page.locator('canvas').evaluate(canvas=>canvas.toDataURL());await page.waitForTimeout(420);assert.equal(await page.locator('canvas').evaluate(canvas=>canvas.toDataURL()),before)
    const draws=await page.evaluate(()=>window.__d12Resources().draws);await page.waitForTimeout(420);assert.equal(await page.evaluate(()=>window.__d12Resources().draws),draws)
  })
  await check('before work, finished, rest, and null use static states without fabricated progress',async()=>{
    for(const name of ['beforeWork','finished','rest']){await push(name);await stopped();const expected=fixture.snapshots[name].progress;if(expected)await position(expected.percent);else{await expect(track).toHaveCount(0);await expect(progress).toHaveCount(0);await expect(page.locator('.dashboard-progress-heading strong')).toHaveText('无工作进度')}}
    await push('working');await percent(null);await stopped();await expect(track).toHaveCount(0);await expect(progress).toHaveCount(0)
    await push('overtime');await expect(animated).toBeVisible();await position(fixture.snapshots.overtime.progress.percent)
  })
  await check('native-hidden DTO stops GIF even while document remains visible; resume snaps to latest value',async()=>{
    assert.equal(await page.evaluate(()=>document.visibilityState),'visible');const old=await animated.elementHandle();await page.evaluate(()=>window.__d12.visibility(false));await stopped();assert.equal(await old.evaluate(img=>img.getAttribute('src')),null)
    await percent(75);await position(75);await page.evaluate(()=>window.__d12.visibility(true));await expect(animated).toBeVisible();await percent(25);await expect(marker).not.toHaveClass(/fish-marker--moving/);await position(25)
  })
  await check('system or application motion reduction removes the GIF source and any transition',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});await stopped();await percent(70);assert.equal(await marker.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await position(70)
    await page.emulateMedia({reducedMotion:'no-preference'});await expect(animated).toBeVisible();await group('appearance');await page.getByLabel('减少动画',{exact:true}).check();await page.getByRole('button',{name:'保存设置',exact:true}).click();await stopped();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-reduced-motion','true')
    await group('appearance');await page.getByLabel('减少动画',{exact:true}).uncheck();await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(animated).toBeVisible()
  })
  await check('all themes, 720/640/480/360 sizes, marker endpoints and GIF proportion remain readable',async()=>{
    await goto();await page.emulateMedia({reducedMotion:'no-preference'})
    for(const mode of ['light','dark'])for(const accent of ['ocean','coral']){await group('appearance');await page.getByLabel('显示模式',{exact:true}).selectOption(mode);await page.getByLabel('配色',{exact:true}).selectOption(accent);await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(animated).toBeVisible()
      for(const width of [720,640,480,360]){await page.setViewportSize({width,height:780});for(const value of [0,100]){await percent(value);await position(value);assert.equal(await marker.evaluate(el=>{const box=el.getBoundingClientRect(),track=el.parentElement.getBoundingClientRect();return box.left>=track.left-1&&box.right<=track.right+1}),true)}
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);const box=await animated.boundingBox();assert.ok(Math.abs(box.width/box.height-226/217)<.01)
      }
      await page.setViewportSize({width:720,height:780});await percent(62.5);await position(62.5);await screenshot(`d12-dashboard-${accent}-${mode}.png`)
    }
    await page.setViewportSize({width:360,height:560});await screenshot('d12-dashboard-narrow.png');await page.setViewportSize({width:720,height:780})
    await track.evaluate(el=>{el.style.width='16px'});await percent(100);await position(100);assert.equal(await marker.evaluate(el=>el.offsetWidth<=el.parentElement.clientWidth),true);await track.evaluate(el=>el.style.removeProperty('width'))
  })
  await check('missing calendar estimate and forced colors keep numeric progress, text and boundaries',async()=>{
    await push('estimate');await expect(page.locator('.dashboard-progress')).toContainText('2027');await expect(page.locator('.dashboard-progress')).toContainText('估算');await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await stopped();await percent(50);await position(50)
    assert.notEqual(await track.locator('.fish-water').evaluate(el=>getComputedStyle(el).borderTopStyle),'none');await expect(page.getByRole('progressbar',{name:'有效工作进度'})).toHaveAttribute('value','50');await screenshot('d12-forced-colors.png');await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'})
  })
  await check('100 settings/dashboard mounts release observers and never accumulate intervals or visibility listeners',async()=>{
    await goto();await page.waitForFunction(()=>window.__d12Resources().targets===2);const initial=await page.evaluate(()=>window.__d12Resources())
    for(let i=0;i<100;i++){await group('schedule');assert.equal(await page.evaluate(()=>window.__d12Resources().targets),0);await page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}).click()}
    await page.waitForFunction(()=>window.__d12Resources().targets===2);const final=await page.evaluate(()=>window.__d12Resources());assert.equal(final.visibilityListeners,initial.visibilityListeners);assert.equal(final.visibilityListeners,1);assert.equal(await page.evaluate(()=>window.__d12.listeners()),1);assert.equal(await page.evaluate(()=>window.__d11.intervals()),0);assert.equal(final.rafCalls,0)
    await writeFile(resolve(directory,'lifecycle-observation.json'),JSON.stringify({mounts:100,initial,final},null,2))
  })
  await check('short animated/static/hidden CPU and private-working-set comparison is recorded, not G05 certification',async()=>{
    await goto();await page.emulateMedia({reducedMotion:'no-preference'});await expect(animated).toBeVisible()
    const cdp=await browser.newBrowserCDPSession(),phases=[],cores=cpus().length
    for(const phase of ['animated','reduced','hidden']){
      await page.emulateMedia({reducedMotion:phase==='reduced'?'reduce':'no-preference'});await page.evaluate(visible=>window.__d12.visibility(visible),phase!=='hidden')
      if(phase==='animated')await expect(animated).toBeVisible();else await stopped();await page.waitForTimeout(1000)
      const startedAt=new Date().toISOString();let prior=await cdp.send('SystemInfo.getProcessInfo'),at=performance.now();const cpu=[]
      for(let i=0;i<5;i++){await page.waitForTimeout(1000);const current=await cdp.send('SystemInfo.getProcessInfo'),now=performance.now(),times=new Map(prior.processInfo.map(p=>[p.id,p.cpuTime]));cpu.push(current.processInfo.reduce((total,p)=>total+Math.max(0,p.cpuTime-(times.get(p.id)??p.cpuTime)),0)/((now-at)/1000*cores)*100);prior=current;at=now}
      let memory;try{const ids=prior.processInfo.map(p=>Number(p.id)).filter(Number.isSafeInteger),filter=ids.map(id=>`IDProcess=${id}`).join(' OR ');const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',`$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter '${filter}' | Select-Object IDProcess,WorkingSetPrivate) | ConvertTo-Json -Compress`],{windowsHide:true,timeout:15000,encoding:'utf8'});const rows=[JSON.parse(text)].flat();memory={status:'MEASURED',requestedPids:ids,rows,processes:rows.length,privateWorkingSetMiB:rows.reduce((n,row)=>n+Number(row.WorkingSetPrivate),0)/1048576};assert.ok(rows.length>0)}catch(error){memory={status:'NOT RUN',reason:'Private Working Set unavailable in current context'}}
      const ordered=cpu.toSorted((a,b)=>a-b);phases.push({phase,startedAt,endedAt:new Date().toISOString(),processInfo:prior.processInfo,samples:cpu,meanCpuPercent:cpu.reduce((a,b)=>a+b,0)/cpu.length,p95CpuPercent:ordered.at(-1),memory,resources:await page.evaluate(()=>window.__d12Resources())})
    }
    await cdp.detach();await writeFile(resolve(directory,'resource-observation.json'),JSON.stringify({scope:'owned Headless Edge browser process family only, not Electron or G05',warmupSeconds:1,sampleSeconds:5,logicalCores:cores,phases},null,2));await page.evaluate(()=>window.__d12.visibility(true))
    assert.equal(await page.evaluate(()=>window.__d11.intervals()),0);assert.equal(await page.evaluate(()=>window.__d12Resources().rafCalls),0)
  })
  await check('root component unmount releases all native/document listeners, observers and GIF sources',async()=>{
    await goto();await expect(animated).toBeVisible();const image=await animated.elementHandle()
    await page.evaluate(()=>document.getElementById('app').__vue_app__.unmount())
    await expect.poll(()=>page.evaluate(()=>window.__d12.listeners())).toBe(0)
    const resources=await page.evaluate(()=>window.__d12Resources());assert.equal(resources.targets,0);assert.equal(resources.visibilityListeners,0);assert.equal(await image.evaluate(el=>el.getAttribute('src')),null);assert.equal(await page.locator('img.moyu-animated,canvas,progress').count(),0)
    await writeFile(resolve(directory,'unmount-observation.json'),JSON.stringify(resources,null,2))
  })
}
