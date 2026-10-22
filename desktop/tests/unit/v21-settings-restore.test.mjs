import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures, createSettingsDraft } from '../../test-results/d11-ssr/components.mjs'

test('UI-11 daily rows and direct Mini switch preserve drafts, themes, validation and recovery', async () => {
  const directory = resolve('test-results/v21-ui10-ui11/settings'), bundle = resolve(directory, 'bundle')
  await mkdir(directory, { recursive: true })
  await build({ configFile: false, plugins: [vue()], logLevel: 'warn', define: { 'process.env.NODE_ENV': '"production"' }, build: {
    outDir: bundle, emptyOutDir: false,
    lib: { entry: resolve('tests/unit/v21-settings-restore.entry.mjs'), formats: ['es'], fileName: () => 'settings.mjs' }
  } })
  const css = (await readdir(bundle)).find(file => file.endsWith('.css')), f = fixtures()
  const config = structuredClone(f.config)
  config.appearance = { mode: 'light', accent: 'ocean', reduceMotion: false }
  config.calendar.overrides = { '2026-10-20': 'rest', '2026-10-21': 'work' }
  config.schedule.workWeek = [1, 2, 3, 4, 5, 6]
  config.desktop.alwaysOnTop = true
  const session = { ...createSettingsDraft(config).data, configurationStatus: 'ready', expectedEnd: f.expectedEnd }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
  try {
    let page = await browser.newPage({ viewport: { width: 720, height: 580 } })
    const errors = []
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    const serve = async route => {
      const path = new URL(route.request().url()).pathname.slice(1)
      if (!path) return route.fulfill({ contentType: 'text/html', body: `<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/${css}"><div id="app"></div><script type="module" src="/settings.mjs"></script></html>` })
      if (path !== 'settings.mjs' && path !== css) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(resolve(bundle, path)) })
    }
    await page.route('http://settings.test/**', serve)
    await page.goto('http://settings.test/')
    await page.waitForFunction(() => typeof window.__settingsInit === 'function')
    const initialize = async (status = 'ready', appearance = config.appearance, source = session) => {
      const value = structuredClone(source)
      value.configurationStatus = status; value.saved.appearance = appearance; value.draft.appearance = appearance
      await page.evaluate(value => window.__settingsInit(value), { session: value, snapshot: f.snapshots.working, metadata: f.metadata })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByRole('heading', { name: status === 'ready' ? '设置中心' : '配置恢复', exact: true })).toBeVisible()
    }
    await initialize()
    const root = page.locator('[data-workday-root]')
    await expect(page.locator('details,summary,.settings-more')).toHaveCount(0)
    await expect(page.getByRole('switch', { name: '启用迷你窗', exact: true })).toBeVisible()
    await expect(page.locator('.settings-fields input')).toHaveCount(6)
    assert.doesNotMatch(await page.locator('.settings').innerText(), /更多设置|设置分组|离线工作日历|外观主题|窗口与托盘|预览最近有效备份|导出已保存配置/)
    await expect(page.getByRole('region', { name: '安全恢复', exact: true })).toHaveCount(0)
    await page.getByLabel('今天预计下班时间', { exact: true }).fill('19:00')
    await expect.poll(async () => (await page.evaluate(() => window.__settingsState())).calls.expectedEnd.at(-1)?.input).toBe('19:00')
    await page.getByRole('button', { name: '取消今天加班', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.__settingsState())).calls.expectedEnd.at(-1)?.input).toBe(null)
    await expect(page.getByLabel('今天预计下班时间', { exact: true })).toHaveValue(f.expectedEnd.normalEnd.time)
    await page.getByLabel('启用迷你窗', { exact: true }).check()
    await page.getByLabel('上班时间', { exact: true }).fill('08:45')
    await page.getByLabel('下班时间', { exact: true }).fill('18:30')
    await page.getByLabel('每月发薪日', { exact: true }).fill('15')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置中心', exact: true })).toHaveCount(0)
    let state = await page.evaluate(() => window.__settingsState())
    assert.equal(state.saves.length, 1)
    const stored = state.saves[0].settings
    for (const key of ['calendar', 'appearance', 'overtime', 'employee']) assert.deepEqual(stored[key], session.draft[key], key)
    assert.deepEqual(stored.schedule, { ...session.draft.schedule, startTime: '08:45', endTime: '18:30' })
    assert.deepEqual(stored.salary, { ...session.draft.salary, day: 15 })
    assert.deepEqual(stored.desktop, { ...session.draft.desktop, miniEnabled: true })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByLabel('启用迷你窗', { exact: true })).toBeChecked()
    await page.getByLabel('上班时间', { exact: true }).dispatchEvent('compositionstart')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.locator('.app-error')).toContainText('输入法组合输入')
    assert.equal((await page.evaluate(() => window.__settingsState())).saves.length, 1)
    await page.getByLabel('上班时间', { exact: true }).dispatchEvent('compositionend', { data: '' })
    await page.getByLabel('每月发薪日', { exact: true }).fill('0')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    assert.equal(await page.getByLabel('每月发薪日', { exact: true }).evaluate(input => input.validity.rangeUnderflow), true)
    assert.equal((await page.evaluate(() => window.__settingsState())).saves.length, 1)
    await page.getByLabel('每月发薪日', { exact: true }).fill('15')
    await page.getByLabel('上班时间', { exact: true }).fill('bad')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByLabel('上班时间', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    assert.equal((await page.evaluate(() => window.__settingsState())).saves.length, 1)
    await page.getByLabel('上班时间', { exact: true }).fill('08:45')
    await page.getByLabel('每月发薪日', { exact: true }).fill('16')
    await page.getByRole('button', { name: '退出程序', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.__settingsState())).calls.quit).toBe(1)
    await expect(page.getByRole('heading', { name: '设置中心', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '取消 / 返回仪表盘', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByLabel('每月发薪日', { exact: true })).toHaveValue('16')
    await page.getByRole('button', { name: '取消 / 返回仪表盘', exact: true }).click()
    await page.getByRole('button', { name: '放弃', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置中心', exact: true })).toHaveCount(0)
    state = await page.evaluate(() => window.__settingsState())
    assert.deepEqual(state.session.draft, stored)
    for (const appearance of [{ mode: 'dark', accent: 'coral', reduceMotion: false }, { mode: 'system', accent: 'ocean', reduceMotion: false }]) {
      await initialize('ready', appearance)
      await expect(root).toHaveAttribute('data-accent', appearance.accent)
      if (appearance.mode === 'system') for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme }); await expect(root).toHaveAttribute('data-theme', colorScheme)
      }
      else await expect(root).toHaveAttribute('data-theme', 'dark')
    }
    for (const status of ['recoverable', 'invalid', 'future']) {
      await initialize(status)
      const recovery = page.getByRole('region', { name: '安全恢复', exact: true })
      await expect(recovery).toBeVisible()
      await expect(page.getByLabel('上班时间', { exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: '导出已保存配置' })).toHaveCount(0)
      await recovery.getByRole('button', { name: '选择配置并预览', exact: true }).click()
      assert.deepEqual((await page.evaluate(() => window.__settingsState())).calls.imports, [{ sourceKind: 'v2' }])
      await recovery.getByRole('button', { name: '预览最近有效备份', exact: true }).click()
      if (status === 'future') await expect(recovery.getByRole('alert')).toContainText('较新版本配置只读')
      else {
        await expect(recovery.getByRole('region', { name: '导入预览' })).toBeVisible()
        assert.equal((await page.evaluate(() => window.__settingsState())).calls.apply, 0)
        await recovery.getByRole('button', { name: '确认备份并应用所选字段', exact: true }).click()
        await expect(recovery.getByRole('alert')).toContainText('未覆盖只读配置')
      }
      assert.deepEqual((await page.evaluate(() => window.__settingsState())).session.saved, JSON.parse(JSON.stringify(session.saved)))
      await recovery.screenshot({ path: resolve(directory, `recovery-${status}.png`) })
    }
    const visual = structuredClone(f.defaultConfig)
    visual.schedule.startTime = '09:00'; visual.schedule.endTime = '22:00'
    visual.employee.startDate = '2025-07-15'; visual.desktop.miniEnabled = true
    const visualSession = { ...createSettingsDraft(visual).data, expectedEnd: { ...f.expectedEnd,
      shiftDate: '2026-10-22', normalEnd: { date: '2026-10-22', time: '22:00' }, finalEnd: { date: '2026-10-22', time: '22:00' } } }
    await initialize('ready', config.appearance, visualSession)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(directory, 'settings-approved.png'), fullPage: true })
    await page.setViewportSize({ width: 360, height: 580 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(directory, 'settings-360.png'), fullPage: true })
    await page.close()
    page = await browser.newPage({ viewport: { width: 480, height: 387 }, deviceScaleFactor: 1.5 })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://settings.test/**', serve)
    await page.goto('http://settings.test/')
    await page.waitForFunction(() => typeof window.__settingsInit === 'function')
    await initialize('ready', config.appearance, visualSession)
    assert.equal(await page.evaluate(() => devicePixelRatio), 1.5)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(directory, 'settings-dpr150.png'), fullPage: true })
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
