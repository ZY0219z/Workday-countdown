import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures, createSettingsDraft } from '../../test-results/d11-ssr/components.mjs'

test('restored More settings exposes all groups, follows themes and saves full historical preferences', async () => {
  const directory = resolve('test-results/v21-ui-rollback/settings'), bundle = resolve(directory, 'bundle')
  await mkdir(directory, { recursive: true })
  await build({ configFile: false, plugins: [vue()], logLevel: 'warn', define: { 'process.env.NODE_ENV': '"production"' }, build: {
    outDir: bundle, emptyOutDir: false,
    lib: { entry: resolve('tests/unit/v21-settings-restore.entry.mjs'), formats: ['es'], fileName: () => 'settings.mjs' }
  } })
  const css = (await readdir(bundle)).find(file => file.endsWith('.css')), f = fixtures()
  const config = structuredClone(f.config)
  config.appearance = { mode: 'dark', accent: 'coral', reduceMotion: false }
  config.calendar.overrides = { '2026-10-20': 'rest', '2026-10-21': 'work' }
  config.schedule.workWeek = [1, 2, 3, 4, 5, 6]
  config.desktop.alwaysOnTop = true
  const session = { ...createSettingsDraft(config).data, configurationStatus: 'ready', expectedEnd: f.expectedEnd }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 580 } }), errors = []
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://settings.test/**', async route => {
      const path = new URL(route.request().url()).pathname.slice(1)
      if (!path) return route.fulfill({ contentType: 'text/html', body: `<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/${css}"><div id="app"></div><script type="module" src="/settings.mjs"></script></html>` })
      if (path !== 'settings.mjs' && path !== css) return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: path.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(resolve(bundle, path)) })
    })
    await page.goto('http://settings.test/')
    await page.waitForFunction(() => typeof window.__settingsInit === 'function')
    await page.evaluate(value => window.__settingsInit(value), { session, snapshot: f.snapshots.working, metadata: f.metadata })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置中心', exact: true })).toBeVisible()
    const root = page.locator('[data-workday-root]')
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveAttribute('data-accent', 'coral')
    await page.locator('summary').filter({ hasText: '更多设置' }).click()
    const group = page.getByLabel(/^设置分组/)
    await expect(page.getByRole('heading', { name: '离线工作日历' })).toBeVisible()
    await expect(page.getByRole('button', { name: '添加日期覆盖' })).toBeVisible()
    await page.screenshot({ path: resolve(directory, 'settings-more-calendar.png'), fullPage: true })
    await group.selectOption('data')
    await expect(page.getByLabel('导入来源')).toHaveValue('python-v1')
    for (const name of ['选择配置并预览', '预览最近有效备份', '导出已保存配置'])
      await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
    await group.selectOption('appearance')
    await page.getByLabel('显示模式', { exact: true }).selectOption('light')
    await page.getByLabel('配色', { exact: true }).selectOption('ocean')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(root).toHaveAttribute('data-accent', 'ocean')
    await page.screenshot({ path: resolve(directory, 'settings-theme.png'), fullPage: true })
    await page.getByLabel('显示模式', { exact: true }).selectOption('system')
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme })
      await expect(root).toHaveAttribute('data-theme', colorScheme)
    }
    await page.getByLabel('显示模式', { exact: true }).selectOption('dark')
    await page.getByLabel('配色', { exact: true }).selectOption('coral')
    await group.selectOption('desktop')
    await expect(page.getByLabel(/^关闭主窗口/)).toHaveValue(config.desktop.closeAction)
    await expect(page.getByLabel('迷你窗置顶偏好', { exact: true })).toBeChecked()
    await page.getByLabel('启用迷你窗', { exact: true }).check()
    await page.getByLabel('上班时间', { exact: true }).fill('08:45')
    await page.getByLabel('下班时间', { exact: true }).fill('18:30')
    await page.getByLabel('每月发薪日', { exact: true }).fill('15')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置中心', exact: true })).toHaveCount(0)
    const state = await page.evaluate(() => window.__settingsState())
    assert.equal(state.saves.length, 1)
    const stored = state.saves[0].settings
    for (const key of ['calendar', 'appearance', 'overtime', 'employee']) assert.deepEqual(stored[key], session.draft[key], key)
    assert.deepEqual(stored.schedule, { ...session.draft.schedule, startTime: '08:45', endTime: '18:30' })
    assert.deepEqual(stored.salary, { ...session.draft.salary, day: 15 })
    assert.deepEqual(stored.desktop, { ...session.draft.desktop, miniEnabled: true })
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveAttribute('data-accent', 'coral')
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
