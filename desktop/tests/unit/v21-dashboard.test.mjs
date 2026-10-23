import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures } from '../../test-results/d11-ssr/components.mjs'

test('UI-15 shared title and viewport layout preserve Dashboard visuals and pond behavior', async () => {
  const directory = resolve('test-results/v21-ui15/dashboard'), bundle = resolve(directory, 'bundle')
  await mkdir(directory, { recursive: true })
  await build({ configFile: false, plugins: [vue()], logLevel: 'warn', define: { 'process.env.NODE_ENV': '"production"' }, build: {
    outDir: bundle, emptyOutDir: false,
    lib: { entry: resolve('tests/unit/v21-dashboard.entry.mjs'), formats: ['es'], fileName: () => 'dashboard.mjs' }
  } })
  const files = await readdir(bundle), css = files.find(file => file.endsWith('.css'))
  assert.ok(css)
  const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
  const checks = [], errors = [], f = fixtures()
  let page
  try {
    page = await browser.newPage({ viewport: { width: 720, height: 580 } })
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    const serve = async route => {
      const path = new URL(route.request().url()).pathname.slice(1)
      if (!path) return route.fulfill({ contentType: 'text/html', body: `<html><head><link rel="stylesheet" href="/${css}"></head><body><div id="app"></div><script type="module" src="/dashboard.mjs"></script></body></html>` })
      if (path !== 'dashboard.mjs' && path !== css) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(resolve(bundle, path)) })
    }
    await page.route('http://dashboard.test/**', serve)
    await page.goto('http://dashboard.test/')
    await page.waitForFunction(() => typeof window.__dashboard === 'function')
    const set = async value => {
      await page.evaluate(value => window.__dashboard(value), value)
      await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.ready === 'true'))
    }
    const pixelDifference=async(first,second)=>page.evaluate(async sources=>{
      const decode=async source=>{const image=new Image();image.src='data:image/png;base64,'+source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,canvas.width,canvas.height)}
      const a=await decode(sources[0]),b=await decode(sources[1]);if(a.width!==b.width||a.height!==b.height)throw Error('frame size changed')
      let changed=0
      for(let i=0;i<a.data.length;i+=4)if([0,1,2,3].some(channel=>Math.abs(a.data[i+channel]-b.data[i+channel])>4))changed++
      const bottom=(Math.floor(a.width/2)+(a.height-4)*a.width)*4
      return {changed,total:a.width*a.height,ratio:changed/(a.width*a.height),bottomCentre:[...a.data.slice(bottom,bottom+4)]}
    },[first.toString('base64'),second.toString('base64')])
    const fits = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await expect(page.getByRole('heading', { name: '今天你摸鱼了吗', level: 1, exact: true })).toHaveCount(1)
      const heading = await page.locator('.app-title').evaluate(element => {
        const r=element.getBoundingClientRect(), buttons=document.querySelector('.app-header-actions').getBoundingClientRect()
        return {clear:r.right<=buttons.left||r.bottom<=buttons.top,selectable:getComputedStyle(element.querySelector('span')).userSelect!=='none',decorations:[...element.querySelectorAll('svg')].every(svg=>svg.getAttribute('aria-hidden')==='true')}
      })
      assert.ok(heading.clear&&heading.selectable&&heading.decorations, 'real HTML title and decorative SVGs stay clear of controls')
      const columns = await page.locator('.we-metric').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top))
      assert.ok(Math.max(...columns) - Math.min(...columns) <= 1, 'summary cards remain in three columns')
      const cards = await page.locator('.we-metric').count()
      assert.equal(cards, 3)
      for (const name of ['下个休息日', '下次预计发薪', '已工作']) await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1)
      await expect(page.getByRole('heading', { name: '在职自然日', exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: '今日工作进度', exact: true })).toHaveCount(0)
      await expect(page.getByRole('region', { name: '今日工作进度', exact: true })).toHaveCount(1)
      assert.equal(await page.locator('.we-metric h2').evaluateAll(headings => headings.every(heading => getComputedStyle(heading).textAlign === 'left')), true)
      const centres=await page.locator('.we-metric').evaluateAll(cards=>cards.map(card=>{
        const r=card.getBoundingClientRect(),middle=r.x+r.width/2
        return [...card.querySelectorAll('.we-metric-value,.we-metric-details')].map(element=>{const b=element.getBoundingClientRect();return Math.abs(b.x+b.width/2-middle)})
      }))
      assert.ok(centres.flat().every(offset=>offset<=1),'values with units and dates must be horizontally centred')
      await expect(page.locator('.we-time-label')).toHaveCount(0)
    }
    for (const theme of ['light', 'dark']) for (const accent of ['ocean', 'coral']) {
      await set({ snapshot: f.snapshots.working, theme, accent })
      await fits()
      assert.equal(await page.locator('.app-shell').evaluate(element => getComputedStyle(element).opacity), '1', 'decorative opacity must not affect the application')
      assert.equal(await page.locator('.dashboard-atmosphere img').evaluate(element => getComputedStyle(element).opacity), theme==='dark'?'0.22':'0.8')
      assert.equal(await page.locator('.we-metric-art').first().evaluate(element => getComputedStyle(element).opacity), theme==='dark'?'0.25':'0.8')
      await expect(page.locator('.we-metric').last()).toHaveText(/^\s*已工作\s*14\s*天\s*$/)
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect()
        const parts = [...document.querySelectorAll('.we-time-part')].map(element => element.getBoundingClientRect())
        const hero = rect('.we-countdown'), track = rect('.fish-track'), label = rect('.fish-readout-pill[data-active="true"]')
        return { timerCenter: (parts[0].left + parts.at(-1).right) / 2, heroCenter: hero.x + hero.width / 2,
          trackCenter: track.x + track.width / 2, labelCenter: label.x + label.width / 2,
          font: parseFloat(getComputedStyle(document.querySelector('.we-countdown-value')).fontSize), weight: getComputedStyle(document.querySelector('.we-countdown-value')).fontWeight, height: document.documentElement.scrollHeight }
      })
      await page.screenshot({ path: resolve(directory, `dashboard-${accent}-${theme}.png`), fullPage: true })
      assert.ok(geometry.font >= 88)
      assert.equal(geometry.weight, '700')
      await expect(page.locator('.we-time-label')).toHaveCount(0)
      assert.notEqual(await page.locator('.we-time-group').first().evaluate(element => getComputedStyle(element).color), await page.locator('.we-time-group--seconds').evaluate(element => getComputedStyle(element).color))
      assert.ok(Math.abs(geometry.timerCenter - geometry.heroCenter) <= 1)
      assert.ok(Math.abs(geometry.labelCenter - geometry.trackCenter) <= 1)
      assert.ok(geometry.height <= 580, JSON.stringify(geometry))
      checks.push(`${accent}/${theme}: approved clock hierarchy, tinted cards, accessible progress and default fit`)
    }
    for (const width of [680, 720, 480]) {
      await page.setViewportSize({ width, height: 580 })
      const snapshot = structuredClone(f.snapshots.working); snapshot.employment.elapsedNaturalDays = 462
      await set({ snapshot }); await fits()
      const card = page.locator('.we-metric').last()
      await expect(card.locator('.we-metric-details')).toHaveCount(0)
      await expect(card).toHaveText(/^\s*已工作\s*462\s*天\s*$/)
      const geometry = await card.evaluate(card => {
        const value = card.querySelector('.we-metric-value'), unit = value.querySelector('span'), range = document.createRange()
        range.selectNodeContents(value.firstChild)
        const number = range.getBoundingClientRect(), suffix = unit.getBoundingClientRect()
        return { layout: getComputedStyle(value).display, alignment: getComputedStyle(value).alignItems,
          numberBottom: number.bottom, unitTop: suffix.top, numberRight: number.right, unitLeft: suffix.left,
          heights: [...card.parentElement.children].map(element => element.getBoundingClientRect().height) }
      })
      assert.equal(geometry.layout, 'flex'); assert.equal(geometry.alignment, 'baseline')
      assert.ok(geometry.unitTop < geometry.numberBottom && geometry.unitLeft >= geometry.numberRight - 1)
      if (width >= 680) assert.ok(Math.max(...geometry.heights) - Math.min(...geometry.heights) <= 2, JSON.stringify(geometry))
      else assert.ok(geometry.heights[2] <= Math.max(...geometry.heights.slice(0, 2)), 'narrow cards may grow for real dates; the value-only card must not grow abnormally')
      if (width === 680) {
        await page.locator('.dashboard-metrics').screenshot({ path: resolve(directory, 'cards-462.png') })
        for (const [selector, name] of [['.dashboard-primary', 'hero-pond'], ['.we-metric:nth-child(1)', 'card-0'], ['.we-metric:nth-child(2)', 'card-1']]) {
          await page.locator(selector).screenshot({ path: resolve(directory, `${name}.png`) })
        }
      }
      checks.push(`${width}px / 462 days: no empty column, value/unit share a baseline; card heights ${geometry.heights.join('/')}`)
    }
    for (const status of ['notStarted', 'unset']) {
      const snapshot = structuredClone(f.snapshots.working)
      snapshot.employment.status = status; snapshot.employment.elapsedNaturalDays = status === 'unset' ? null : 0
      await set({ snapshot }); await fits()
      await expect(page.locator('.we-metric').last()).toContainText(status === 'unset' ? '尚未设置入职日期' : '尚未入职')
    }
    await page.setViewportSize({ width: 720, height: 580 })
    for (const state of ['beforeWork', 'break', 'overtime', 'overnight', 'finished', 'rest', 'estimate']) {
      await set({ snapshot: f.snapshots[state] })
      await fits()
      if (state === 'overnight') await expect(page.locator('.we-countdown-target')).toContainText('2026-10-16 06:00')
      if (state === 'estimate') {
        await expect(page.locator('.dashboard')).toContainText('2027')
        const heights = await page.locator('.we-metric').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height))
        assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, 'approved summary row stays uniform while notices expand naturally')
      }
      if (state === 'rest') await expect(page.locator('progress')).toHaveCount(0)
      if (['estimate', 'rest'].includes(state)) await page.screenshot({ path: resolve(directory, `dashboard-${state}.png`), fullPage: true })
      checks.push(`${state}: content reachable, no horizontal overflow`)
    }
    const widths = []
    for (const seconds of [11399, 11400, 40271]) {
      const snapshot = structuredClone(f.snapshots.working); snapshot.countdown.seconds = seconds
      await set({ snapshot })
      widths.push(await page.locator('.we-countdown-value').evaluate(element => [...element.querySelectorAll('.we-time-part')].map(part => part.getBoundingClientRect().width)))
    }
    assert.deepEqual(widths[0], widths[1]); assert.deepEqual(widths[1], widths[2])
    checks.push('tabular digits: widths stable across second/minute rollover and different glyphs')
    await set({ snapshot: null })
    await fits()
    await expect(page.locator('[role="timer"],progress')).toHaveCount(0)
    await expect(page.locator('.fish-idle')).toContainText('无工作进度')
    await expect(page.locator('.fish-surface')).toHaveCount(0)
    checks.push('unavailable: no fabricated countdown or zero progress')
    for (const width of [480, 360]) {
      await page.setViewportSize({ width, height: 580 })
      const snapshot = structuredClone(f.snapshots.working); snapshot.countdown.seconds = 360000
      await set({ snapshot })
      await fits()
      assert.equal((await page.locator('.we-time-part').allTextContents()).join(':'), '100:00:00')
      await expect(page.getByRole('timer')).toHaveAttribute('aria-label', /100:00:00/)
      await page.screenshot({ path: resolve(directory, `dashboard-${width}.png`), fullPage: true })
      checks.push(`${width}px: 100-hour stress and three cards reachable`)
      snapshot.employment.elapsedNaturalDays = 123456789
      await set({ snapshot })
      await fits()
      await expect(page.locator('.we-metric').last()).toContainText('123456789')
      checks.push(`${width}px: long natural-day value remains readable without horizontal overflow`)
    }
    const progressCases = [0, 1, 19.6, 27.6, 50, 78, 100]
    const checkPond = async percent => {
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
        const labels=[...document.querySelectorAll('.fish-readout-pill')].map(element=>({...element.getBoundingClientRect().toJSON(),opacity:Number(getComputedStyle(element).opacity),active:element.dataset.active==='true'}))
        return {track:rect('.fish-track'),fill:rect('.fish-fill'),fish:rect('.fish-marker'),water:rect('.fish-water'),surface:rect('.fish-surface--front'),inner:document.querySelector('.fish-water').clientWidth,labels}
      })
      const {track,fill,fish,water,surface,inner,labels}=geometry
      assert.ok(Math.abs(fill.width-inner*percent/100)<1,'fill retains the real percentage')
      assert.ok(Math.abs(fish.left-track.left-(track.width-fish.width)*percent/100)<1,'mascot retains the real progress position')
      assert.ok(fish.left>=water.left&&fish.right<=water.right)
      assert.ok(Math.abs(fish.y+fish.height/2-water.y-water.height/2)<1,'mascot remains vertically centred')
      assert.ok(fish.top>=water.top&&fish.bottom<=water.bottom,'complete GIF bounds fit inside the smaller tank')
      assert.equal(water.height,60);assert.equal(track.height,60);assert.equal(water.top,track.top)
      assert.equal(labels.filter(label=>label.active).length,1)
      assert.ok(labels.reduce((sum,label)=>sum+label.opacity,0)>=.99,'percentage never disappears during a handoff')
      for(const label of labels.filter(label=>label.opacity>.01||label.active)){
        assert.ok(label.left>=water.left+1&&label.right<=water.right-1&&label.top>=water.top&&label.bottom<=water.bottom,'capsule remains fully inside the tank')
        assert.ok(Math.abs(label.y+label.height/2-water.y-water.height/2)<1,'capsule never moves above or below the centre')
        assert.ok(fish.right<=label.left||fish.left>=label.right,'visible percentage and mascot do not overlap')
        const centre=water.x+water.width/2,centreLeft=centre-label.width/2
        if(fish.right+9<=centreLeft||fish.left-9>=centreLeft+label.width)assert.ok(Math.abs(label.x+label.width/2-centre)<1,'safe normal position stays at exact centre')
        if(Math.abs(label.x+label.width/2-centre)>1)assert.ok(Math.abs(label.left-fish.right-8)<1||Math.abs(fish.left-label.right-8)<1,'avoidance uses the nearest clear position beside the mascot')
      }
      assert.ok(Math.abs(surface.width-2*track.width)<1,'wave tiles do not shrink with the fill')
      await expect(page.locator('.fish-readout-pill[data-active="true"]')).toHaveText(`${percent}%`)
      await expect(page.locator('progress')).toHaveAttribute('aria-label','有效工作进度')
      assert.ok(Math.abs(Number(await page.locator('progress').getAttribute('value'))-percent)<1e-6)
      await expect(page.locator('.fish-endpoints')).toHaveCount(0)
      await expect(page.getByText('上班',{exact:true})).toHaveCount(0)
      await expect(page.getByText('下班',{exact:true})).toHaveCount(0)
      await expect(page.locator('.fish-surface')).toHaveCount(2)
      return geometry
    }
    for (const width of [720, 480, 360]) {
      await page.setViewportSize({ width, height: 580 })
      for (const percent of progressCases) {
        const snapshot = structuredClone(f.snapshots.working); snapshot.progress.percent = percent
        await set({ snapshot }); await fits(); await checkPond(percent)
        await page.screenshot({ path: resolve(directory, `pond-${width}-${percent}.png`), fullPage: true })
      }
      checks.push(`${width}px / 0,1,19.6,27.6,50,78,100%: true fill/position, vertical centre, bounded mascot, in-tank capsule with horizontal avoidance and no overlap, full-scale waves`)
    }
    await page.setViewportSize({ width: 720, height: 580 })
    const flow=structuredClone(f.snapshots.pond);flow.progress.percent=50
    await set({snapshot:flow,motionAllowed:true,reduced:false})
    // Exclude the independently animated GIF from wave pixel evidence only; normal UI/GIF checks keep it visible.
    const isolateWater=await page.addStyleTag({content:'.fish-marker,.fish-readout{visibility:hidden!important}'})
    const water=page.locator('.fish-water')
    const sample=()=>page.evaluate(()=>({at:performance.now(),fill:document.querySelector('.fish-fill').getBoundingClientRect().width,fish:document.querySelector('.fish-marker').getBoundingClientRect().x,layers:[...document.querySelectorAll('.fish-surface')].map(element=>({transform:getComputedStyle(element).transform,x:new DOMMatrixReadOnly(getComputedStyle(element).transform).m41,time:element.getAnimations()[0]?.currentTime,state:element.getAnimations()[0]?.playState}))}))
    const running0=await sample(),frame0=await water.screenshot({animations:'allow'})
    await page.waitForTimeout(1400) // Real elapsed time; production animation uses CSS only.
    const running1=await sample(),frame1=await water.screenshot({animations:'allow'})
    const runningPixels=await pixelDifference(frame0,frame1)
    assert.ok(runningPixels.changed>20,'running water must visibly change pixels')
    assert.ok(running0.layers.every((layer,index)=>layer.state==='running'&&running1.layers[index].transform!==layer.transform))
    assert.equal(running0.fill,running1.fill);assert.equal(running0.fish,running1.fish)
    await writeFile(resolve(directory,'water-running-t0.png'),frame0);await writeFile(resolve(directory,'water-running-t1.png'),frame1)
    await set({snapshot:flow,motionAllowed:false,reduced:false})
    const paused0=await sample(),pauseFrame0=await water.screenshot({animations:'allow'})
    await page.waitForTimeout(700)
    const paused1=await sample(),pauseFrame1=await water.screenshot({animations:'allow'})
    const pausedPixels=await pixelDifference(pauseFrame0,pauseFrame1)
    assert.equal(pausedPixels.changed,0,'paused water pixels stay still')
    assert.deepEqual(paused0.layers,paused1.layers)
    assert.ok(paused1.layers.every(layer=>layer.state==='paused'))
    await writeFile(resolve(directory,'water-paused-t0.png'),pauseFrame0);await writeFile(resolve(directory,'water-paused-t1.png'),pauseFrame1)
    await set({snapshot:flow,motionAllowed:true,reduced:false})
    const resumed=await sample()
    assert.ok(resumed.layers.every((layer,index)=>layer.time>=paused1.layers[index].time&&layer.time-paused1.layers[index].time<500),'resume continues the existing phase')
    const seam=async offset=>{
      await page.locator('.fish-surface').evaluateAll((elements,offset)=>{for(const element of elements){const animation=element.getAnimations()[0],timing=animation.effect.getTiming();animation.pause();animation.currentTime=timing.delay+timing.duration+offset}},offset)
      return water.screenshot({animations:'allow'})
    }
    const seamBefore=await seam(-0.01),seamStateBefore=await sample(),seamAfter=await seam(0.01),seamStateAfter=await sample()
    const seamPixels=await pixelDifference(seamBefore,seamAfter)
    assert.ok(seamPixels.ratio<0.005,'loop boundary must be visually continuous despite a full-tile transform wrap')
    assert.ok(seamStateBefore.layers.every((layer,index)=>Math.abs(layer.x-seamStateAfter.layers[index].x)>100))
    await writeFile(resolve(directory,'water-loop-before.png'),seamBefore);await writeFile(resolve(directory,'water-loop-after.png'),seamAfter)
    await writeFile(resolve(directory,'water-motion.json'),JSON.stringify({running0,running1,runningPixels,paused0,paused1,pausedPixels,resumed,seamStateBefore,seamStateAfter,seamPixels},null,2))
    // Release test-only timeline control before checking normal gates again.
    await page.locator('.fish-surface').evaluateAll(elements=>elements.forEach(element=>element.getAnimations()[0].play()))
    await isolateWater.evaluate(element=>element.remove())
    checks.push('real-time water frames change; paused pixels/time stay identical; resume retains phase; both repeated layers cross loop seam without a visible jump; fill and mascot position unchanged')
    await page.setViewportSize({width:360,height:580})
    const moving=structuredClone(f.snapshots.working)
    moving.progress.percent=45;await set({snapshot:moving,motionAllowed:true,reduced:false})
    moving.progress.percent=55;await set({snapshot:moving,motionAllowed:true,reduced:false})
    for(const delay of [0,40,80,170]){
      if(delay)await page.waitForTimeout(delay)
      await checkPond(55)
    }
    const stableSide=await page.locator('.fish-readout-pill[data-active="true"]').evaluate(element=>element===element.parentElement.firstElementChild?'left':'right')
    for(const percent of [49.9,50.1,49.8,50.2]){
      moving.progress.percent=percent;await set({snapshot:moving,motionAllowed:true,reduced:false});await checkPond(percent)
      assert.equal(await page.locator('.fish-readout-pill[data-active="true"]').evaluate(element=>element===element.parentElement.firstElementChild?'left':'right'),stableSide,'small midpoint jitter must not flip reading sides')
    }
    for(const percent of [100,0,50]){moving.progress.percent=percent;await set({snapshot:moving,motionAllowed:true,reduced:false});await checkPond(percent)}
    await page.setViewportSize({width:720,height:580});await set({snapshot:moving,motionAllowed:true,reduced:false});await checkPond(50)
    assert.equal(await page.locator('.fish-marker').evaluate(element=>getComputedStyle(element).transitionDuration),'0s') // No delayed position interpolation through the readout.
    checks.push('central crossing: both handoff copies remain in-tank and clear of the mascot, combined visibility stays >=1, midpoint hysteresis prevents left/right jitter; progress jumps and resize stay synchronous')
    for (const state of ['working', 'overtime', 'beforeWork', 'break', 'finished', 'rest']) {
      await set({ snapshot: f.snapshots[state], reduced: false, motionAllowed: true })
      await expect(page.locator('.moyu-animated')).toHaveCount(['working', 'overtime'].includes(state) ? 1 : 0)
      const playing=['working','overtime'].includes(state)
      assert.ok(await page.locator('.fish-surface').evaluateAll((elements,playing)=>elements.every(element=>getComputedStyle(element).animationPlayState===(playing?'running':'paused')),playing))
    }
    await set({ snapshot: f.snapshots.working, reduced: false, motionAllowed: false })
    await expect(page.locator('.moyu-animated')).toHaveCount(0)
    checks.push('GIF: working/overtime only; before-work/break/finished/rest and disabled visibility/motion gate stay static')
    await set({ snapshot: f.snapshots.working, reduced: false, motionAllowed: true })
    await expect(page.locator('.moyu-animated')).toHaveCount(1)
    await page.waitForFunction(() => { const image=document.querySelector('.moyu-animated');return image?.complete&&image.naturalWidth===226 })
    const pauseBob=await page.addStyleTag({content:'.fish-mascot{animation-play-state:paused!important}'})
    const firstFrame=await page.locator('.moyu-animated').screenshot()
    let changedFrame=null
    for(let attempt=0;attempt<6&&!changedFrame;attempt++){
      await page.waitForTimeout(120) // Test-only sampling: prove GIF pixels change while CSS bob is paused.
      const frame=await page.locator('.moyu-animated').screenshot()
      if(!frame.equals(firstFrame))changedFrame=frame
    }
    assert.ok(changedFrame,'original GIF must decode and advance frames')
    await writeFile(resolve(directory,'gif-playing.png'),changedFrame)
    await pauseBob.evaluate(element=>element.remove())
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await set({ snapshot: f.snapshots.working, reduced: true, motionAllowed: false })
    await expect(page.locator('.moyu-animated')).toHaveCount(0)
    assert.equal(await page.locator('.fish-mascot').evaluate(element => getComputedStyle(element).animationName), 'none')
    const stillCanvas=page.locator('.fish-mascot canvas')
    const before=await stillCanvas.evaluate(element=>({pixels:element.toDataURL(),width:element.width,height:element.height,bounds:element.getBoundingClientRect().toJSON()}))
    const still=await stillCanvas.screenshot()
    await page.waitForTimeout(160)
    const after=await stillCanvas.evaluate(element=>({pixels:element.toDataURL(),bounds:element.getBoundingClientRect().toJSON()}))
    const stoppedFrame=await stillCanvas.screenshot()
    await writeFile(resolve(directory,'gif-paused-before.png'),still)
    await writeFile(resolve(directory,'gif-paused-after.png'),stoppedFrame)
    await writeFile(resolve(directory,'gif-paused-check.json'),JSON.stringify({samePixels:before.pixels===after.pixels,before:before.bounds,after:after.bounds},null,2))
    // The transparent canvas is composited with the page in PNG captures; verify its actual bitmap and layout directly.
    assert.equal(before.width,226);assert.equal(before.height,217)
    assert.equal(before.pixels,after.pixels,'paused original bitmap remains unchanged')
    assert.deepEqual(before.bounds,after.bounds,'paused mascot does not move')
    checks.push('GIF decoded at original 226px width; frames advance independently of CSS bob; reduced-motion canvas remains still')
    await page.emulateMedia({ forcedColors: 'active' })
    await fits()
    assert.equal(await page.locator('.dashboard-atmosphere').evaluate(element => getComputedStyle(element).display), 'none')
    assert.equal(await page.locator('.we-metric-art').first().evaluate(element => getComputedStyle(element).display), 'none')
    assert.equal(await page.locator('.we-countdown h2').evaluate(element => getComputedStyle(element).zIndex), '1', 'heading stays above the forced-colors clock backplate')
    await page.screenshot({ path: resolve(directory, 'dashboard-forced-colors.png'), fullPage: true })
    assert.equal(await page.locator('.app-title-fish').evaluate(element=>getComputedStyle(element).display),'none')
    assert.equal(await page.locator('.app-title-text').evaluate(element=>getComputedStyle(element).webkitTextFillColor),await page.locator('.app-title').evaluate(element=>getComputedStyle(element).color))
    checks.push('existing motion gate, reduced motion and forced colors; shared title uses system text without decoration')
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' })
    const reference = f.snapshots.pond // Existing engine + fixed clock; never alter business values to match concept art.
    await set({ snapshot: reference })
    await page.screenshot({ path: resolve(directory, 'dashboard-approved.png'), fullPage: true })
    const primary=await page.locator('.dashboard-primary').screenshot()
    const background=await pixelDifference(primary,primary)
    assert.ok(background.bottomCentre[2]>background.bottomCentre[0]+6,'ocean label area must retain a blue tint instead of a white strip')
    await page.locator('.app-title').screenshot({path:resolve(directory,'title.png')})
    await expect(page.locator('.fish-endpoints')).toHaveCount(0)
    const decoration=await page.locator('.dashboard-atmosphere img').evaluate(element=>({height:element.getBoundingClientRect().height,parent:element.closest('.dashboard-primary').getBoundingClientRect().height}))
    assert.ok(Math.abs(decoration.height-decoration.parent)<=2,'decoration covers the whole primary card')
    await writeFile(resolve(directory,'background-continuity.json'),JSON.stringify({bottomCentre:background.bottomCentre,decoration},null,2))
    checks.push('blue primary background reaches the bottom; old endpoint labels and their container are removed')
    assert.ok(await page.locator('.fish-surface').evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === 'none')))
    const layouts=[]
    for(const [width,height] of [[720,580],[720,640],[720,800],[720,440],[480,580],[360,580]]){
      await page.setViewportSize({width,height});await set({snapshot:reference});await fits()
      const layout=await page.evaluate(()=>{
        const r=selector=>document.querySelector(selector).getBoundingClientRect().toJSON()
        return {width:innerWidth,height:innerHeight,shell:r('.app-shell'),content:r('.app-content'),header:r('.app-header'),main:r('main'),dashboard:r('.dashboard'),primary:r('.dashboard-primary'),clock:r('.we-countdown'),pond:r('.fish-water'),metrics:r('.dashboard-metrics'),cards:[...document.querySelectorAll('.we-metric')].map(e=>e.getBoundingClientRect().toJSON()),bottomBlank:innerHeight-r('.dashboard-metrics').bottom}
      })
      assert.equal(layout.pond.height,60,'UI-14 pond height is preserved')
      assert.ok(layout.cards.every(card=>Math.abs(card.height-145)<.1),'summary cards do not stretch to fill the viewport')
      if(height>=580)assert.ok(Math.abs(layout.bottomBlank-12)<1,'remaining viewport height is distributed inside the main card')
      if(height===440)assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight),'short windows retain natural scrolling')
      layouts.push(layout)
      await page.screenshot({path:resolve(directory,`layout-${width}-${height}.png`),fullPage:true})
    }
    await writeFile(resolve(directory,'after-layout.json'),JSON.stringify(layouts,null,2))
    if(process.env.UI15_BASELINE_LAYOUT){
      const before=JSON.parse(await readFile(resolve(process.env.UI15_BASELINE_LAYOUT),'utf8'))
      const comparison=layouts.map(after=>{
        const previous=before.find(row=>row.width===after.width&&row.height===after.height)
        for(const key of ['width','height'])assert.ok(Math.abs(previous.clock[key]-after.clock[key])<.1,'clock numeric area size remains unchanged')
        previous.cards.forEach((card,index)=>{for(const key of ['width','height'])assert.ok(Math.abs(card[key]-after.cards[index][key])<.1,'summary card size remains unchanged')})
        return {width:after.width,height:after.height,before:{content:previous.content.height,primary:previous.primary.height,bottomBlank:previous.bottomBlank},after:{content:after.content.height,primary:after.primary.height,bottomBlank:after.bottomBlank},pondHeight:after.pond.height,cardHeight:after.cards[0].height}
      })
      await writeFile(resolve(directory,'layout-comparison.json'),JSON.stringify(comparison,null,2))
    }
    checks.push('UI-15: shared selectable title clears actions; viewport space enters the primary card, clock/60px pond/145px summaries retain sizes; short windows scroll')
    await page.close()
    page = await browser.newPage({ viewport: { width: 480, height: 387 }, deviceScaleFactor: 1.5 })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://dashboard.test/**', serve)
    await page.goto('http://dashboard.test/')
    await page.waitForFunction(() => typeof window.__dashboard === 'function')
    await set({ snapshot: reference }); await fits()
    assert.equal(await page.evaluate(() => devicePixelRatio), 1.5)
    for (const percent of progressCases) {
      const snapshot=structuredClone(reference);snapshot.progress.percent=percent
      await set({snapshot});await fits();await checkPond(percent)
    }
    await set({ snapshot: reference })
    await page.screenshot({ path: resolve(directory, 'dashboard-dpr150.png'), fullPage: true })
    await page.setViewportSize({width:360,height:580})
    await set({snapshot:reference,theme:'dark',accent:'coral'});await fits()
    await page.screenshot({path:resolve(directory,'title-dark-360.png'),fullPage:true})
    await page.emulateMedia({forcedColors:'active'});await fits()
    await page.screenshot({path:resolve(directory,'title-forced-colors-360.png'),fullPage:true})
    await page.emulateMedia({forcedColors:'none'})
    await page.setViewportSize({width:720,height:580});await set({snapshot:reference})
    await page.locator('.app-title').screenshot({path:resolve(directory,'title-zoom-dpr150.png')})
    checks.push('real-engine sample with reduced-motion still capture; DPR 1.5 at 480 CSS pixels, no horizontal clipping (Windows DPI still requires manual acceptance)')
    checks.push('DPR 1.5 / 0,1,19.6,27.6,50,78,100%: mascot centre and no overlap')
    if(process.env.UI15_BEFORE_IMAGE){
      const actual=await readFile(resolve(directory,'dashboard-approved.png')),before=await readFile(resolve(process.env.UI15_BEFORE_IMAGE))
      await page.setViewportSize({width:1536,height:700})
      await page.setContent(`<style>body{margin:0;padding:16px;background:#edf4fa;font:16px 'Microsoft YaHei',sans-serif;color:#16375f}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px}h2{font-size:18px;margin:0 0 12px}img{display:block;width:100%;height:auto;border:1px solid #becddd;border-radius:12px;box-sizing:border-box}</style><div class="comparison"><section><h2>UI-14 修改前（真实 Vue）</h2><img src="data:image/png;base64,${before.toString('base64')}"></section><section><h2>UI-15 修改后（相同数据 / 视口）</h2><img src="data:image/png;base64,${actual.toString('base64')}"></section></div>`)
      await page.screenshot({path:resolve(directory,'before-vs-after.png'),fullPage:true})
    }
    assert.deepEqual(errors, [])
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ headless: true, checks, errors }, null, 2))
    await browser.close()
  }
})
