import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures } from '../../test-results/d11-ssr/components.mjs'

test('UI-12 renders centred mascot, readable capsule, underwater cards and original motion gates', async () => {
  const directory = resolve('test-results/v21-ui12/dashboard'), bundle = resolve(directory, 'bundle')
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
    const fits = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      const columns = await page.locator('.we-metric').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top))
      assert.ok(Math.max(...columns) - Math.min(...columns) <= 1, 'summary cards remain in three columns')
      const cards = await page.locator('.we-metric').count()
      assert.equal(cards, 3)
      for (const name of ['下个休息日', '下次预计发薪', '已工作']) await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1)
      await expect(page.getByRole('heading', { name: '在职自然日', exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: '今日工作进度', exact: true })).toHaveCount(0)
      await expect(page.getByRole('region', { name: '今日工作进度', exact: true })).toHaveCount(1)
      assert.equal(await page.locator('.we-metric h2').evaluateAll(headings => headings.every(heading => getComputedStyle(heading).textAlign === 'left')), true)
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
        const hero = rect('.we-countdown'), track = rect('.fish-track'), label = rect('.fish-readout')
        return { timerCenter: (parts[0].left + parts.at(-1).right) / 2, heroCenter: hero.x + hero.width / 2,
          trackCenter: track.x + track.width / 2, labelCenter: label.x + label.width / 2,
          font: parseFloat(getComputedStyle(document.querySelector('.we-countdown-value')).fontSize), weight: getComputedStyle(document.querySelector('.we-countdown-value')).fontWeight, height: document.documentElement.scrollHeight }
      })
      await page.screenshot({ path: resolve(directory, `dashboard-${accent}-${theme}.png`), fullPage: true })
      assert.ok(geometry.font >= 88)
      assert.equal(geometry.weight, '700')
      assert.deepEqual(await page.locator('.we-time-label').allTextContents(), ['小时', '分钟', '秒'])
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
    const progressCases = [0, 1, 8.3, 50, 78, 100]
    const checkPond = async percent => {
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
        return { track: rect('.fish-track'), fill: rect('.fish-fill'), fish: rect('.fish-marker'), label: rect('.fish-readout'), water: rect('.fish-water'), surface: rect('.fish-surface'), inner: document.querySelector('.fish-water').clientWidth }
      })
      const {track,fill,fish,label,water,surface,inner} = geometry
      assert.ok(Math.abs(fill.width - inner * percent / 100) < 1, JSON.stringify(geometry))
      assert.ok(Math.abs(fish.left - track.left - (track.width-fish.width)*percent/100) < 1, 'mascot uses real progress')
      assert.ok(fish.left >= track.left - 1 && fish.right <= track.right + 1)
      assert.ok(Math.abs(fish.y+fish.height/2-water.y-water.height/2) < 1, 'mascot is vertically centred IN the tank')
      assert.ok(fish.top >= water.top && fish.bottom <= water.bottom)
      assert.ok(Math.abs(label.x+label.width/2-track.x-track.width/2) < 1, 'capsule stays horizontally centred')
      assert.ok(label.left >= track.left && label.right <= track.right && label.top >= track.top && label.bottom <= track.bottom)
      assert.ok(fish.right <= label.left || fish.left >= label.right || fish.bottom <= label.top || fish.top >= label.bottom, 'capsule and mascot do not overlap')
      assert.ok(Math.abs(surface.width-track.width) < 1, 'waves retain full-track scale at low fill')
      await expect(page.locator('.fish-readout')).toHaveText(`${percent}%`)
      await expect(page.locator('progress')).toHaveAttribute('aria-label','有效工作进度')
      await expect(page.locator('.fish-wave,.fish-wave-path')).toHaveCount(0)
      assert.equal(await page.locator('.fish-surface').evaluate(element => getComputedStyle(element).animationName), 'none')
      return geometry
    }
    for (const width of [720, 480, 360]) {
      await page.setViewportSize({ width, height: 580 })
      for (const percent of progressCases) {
        const snapshot = structuredClone(f.snapshots.working); snapshot.progress.percent = percent
        await set({ snapshot }); await fits(); await checkPond(percent)
        await page.screenshot({ path: resolve(directory, `pond-${width}-${percent}.png`), fullPage: true })
      }
      checks.push(`${width}px / 0,1,8.3,50,78,100%: true fill/position, vertical centre, bounded mascot, central capsule with collision avoidance, full-scale waves`)
    }
    await page.setViewportSize({ width: 720, height: 580 })
    const moving = structuredClone(f.snapshots.working)
    moving.progress.percent = 1
    await set({snapshot:moving,motionAllowed:true,reduced:false})
    moving.progress.percent = 8.3
    await set({snapshot:moving,motionAllowed:true,reduced:false})
    // An interrupted move must protect the capsule along the actual swept path, not only at the destination.
    moving.progress.percent = 50
    await set({snapshot:moving,motionAllowed:true,reduced:false})
    await expect(page.locator('.fish-readout')).toHaveClass(/fish-readout--lifted/)
    moving.progress.percent = 100
    await set({snapshot:moving,motionAllowed:true,reduced:false})
    await expect.poll(() => page.locator('.fish-marker').evaluate(element => element.getAnimations().length)).toBe(0)
    await expect(page.locator('.fish-readout')).not.toHaveClass(/fish-readout--lifted/)
    await checkPond(100)
    await page.setViewportSize({width:360,height:580})
    await expect.poll(() => page.locator('.fish-track').evaluate(element => element.clientWidth)).toBeLessThan(360)
    await checkPond(100)
    await expect(page.locator('.fish-marker')).not.toHaveClass(/fish-marker--moving/)
    await page.setViewportSize({width:720,height:580})
    checks.push('interrupted progress transition: central capsule protected during sweep; resize remeasures without movement transition')
    for (const state of ['working', 'overtime', 'beforeWork', 'break', 'finished', 'rest']) {
      await set({ snapshot: f.snapshots[state], reduced: false, motionAllowed: true })
      await expect(page.locator('.moyu-animated')).toHaveCount(['working', 'overtime'].includes(state) ? 1 : 0)
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
    checks.push('existing motion gate, reduced motion and forced colors')
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' })
    const reference = f.snapshots.refined // Existing engine + fixed clock; never alter business values to match concept art.
    await set({ snapshot: reference })
    await page.screenshot({ path: resolve(directory, 'dashboard-approved.png'), fullPage: true })
    assert.equal(await page.locator('.fish-surface').evaluate(element => getComputedStyle(element).animationName), 'none')
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
    checks.push('approved reference sample; static surface; DPR 1.5 at 480 CSS pixels, no horizontal clipping (Windows DPI still requires manual acceptance)')
    checks.push('DPR 1.5 / 0,1,8.3,50,78,100%: mascot centre and no overlap')
    const actual = await readFile(resolve(directory, 'dashboard-approved.png'))
    const approved = await readFile(resolve('../docs/version/V2.1.0/design-reference/UI-12-dashboard-approved.png'))
    await page.setViewportSize({width:1536,height:700})
    await page.setContent(`<style>body{margin:0;padding:16px;background:#edf4fa;font:16px 'Microsoft YaHei',sans-serif;color:#16375f}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px}h2{font-size:18px;margin:0 0 12px}img{display:block;width:100%;height:auto;border:1px solid #becddd;border-radius:12px;box-sizing:border-box}</style><div class="comparison"><section><h2>用户确认的 UI-12 参考图</h2><img src="data:image/png;base64,${approved.toString('base64')}"></section><section><h2>真实 Vue 渲染（真实引擎：09:40，8.3%）</h2><img src="data:image/png;base64,${actual.toString('base64')}"></section></div>`)
    await page.screenshot({path:resolve(directory,'reference-vs-vue.png'),fullPage:true})
    assert.deepEqual(errors, [])
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ headless: true, checks, errors }, null, 2))
    await browser.close()
  }
})
