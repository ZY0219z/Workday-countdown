import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import type { WebPreferences } from 'electron'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let application: ElectronApplication | undefined
let profile: string

test.beforeEach(() => { profile = mkdtempSync(join(tmpdir(), 'workday-desktop-')) })
test.afterEach(async () => {
  if (application) await application.close().catch(() => {})
  application = undefined
  rmSync(profile, { recursive: true, force: true })
})

async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env })
  const page = await application.firstWindow()
  await expect(page.getByRole('button', { name: '保存时间' })).toBeEnabled()
  return page
}

test('window, Vue renderer, sandbox and limited preload API', async () => {
  const page = await launch()
  await expect(page.getByRole('heading', { name: 'Workday Escape' })).toBeVisible()
  await expect(page.getByLabel('上班时间')).toHaveValue('08:30')
  await expect(page.getByLabel('下班时间')).toHaveValue('18:00')
  const preferences = await application!.evaluate(({ BrowserWindow }) => {
    // Electron exposes this diagnostic internally; it is not a renderer API.
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as { getLastWebPreferences(): WebPreferences }
    return contents.getLastWebPreferences()
  })
  expect(preferences.contextIsolation).toBe(true)
  expect(preferences.sandbox).toBe(true)
  expect(preferences.nodeIntegration).toBe(false)
  const exposed = await page.evaluate(() => ({
    keys: Object.keys(window.workday).sort(),
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process
  }))
  expect(exposed).toEqual({ keys: ['loadSettings', 'quit', 'saveSettings'], require: 'undefined', process: 'undefined' })
  await page.screenshot({ path: 'test-results/poc-window.png' })
})

test('save, one-second countdown, offline reload and reopening', async () => {
  let page = await launch()
  await page.getByLabel('上班时间').fill('00:00')
  await page.getByLabel('下班时间').fill('23:59')
  await page.getByRole('button', { name: '保存时间' }).click()
  await expect(page.getByRole('status')).toHaveText('时间已保存。')
  expect(JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))).toEqual({ workStartTime: '00:00', workEndTime: '23:59' })
  const initial = await page.getByTestId('countdown').innerText()
  if (initial !== '00:00:00') {
    await expect(page.getByTestId('countdown')).not.toHaveText(initial, { timeout: 2500 })
  }
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.getByLabel('下班时间')).toHaveValue('23:59')
  await expect(page.getByRole('button', { name: '保存时间' })).toBeEnabled()
  await application!.close()
  application = undefined
  page = await launch()
  await expect(page.getByLabel('上班时间')).toHaveValue('00:00')
  await expect(page.getByLabel('下班时间')).toHaveValue('23:59')
})

test('invalid same-day times are rejected both in the form and by IPC', async () => {
  const page = await launch()
  await page.getByLabel('上班时间').fill('22:00')
  await page.getByLabel('下班时间').fill('06:00')
  await page.getByRole('button', { name: '保存时间' }).click()
  await expect(page.getByRole('status')).toContainText('下班时间必须晚于上班时间')
  const result = await page.evaluate(async () => {
    try { await window.workday.saveSettings({ workStartTime: '25:00', workEndTime: '26:00' }); return 'accepted' }
    catch { return 'rejected' }
  })
  expect(result).toBe('rejected')
})

test('corrupt configuration is kept and shown to the user', async () => {
  writeFileSync(join(profile, 'settings.json'), '{broken')
  const page = await launch()
  await expect(page.getByRole('status')).toContainText('配置读取失败')
  expect(readFileSync(join(profile, 'settings.json'), 'utf8')).toBe('{broken')
})

test('save failure leaves applied times unchanged', async () => {
  mkdirSync(join(profile, 'settings.json.tmp'))
  const page = await launch()
  await page.getByLabel('下班时间').fill('19:00')
  await page.getByRole('button', { name: '保存时间' }).click()
  await expect(page.getByRole('status')).toContainText('无法保存时间')
  await expect(page.locator('.countdown')).toContainText('今日 08:30 — 18:00')
})

test('exit button terminates the application', async () => {
  const page = await launch()
  const closed = application!.waitForEvent('close')
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await closed
  application = undefined
})

test('native window close terminates the application', async () => {
  await launch()
  const closed = application!.waitForEvent('close')
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  application = undefined
})
