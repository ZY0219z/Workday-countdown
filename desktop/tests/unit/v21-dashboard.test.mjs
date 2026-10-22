import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures } from '../../test-results/d11-ssr/components.mjs'

test('UI-06 sea-salt Dashboard, rightward water and UI-07 fixed appearance in isolated Headless', async () => {
  const directory = resolve('test-results/v21-ui06-ui07/dashboard'), bundle = resolve(directory, 'bundle')
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
    await page.route('http://dashboard.test/**', async route => {
      const path = new URL(route.request().url()).pathname.slice(1)
      if (!path) return route.fulfill({ contentType: 'text/html', body: `<html><head><link rel="stylesheet" href="/${css}"></head><body><div id="app"></div><script type="module" src="/dashboard.mjs"></script></body></html>` })
      if (path !== 'dashboard.mjs' && path !== css) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(resolve(bundle, path)) })
    })
    await page.goto('http://dashboard.test/')
    await page.waitForFunction(() => typeof window.__dashboard === 'function')
    const set = async value => {
      await page.evaluate(value => window.__dashboard(value), value)
      await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.ready === 'true'))
    }
    const fits = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await page.locator('.workday-ui').evaluate(element => getComputedStyle(element).transform === 'none' && Math.abs(element.getBoundingClientRect().left) < 1), true, 'reduced motion must never animate or displace the app root')
      const cards = await page.locator('.we-metric').count()
      assert.equal(cards, 3)
      for (const name of ['下个休息日', '下次预计发薪', '已工作']) await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1)
      await expect(page.getByRole('heading', { name: '在职自然日', exact: true })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: '今日工作进度', exact: true })).toHaveCount(0)
      await expect(page.getByRole('region', { name: '今日工作进度', exact: true })).toHaveCount(1)
      assert.equal(await page.locator('.we-metric h2').evaluateAll(headings => headings.every(heading => getComputedStyle(heading).textAlign === 'left')), true)
      const employment = page.locator('.we-metric').last()
      assert.doesNotMatch(await employment.innerText(), /自然日累计|截至 \d{4}/)
      await expect(employment).toHaveAttribute('aria-describedby', /meaning$/)
    }
    for (const theme of ['light', 'dark']) for (const accent of ['ocean', 'coral']) {
      await set({ snapshot: f.snapshots.working, theme, accent })
      await fits()
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
      assert.equal(geometry.weight, '500')
      await expect(page.locator('.workday-ui')).toHaveAttribute('data-theme','light')
      await expect(page.locator('.workday-ui')).toHaveAttribute('data-accent','ocean')
      assert.ok(Math.abs(geometry.timerCenter - geometry.heroCenter) <= 1)
      assert.ok(Math.abs(geometry.labelCenter - geometry.trackCenter) <= 1)
      assert.ok(geometry.height <= 580, JSON.stringify(geometry))
      checks.push(`stored ${accent}/${theme}: fixed sea-salt style, clock hierarchy, accessible minimal employment, default fit`)
    }
    for (const state of ['beforeWork', 'break', 'overtime', 'overnight', 'finished', 'rest', 'estimate']) {
      await set({ snapshot: f.snapshots[state] })
      await fits()
      if (state === 'overnight') await expect(page.locator('.we-countdown-target')).toContainText('2026-10-16 06:00')
      if (state === 'estimate') {
        await expect(page.locator('.dashboard')).toContainText('2027')
        const heights = await page.locator('.we-metric').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().height))
        assert.ok(heights[2] < heights[0], 'natural-day card must not stretch to the height of unrelated estimate notices')
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
      await expect(page.getByRole('timer')).toHaveText('100:00:00')
      await page.screenshot({ path: resolve(directory, `dashboard-${width}.png`), fullPage: true })
      checks.push(`${width}px: 100-hour stress and three cards reachable`)
      snapshot.employment.elapsedNaturalDays = 123456789
      await set({ snapshot })
      await fits()
      await expect(page.locator('.we-metric').last()).toContainText('123456789')
      checks.push(`${width}px: long natural-day value remains readable without horizontal overflow`)
    }
    await page.setViewportSize({ width: 720, height: 580 })
    for (const percent of [0, 1, 5, 10, 50, 100]) {
      const snapshot = structuredClone(f.snapshots.working); snapshot.progress.percent = percent
      await set({ snapshot })
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect()
        const track = rect('.fish-track'), fill = rect('.fish-fill'), fish = rect('.fish-marker'), label = rect('.fish-readout'), water = rect('.fish-water'), surface = rect('.fish-surface')
        return { fill: fill.width, track: track.width, surface: surface.width, fishLeft: fish.left, fishRight: fish.right, left: track.left, right: track.right, fishBottom: fish.bottom, labelTop: label.top, labelBottom: label.bottom, waterTop: water.top, waterBottom: water.bottom }
      })
      assert.ok(Math.abs(geometry.fill - geometry.track * percent / 100) < 1)
      assert.ok(geometry.fishLeft >= geometry.left - 1 && geometry.fishRight <= geometry.right + 1)
      assert.ok(geometry.fishBottom <= geometry.labelTop, JSON.stringify(geometry))
      assert.ok(geometry.labelTop >= geometry.waterTop && geometry.labelBottom <= geometry.waterBottom, 'percentage belongs inside pond')
      assert.ok(Math.abs(geometry.surface - geometry.track * 2) < 1, 'two track-wide periods are cropped, never squeezed')
      await expect(page.locator('.fish-readout')).toHaveText(`${percent}%`)
      await expect(page.locator('.fish-wave,.fish-wave-path')).toHaveCount(0)
      if ([1, 50, 100].includes(percent)) await page.screenshot({ path: resolve(directory, `dashboard-progress-${percent}.png`), fullPage: true })
      checks.push(`${percent}%: exact fill, bounded mascot, unobstructed pond readout, full-scale surface, no wave cluster`)
    }
    for (const state of ['working', 'overtime', 'beforeWork', 'break', 'finished', 'rest']) {
      await set({ snapshot: f.snapshots[state], reduced: false, motionAllowed: true })
      await expect(page.locator('.moyu-animated')).toHaveCount(['working', 'overtime'].includes(state) ? 1 : 0)
    }
    await set({ snapshot: f.snapshots.working, reduced: false, motionAllowed: false })
    await expect(page.locator('.moyu-animated')).toHaveCount(0)
    checks.push('GIF: working/overtime only; before-work/break/finished/rest and disabled visibility/motion gate stay static')
    await set({ snapshot: f.snapshots.working, reduced: false, motionAllowed: true })
    await expect(page.locator('.moyu-animated')).toHaveCount(1)
    const motion = await page.locator('.fish-surface').evaluate(element => {
      const animation=element.getAnimations()[0], duration=animation.effect.getComputedTiming().duration
      animation.currentTime=0
      const start=new DOMMatrix(getComputedStyle(element).transform).m41
      animation.currentTime=6000
      const middle=new DOMMatrix(getComputedStyle(element).transform).m41
      animation.currentTime=11999
      const end=new DOMMatrix(getComputedStyle(element).transform).m41
      return {duration,start,middle,end,properties:Object.keys(animation.effect.getKeyframes()[0])}
    })
    assert.equal(motion.duration,12000)
    assert.ok(motion.start<motion.middle && motion.middle<motion.end, 'water translates slowly right')
    assert.ok(!motion.properties.some(name=>['width','height','left','backgroundPosition'].includes(name)))
    for (const state of ['break','finished','rest']) {
      await set({snapshot:f.snapshots[state],reduced:false,motionAllowed:true})
      if(await page.locator('.fish-surface').count()) assert.equal(await page.locator('.fish-surface').evaluate(element=>getComputedStyle(element).animationPlayState),'paused')
    }
    await set({snapshot:f.snapshots.working,reduced:false,motionAllowed:true})
    await set({snapshot:f.snapshots.working,reduced:false,motionAllowed:false})
    const phase=await page.locator('.fish-surface').evaluate(element=>element.getAnimations()[0].currentTime)
    await page.waitForTimeout(80)
    assert.equal(await page.locator('.fish-surface').evaluate(element=>element.getAnimations()[0].currentTime),phase)
    checks.push('water: 12s linear transform-only rightward motion; repeated periods; stopped states and visibility gate pause without resetting phase')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await set({ snapshot: f.snapshots.working, reduced: true, motionAllowed: false })
    await expect(page.locator('.moyu-animated')).toHaveCount(0)
    assert.equal(await page.locator('.fish-mascot').evaluate(element => getComputedStyle(element).animationName), 'none')
    assert.equal(await page.locator('.fish-surface').evaluate(element => getComputedStyle(element).animationPlayState), 'paused')
    assert.equal(await page.locator('.fish-surface').evaluate(element => element.getAnimations()[0].currentTime), phase)
    await page.emulateMedia({ forcedColors: 'active' })
    await fits()
    await page.screenshot({ path: resolve(directory, 'dashboard-forced-colors.png'), fullPage: true })
    checks.push('existing motion gate, reduced motion and forced colors')
    assert.deepEqual(errors, [])
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ headless: true, checks, errors }, null, 2))
    await browser.close()
  }
})
