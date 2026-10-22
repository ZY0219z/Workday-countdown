import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'

test('three isolated Dashboard concepts render with bound progress and left-top summary titles', async () => {
  const directory = resolve('test-results/v21-dashboard-variants'), bundle = resolve(directory, 'bundle')
  await mkdir(directory, { recursive: true })
  // Reuse the existing fixed-snapshot factory, without running the unrelated D11 suite.
  const fixturesDirectory = resolve(directory, 'fixtures')
  await build({ configFile: false, plugins: [vue()], logLevel: 'warn', build: {
    ssr: 'tests/unit/d11-components.entry.mjs', outDir: fixturesDirectory, emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: 'fixtures.mjs' } }
  } })
  const { fixtures } = await import(pathToFileURL(resolve(fixturesDirectory, 'fixtures.mjs')).href)
  const { snapshots } = fixtures()
  await build({ configFile: false, plugins: [vue()], logLevel: 'warn', define: { 'process.env.NODE_ENV': '"production"' }, build: {
    outDir: bundle, emptyOutDir: false,
    lib: { entry: resolve('tests/unit/v21-dashboard-variants.entry.mjs'), formats: ['es'], fileName: () => 'variants.mjs' }
  } })
  const css = (await readdir(bundle)).find(file => file.endsWith('.css'))
  assert.ok(css)
  const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
  const checks = [], errors = []
  let page
  try {
    page = await browser.newPage({ viewport: { width: 720, height: 640 } })
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://variants.test/**', async route => {
      const path = new URL(route.request().url()).pathname.slice(1)
      if (!path) return route.fulfill({ contentType: 'text/html', body: `<html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/${css}"></head><body><div id="app"></div><script type="module" src="/variants.mjs"></script></body></html>` })
      if (path !== 'variants.mjs' && path !== css) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(resolve(bundle, path)) })
    })
    await page.goto('http://variants.test/')
    await page.waitForFunction(() => typeof window.__variants === 'function')
    const set = async (variant, options = {}) => {
      await page.evaluate(value => window.__variants(value), { snapshot: snapshots.working, variant, ...options })
      await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.ready === 'true'))
    }
    const fits = async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow')
      await expect(page.locator('.summary')).toHaveCount(3)
      for (const name of ['下个休息日', '下次预计发薪', '已工作']) await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(1)
      assert.equal(await page.locator('.summary h2').evaluateAll(headings => headings.every(heading => {
        const card = heading.closest('.summary').getBoundingClientRect(), title = heading.getBoundingClientRect()
        return getComputedStyle(heading).textAlign === 'left' && title.left - card.left <= 18 && title.top - card.top <= 18
      })), true, 'all summary titles stay left-top')
    }
    for (const variant of ['a', 'b', 'c']) {
      for (const [theme, accent] of [['light', 'ocean'], ['dark', 'coral']]) {
        await set(variant, { theme, accent })
        await fits()
        await expect(page.getByRole('timer')).toHaveAttribute('aria-label', '03:00:00')
        await page.screenshot({ path: resolve(directory, `${variant}-${accent}-${theme}.png`), fullPage: true })
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= 640), true, `${variant}: fits preview height`)
        checks.push(`${variant} ${accent}/${theme}: default capture, timer, copy, three left-top titles, 720x640 fit`)
      }
      // Only preview geometry: do not recalculate or modify production business data.
      for (const percent of [0, 1, 50, 100]) {
        const snapshot = structuredClone(snapshots.working); snapshot.progress.percent = percent
        await set(variant, { snapshot })
        const geometry = await page.evaluate(() => {
          const scene = document.querySelector('.progress-scene').getBoundingClientRect()
          const heading = document.querySelector('.progress-section h2').getBoundingClientRect()
          const cat = document.querySelector('.cat').getBoundingClientRect()
          const readout = document.querySelector('.progress-readout,.cursor-readout').getBoundingClientRect()
          return { scene: { left: scene.left, right: scene.right }, headingBottom: heading.bottom, cat: { left: cat.left, right: cat.right, top: cat.top, bottom: cat.bottom }, readout: { left: readout.left, right: readout.right, top: readout.top } }
        })
        assert.ok(geometry.cat.left >= geometry.scene.left - 1 && geometry.cat.right <= geometry.scene.right + 1, JSON.stringify(geometry))
        assert.ok(geometry.cat.top >= geometry.headingBottom, 'cat must not cover progress heading at low progress')
        assert.ok(geometry.cat.bottom <= geometry.readout.top || geometry.cat.right <= geometry.readout.left || geometry.cat.left >= geometry.readout.right, 'cat must not cover percentage')
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(percent))
        if (variant === 'b') {
          assert.equal(await page.locator('.waterline').evaluate(element => Math.abs(element.getBoundingClientRect().width - element.closest('.progress-scene').getBoundingClientRect().width) < 1), true, 'waterline keeps full-track scale instead of squeezing at early progress')
          if (percent === 1) await page.screenshot({ path: resolve(directory, 'b-progress-1.png'), fullPage: true })
        }
      }
      await set(variant, { snapshot: snapshots.rest })
      await expect(page.getByRole('timer')).toHaveCount(0)
      await expect(page.getByRole('progressbar')).toHaveCount(0)
      const nextDay = structuredClone(snapshots.working)
      nextDay.countdown.targetAt += 86400000
      await set(variant, { snapshot: nextDay })
      await expect(page.locator('.target-date')).toBeVisible()
      await expect(page.locator('.target-date')).toHaveText('2026-10-16')
      await page.setViewportSize({ width: 480, height: 640 })
      await set(variant)
      await fits()
      await page.screenshot({ path: resolve(directory, `${variant}-480.png`), fullPage: true })
      await page.setViewportSize({ width: 720, height: 640 })
      checks.push(`${variant}: 0/1/50/100% bounded mascot and unobstructed readout; rest no fake timer/progress; cross-day date visible; 480px capture`)
    }
    assert.deepEqual(errors, [])
    await writeFile(resolve(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Dashboard 三案对比</title><style>body{margin:24px;background:#f0f7fd;color:#24374b;font:14px 'Segoe UI','Microsoft YaHei',sans-serif}main{display:flex;gap:20px;flex-wrap:wrap}section{width:720px}img{width:100%;height:auto;border:1px solid #becddd;border-radius:12px}h1{font-size:22px}h2{font-size:18px}p{max-width:72ch;line-height:1.7}</style><h1>Dashboard 三案对比 · 隔离预览</h1><p>相同固定 Snapshot，720×640 CSS 像素；猫鱼为原 GIF 的静态帧。正式 Dashboard 尚未接入。截图中的日期和进度均为示例数据。</p><main>${[['a','A · 下班航线'],['b','B · 摸鱼水槽'],['c','C · 桌面时钟']].map(([id,name])=>`<section><h2>${name}</h2><img src="${id}-ocean-light.png" alt="${name}"><p><a href="${id}-coral-dark.png">珊瑚暗色</a> · <a href="${id}-480.png">480px 窄宽</a></p></section>`).join('')}</main></html>`)
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await writeFile(resolve(directory, 'checks.json'), JSON.stringify({ headless: true, checks, errors }, null, 2))
    await browser.close()
  }
})
