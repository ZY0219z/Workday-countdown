import assert from 'node:assert/strict'
import {expect} from '@playwright/test'
import {readFile,writeFile} from 'node:fs/promises'
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

export async function runD12Visual({page,browser,check,goto,group,screenshot,directory,fixture,defaultSize}){
  const viewport={width:defaultSize.width,height:defaultSize.height-60}
  const animated=page.locator('img.moyu-animated'),marker=page.locator('.fish-marker'),track=page.locator('.fish-track'),progress=page.locator('progress')
  const push=name=>page.evaluate(name=>window.__d11.push(name),name)
  const percent=value=>page.evaluate(value=>window.__d12.progress(value),value)
  async function stopped(){await expect(animated).toHaveCount(0);await expect(page.locator('.fish-mascot--floating,.fish-waves--flowing')).toHaveCount(0);await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.ready==='true');const styles=await page.locator('.fish-wave-path,.fish-wave').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).animationName));assert.ok(styles.every(name=>name==='none'));const running=await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').map(a=>({name:a.animationName,target:a.effect.target.className,connected:a.effect.target.isConnected,css:getComputedStyle(a.effect.target).animationName,parent:a.effect.target.parentElement.className,parentDisplay:getComputedStyle(a.effect.target.parentElement).display})));assert.equal(running.length,0,JSON.stringify(running));if(await page.locator('.fish-waves').count())assert.equal(await page.locator('.fish-waves').evaluate(el=>getComputedStyle(el).animationName),'none')}
  async function position(value){await expect(progress).toHaveAttribute('value',String(value));await expect.poll(()=>marker.evaluate((element,p)=>{const t=element.parentElement,actual=new DOMMatrix(getComputedStyle(element).transform).m41;return Math.abs(actual-p/100*Math.max(0,t.clientWidth-element.offsetWidth))<1},value)).toBe(true)}
  await goto()
  await check('original GIF really changes pixels; only one cat, correct source and aspect ratio',async()=>{
    await expect(animated).toBeVisible();await page.waitForFunction(()=>{const img=document.querySelector('img.moyu-animated');return img?.complete&&img.naturalWidth>0})
    assert.ok((await animated.getAttribute('src')).includes('moyu_original'));assert.equal(await page.locator('.fish-marker img').count(),1);assert.equal(await page.locator('.we-countdown-illustration').count(),0)
    // Isolate GIF pixels from the independently tested CSS bobbing motion.
    await page.locator('.fish-mascot').evaluate(el=>{el.style.animation='none'})
    const hashes=[];for(let i=0;i<5;i++){hashes.push(createHash('sha256').update(await animated.screenshot({animations:'allow'})).digest('hex'));await page.waitForTimeout(140)}
    assert.ok(new Set(hashes).size>1,'GIF must visibly change frames, not just have an animated attribute')
    await writeFile(resolve(directory,'gif-frame-hashes.json'),JSON.stringify({source:'original 226x217, 12 frames, 100ms/frame; CSS float disabled only during pixel sampling',hashes},null,2));await animated.screenshot({path:resolve(directory,'d12-r4-gif-frame.png')});await page.locator('.fish-mascot').evaluate(el=>el.style.removeProperty('animation'))
  })
  await check('three independent 32px square waves match the original alpha contour, not a stretched texture',async()=>{
    const waves=page.locator('.fish-wave'),paths=page.locator('.fish-wave-path');assert.equal((await page.locator('.fish-water').boundingBox()).height,32);await expect(waves).toHaveCount(3);await expect(paths).toHaveCount(3)
    const source='data:image/png;base64,'+(await readFile(resolve('../assets/image/wave-fin.png'))).toString('base64')
    const contour=await page.evaluate(async source=>{
      const original=new Image();original.src=source;await original.decode()
      const panel=document.createElement('div');panel.id='wave-shape-proof';Object.assign(panel.style,{position:'fixed',left:'20px',top:'20px',padding:'20px',display:'flex',gap:'28px',background:'#2196f3',color:'white',zIndex:'9999'})
      const reference=document.createElement('canvas');reference.width=reference.height=32;reference.id='wave-original-32';const ctx=reference.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(original,0,0,32,32);ctx.globalCompositeOperation='source-in';ctx.fillStyle='white';ctx.fillRect(0,0,32,32)
      const sprite=document.querySelector('.fish-wave').cloneNode(true);sprite.id='wave-vue-32';Object.assign(sprite.style,{position:'relative',display:'block',left:'0',top:'0',animation:'none',transform:'none'})
      for(const [label,node]of [['Original alpha / 32x32',reference],['Production sprite / 32x32',sprite]]){const cell=document.createElement('div'),text=document.createElement('p');text.textContent=label;text.style.margin='0 0 12px';cell.append(text,node);panel.append(cell)}document.body.append(panel)
      const css=getComputedStyle(sprite),box=sprite.getBoundingClientRect();return{sourceWidth:original.width,sourceHeight:original.height,width:box.width,height:box.height,maskSize:css.maskSize,repeat:css.maskRepeat}
    },source)
    try{
      assert.deepEqual(contour,{sourceWidth:200,sourceHeight:200,width:32,height:32,maskSize:'32px 32px',repeat:'no-repeat'})
      await page.locator('#wave-shape-proof').screenshot({path:resolve(directory,'wave-shape-comparison.png')})
      const reference=await page.locator('#wave-original-32').screenshot(),actual=await page.locator('#wave-vue-32').screenshot()
      const similarity=await page.evaluate(async urls=>{const pixels=await Promise.all(urls.map(async url=>{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,32,32).data}));let delta=0,intersection=0,union=0;for(let i=0;i<pixels[0].length;i+=4){for(let c=0;c<3;c++)delta+=Math.abs(pixels[0][i+c]-pixels[1][i+c]);const a=pixels[0][i]>120,b=pixels[1][i]>120;if(a&&b)intersection++;if(a||b)union++}return{meanChannelDelta:delta/(32*32*3),contourIntersectionOverUnion:intersection/union}},[reference,actual].map(buffer=>'data:image/png;base64,'+buffer.toString('base64')))
      assert.ok(similarity.meanChannelDelta<8);assert.ok(similarity.contourIntersectionOverUnion>.8)
      await writeFile(resolve(directory,'wave-original-32.png'),reference);await writeFile(resolve(directory,'wave-vue-32.png'),actual);await writeFile(resolve(directory,'wave-shape.json'),JSON.stringify({contour,similarity,reference:'Original PNG alpha converted to white at the Python 32x32 size; browser resampling, not a Tk screenshot'},null,2))
    }finally{await page.locator('#wave-shape-proof').evaluate(el=>el.remove())}
    assert.equal(await page.locator('.fish-fill').evaluate(el=>getComputedStyle(el).overflow),'hidden');assert.equal(await page.locator('.fish-water').evaluate(el=>getComputedStyle(el).overflow),'hidden')
  })
  await check('live T0/T1/T2 frames show three separate waves flowing right and swaying independently',async()=>{
    await percent(62.5);await position(62.5)
    // Start the real CSS animations at a common known time. Then let the
    // browser clock run freely: no seeking/pausing between these live frames.
    await page.locator('.fish-wave-path,.fish-wave').evaluateAll(elements=>{const start=document.timeline.currentTime-300;for(const el of elements)for(const a of el.getAnimations()){a.startTime=start;a.play()}})
    const fill=await page.locator('.fish-fill').boundingBox(),cat=await marker.boundingBox(),water=await page.locator('.fish-water').boundingBox(),clip={x:water.x,y:water.y,width:Math.floor(cat.x-water.x),height:water.height},frames=[],hashes=[],started=Date.now()
    for(const second of [0,.4,1,1.4,2]){await page.waitForTimeout(Math.max(0,second*1000-(Date.now()-started)))
      const frame=await page.locator('.fish-wave').evaluateAll(elements=>({time:performance.now(),waves:elements.map(el=>{const box=el.getBoundingClientRect(),path=el.parentElement,m=new DOMMatrix(getComputedStyle(el).transform),flow=path.getAnimations()[0],css=getComputedStyle(el);return{x:box.x,y:box.y,width:box.width,height:box.height,cssWidth:css.width,cssHeight:css.height,swayX:m.m41,swayY:m.m42,flowTime:flow.currentTime,delay:flow.effect.getTiming().delay,duration:flow.effect.getTiming().duration,swayDuration:el.getAnimations()[0].effect.getTiming().duration,repeat:css.maskRepeat}})}))
      const buffer=await page.screenshot({clip,animations:'allow'});hashes.push(createHash('sha256').update(buffer).digest('hex'));await writeFile(resolve(directory,`wave-live-t${second}.png`),buffer);await page.locator('.dashboard-progress').screenshot({path:resolve(directory,`progress-live-t${second}.png`),animations:'allow'});frames.push({second,...frame})
      assert.deepEqual(await page.locator('.fish-fill').boundingBox(),fill);assert.equal((await marker.boundingBox()).x,cat.x)
      for(const wave of frame.waves){assert.equal(wave.cssWidth,'32px');assert.equal(wave.cssHeight,'32px');assert.ok(Math.abs(wave.width-32)<.01&&Math.abs(wave.height-32)<.01);assert.equal(wave.duration,3000);assert.ok(Math.abs(wave.swayY)<=4.01);assert.equal(wave.repeat,'no-repeat')}
      assert.ok(new Set(frame.waves.map(w=>Math.round(w.swayY*10))).size>1)
    }
    assert.equal(new Set(hashes).size,5,'wave-only crops must actually change, without relying on GIF pixels')
    for(let i=0;i<3;i++){for(let t=1;t<frames.length;t++){let dx=frames[t].waves[i].x-frames[t-1].waves[i].x;if(dx<0)dx+=fill.width;const expected=fill.width*(frames[t].time-frames[t-1].time)/3000;assert.ok(Math.abs(dx-expected)<10,'each sprite advances right; wrap is unwrapped by identity')}
      assert.ok(Math.max(...frames.map(f=>f.waves[i].y))-Math.min(...frames.map(f=>f.waves[i].y))>1,'each of the three sprites must actually sway vertically')}
    assert.equal(new Set(frames[0].waves.map(w=>w.swayDuration)).size,3)
    const occlusion=await page.evaluate(()=>{const group=document.querySelector('.fish-waves'),fill=document.querySelector('.fish-fill').getBoundingClientRect(),cat=document.querySelector('.fish-marker').getBoundingClientRect(),clip=getComputedStyle(group).clipPath;return{clip,fillRight:fill.right,catLeft:cat.left}});assert.match(occlusion.clip,/inset/);assert.ok(Math.abs(occlusion.fillRight-parseFloat(occlusion.clip.split(' ')[1])-occlusion.catLeft)<1);assert.equal(await marker.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))}),true)
    await writeFile(resolve(directory,'wave-live-motion.json'),JSON.stringify({clock:'real browser timeline, freely running between samples',frames,hashes,fill,cat,clip,occlusion},null,2))
  })
  await check('D14 regression: positive low progress keeps original waves visible without a fill-width threshold',async()=>{
    const samples=[]
    for(const p of [1,5,10,15]){
      await percent(p);await position(p);await expect(page.locator('.fish-wave')).toHaveCount(3)
      assert.equal(await page.locator('.fish-waves').evaluate(el=>getComputedStyle(el).visibility),'visible')
      const water=await page.locator('.fish-water').boundingBox(),cat=await marker.boundingBox(),fill=await page.locator('.fish-fill').boundingBox()
      const clip={x:water.x,y:water.y,width:Math.floor(cat.x-water.x),height:water.height};assert.ok(clip.width>0)
      const frames=[]
      for(const time of [450,1050]){
        await page.locator('.fish-wave-path,.fish-wave').evaluateAll((elements,time)=>{for(const el of elements)for(const a of el.getAnimations()){a.pause();a.currentTime=time}},time)
        const bytes=await page.screenshot({clip,animations:'allow'});await writeFile(resolve(directory,`low-progress-${p}-t${time}.png`),bytes)
        const white=await page.evaluate(async url=>{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<data.length;i+=4)if(data[i]>200&&data[i+1]>200&&data[i+2]>200)count++;return count},'data:image/png;base64,'+bytes.toString('base64'))
        frames.push({time,white,hash:createHash('sha256').update(bytes).digest('hex')})
      }
      assert.ok(frames.some(f=>f.white>0),'actual low-fill pixels must contain the original white sprite, not just an invisible DOM layer');assert.notEqual(frames[0].hash,frames[1].hash,'low-fill wave-only frames must change')
      if(p===5)await screenshot('dashboard-low-progress.png');samples.push({percent:p,fillWidth:fill.width,clip,frames})
    }
    await writeFile(resolve(directory,'low-progress-waves.json'),JSON.stringify(samples,null,2))
    await percent(62.5);await position(62.5);await page.locator('.fish-wave-path,.fish-wave').evaluateAll(elements=>{for(const el of elements)for(const a of el.getAnimations())a.play()})
  })
  await check('each wave wraps invisibly at the edge while the original cat keeps its gentle vertical motion',async()=>{
    const path=page.locator('.fish-wave-path').first(),originalStart=await path.evaluate(el=>el.getAnimations()[0].startTime)
    const edges=[];for(const time of [1,2999]){await path.evaluate((el,time)=>{const a=el.getAnimations()[0];a.pause();a.currentTime=time},time);edges.push(await path.evaluate(el=>Number(getComputedStyle(el).opacity)))}assert.ok(edges.every(alpha=>alpha<.01));await path.evaluate((el,start)=>{const a=el.getAnimations()[0];a.startTime=start;a.play()},originalStart)
    const mascot=page.locator('.fish-mascot'),x=await marker.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41);await expect(mascot).toHaveClass(/fish-mascot--floating/);assert.equal(await mascot.evaluate(el=>getComputedStyle(el).animationDuration),'3s')
    const before=await mascot.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42);await page.waitForTimeout(450);const y=await mascot.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m42);assert.ok(y>=-1.51&&y<=.01);assert.notEqual(y,before);assert.equal(await marker.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).m41),x)
    await writeFile(resolve(directory,'wave-wrap.json'),JSON.stringify({edgeAlpha:edges,behaviour:'fade only at entering/leaving edges; stationary fill and cat x'},null,2))
  })
  await check('compact dashboard has one-line title, corrected labels and no routine progress note or scrolling',async()=>{
    // Conservative content budget leaves 60 DIP for a native frame; exact
    // content bounds at 100% are separately checked in hidden Electron.
    await page.setViewportSize(viewport)
    await expect(page.locator('.app-header h1')).toHaveText('今天你摸鱼了吗');await expect(page.locator('.app-header p')).toHaveCount(0)
    for(const text of ['Workday Escape','上班摸一会，下班更近一步','有效工作进度 · 不含午休','最终下班：','摸一会鱼，下班就更近啦！'])await expect(page.locator('body')).not.toContainText(text)
    await expect(page.locator('.we-countdown-hint')).toHaveText('摸鱼一小步，下班一大步');await expect(page.locator('.we-countdown-target')).toContainText('下班时间：2026-10-15 18:00')
    const layout=await page.evaluate(()=>({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bottom:document.querySelector('.dashboard-metrics').getBoundingClientRect().bottom,headingHeight:document.querySelector('.app-header h1').getBoundingClientRect().height}))
    assert.ok(layout.scroll<=layout.height&&layout.scrollWidth<=layout.width);assert.ok(layout.height-layout.bottom>=16&&layout.height-layout.bottom<80);assert.ok(layout.headingHeight<=36)
    await screenshot('d12-r4-dashboard-compact.png');await writeFile(resolve(directory,'compact-layout.json'),JSON.stringify(layout,null,2));await page.setViewportSize(defaultSize)
  })
  await check('ordinary overtime, overnight and nonworking states also fit the compact content budget',async()=>{
    await page.setViewportSize(viewport)
    for(const state of ['beforeWork','break','overtime','overnight','finished','rest']){await push(state);assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true,state)}
    await push('working');await page.setViewportSize(defaultSize)
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
    await push('overtime');await expect(animated).toBeVisible();await expect(page.locator('.fish-waves')).toHaveClass(/fish-waves--flowing/);await position(fixture.snapshots.overtime.progress.percent)
  })
  await check('native-hidden DTO stops GIF even while document remains visible; resume snaps to latest value',async()=>{
    assert.equal(await page.evaluate(()=>document.visibilityState),'visible');const old=await animated.elementHandle();await page.evaluate(()=>window.__d12.visibility(false));await stopped();assert.equal(await old.evaluate(img=>img.getAttribute('src')),null)
    // D14 releases the hidden renderer's time subscription. Its DOM must stay
    // frozen, then the FIRST fresh result on resume still jumps without motion.
    await expect.poll(()=>page.evaluate(()=>window.__d13.subscriptions())).toBe(0)
    const prior=await progress.getAttribute('value'),timer=await page.getByRole('timer').innerText()
    await percent(75);await page.evaluate(()=>window.__d11.tick(9));await expect(progress).toHaveAttribute('value',prior);await expect(page.getByRole('timer')).toHaveText(timer);await stopped()
    await page.evaluate(()=>window.__d12.visibility(true));await expect(animated).toBeVisible();await position(75);await expect(page.getByRole('timer')).toHaveText('00:00:09');await expect(marker).not.toHaveClass(/fish-marker--moving/)
    await percent(25);await position(25)
  })
  await check('system or application motion reduction removes the GIF source and any transition',async()=>{
    await page.emulateMedia({reducedMotion:'reduce'});await stopped();await percent(70);assert.equal(await marker.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await position(70)
    await page.emulateMedia({reducedMotion:'no-preference'});await expect(animated).toBeVisible();await group('appearance');await page.getByLabel('减少动画',{exact:true}).check();await page.getByRole('button',{name:'保存设置',exact:true}).click();await stopped();await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-reduced-motion','true')
    await group('appearance');await page.getByLabel('减少动画',{exact:true}).uncheck();await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(animated).toBeVisible()
  })
  await check('all themes, 720/640/480/360 sizes, marker endpoints and GIF proportion remain readable',async()=>{
    await goto();await page.emulateMedia({reducedMotion:'no-preference'})
    for(const mode of ['light','dark'])for(const accent of ['ocean','coral']){await group('appearance');await page.getByLabel('显示模式',{exact:true}).selectOption(mode);await page.getByLabel('配色',{exact:true}).selectOption(accent);await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(animated).toBeVisible()
      for(const width of [720,640,480,360]){await page.setViewportSize({width,height:viewport.height});for(const value of [0,100]){await percent(value);await position(value);assert.equal(await marker.evaluate(el=>{const box=el.getBoundingClientRect(),track=el.parentElement.getBoundingClientRect();return box.left>=track.left-1&&box.right<=track.right+1}),true)}
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true);const box=await animated.boundingBox();assert.ok(Math.abs(box.width/box.height-226/217)<.01)
      }
      await page.setViewportSize(viewport);await percent(62.5);await position(62.5);await screenshot(`d12-r4-dashboard-${accent}-${mode}.png`)
    }
    await page.setViewportSize({width:360,height:560});await screenshot('d12-r4-dashboard-narrow.png');await page.setViewportSize(viewport)
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
    for(const phase of ['animated','staticWaves','reduced','hidden']){
      await page.emulateMedia({reducedMotion:phase==='reduced'?'reduce':'no-preference'});await page.evaluate(visible=>window.__d12.visibility(visible),phase!=='hidden')
      if(phase==='animated'||phase==='staticWaves')await expect(animated).toBeVisible();else await stopped();await page.locator('.fish-wave-path,.fish-wave').evaluateAll((elements,phase)=>{for(const el of elements){if(phase==='staticWaves')el.style.animation='none';else el.style.removeProperty('animation')}},phase);await page.waitForTimeout(1000)
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
