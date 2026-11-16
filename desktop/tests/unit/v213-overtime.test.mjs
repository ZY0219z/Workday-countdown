import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

test('DEV-01 shortcut exercises the production dashboard headlessly', async () => {
  const output = resolve('test-results/v213-overtime-acceptance')
  const root = resolve('out/renderer')
  await mkdir(output, { recursive: true })
  await build({ configFile: false, plugins: [vue()], logLevel: 'warn', build: {
    ssr: 'tests/unit/d11-components.entry.mjs', outDir: resolve(output, 'fixture'), emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: 'components.mjs' } }
  } })
  const { fixtures, createSettingsDraft } = await import(pathToFileURL(resolve(output, 'fixture/components.mjs')).href)
  const source = fixtures()
  const ok = data => ({ ok: true, data })
  const unavailable = message => ({ ok: false, error: { code: 'UNAVAILABLE', message } })
  let config = structuredClone(source.config)
  let snapshot = source.snapshots.working
  let sequence = 0
  let staged = null
  let failure = false
  let discardBlocked = false
  let saveGate = null
  const calls = { stage: 0, save: 0, discard: 0 }
  const session = () => {
    const minutes = snapshot.activeShift?.overtimeMinutes ?? 0
    const times = { 0: '18:00', 60: '19:00', 120: '20:00', 390: '00:30' }
    return {
      ...createSettingsDraft(config).data,
      configurationStatus: 'ready',
      expectedEnd: snapshot.activeShift ? {
        ...source.expectedEnd, targetKey: `${config.revision}/${snapshot.activeShift.shiftDate}`, minutes,
        finalEnd: source.expectedByTime[times[minutes]].end
      } : { available: false, message: '今天没有班次。' },
      ...(staged ? { dirty: true, expectedEndEdit: staged } : {})
    }
  }
  const readSnapshot = () => ok({ ...snapshot, configRevision: config.revision, sequence: ++sequence })
  const files = new Map((await readdir(root, { recursive: true, withFileTypes: true })).filter(file => file.isFile()).map(file => {
    const path = resolve(file.parentPath, file.name)
    return [`/${relative(root, path).split(sep).join('/')}`, path]
  }))
  const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 600 }, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', reducedMotion: 'reduce' })
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      const path = url.origin === 'http://overtime.test' ? files.get(url.pathname) : undefined
      return path ? route.fulfill({ path }) : route.abort()
    })
    await page.exposeFunction('overtimeFixture', async (method, request) => {
      switch (method) {
        case 'draft.read': return ok(session())
        case 'draft.stage':
          calls.stage++
          if (request.targetKey !== session().expectedEnd.targetKey) return unavailable('班次已变化。')
          staged = request
          return ok(session())
        case 'draft.discard':
          calls.discard++
          if (discardBlocked) return unavailable('测试：草稿服务暂不可用。')
          staged = null
          return ok(session())
        case 'config.save': {
          calls.save++
          if (saveGate) await saveGate
          if (failure) return { ok: false, error: { code: 'IO_DENIED', message: '测试：配置目录不可写。' } }
          const input = staged?.input
          const outcome = input === null ? source.snapshots.working : input === '19:00' ? source.snapshots.rollback : source.snapshots.laterOvertime
          config = { ...config, revision: config.revision + 1, overtime: input === null ? { entries: [] } : source.expectedByTime[input].overtime }
          snapshot = outcome
          staged = null
          return ok({ config, warnings: [] })
        }
        case 'snapshot.read': return readSnapshot()
        default: throw Error(`Unexpected fixture request ${method}`)
      }
    })
    await page.addInitScript(metadata => {
      const call = (method, request) => window.overtimeFixture(method, request)
      const ok = data => ({ ok: true, data })
      window.workdayV2 = {
        settingsDraft: { read: () => call('draft.read'), setExpectedEnd: request => call('draft.stage', request), discard: () => call('draft.discard') },
        config: { save: request => call('config.save', request) },
        calendar: { readMetadata: async () => ok(metadata) },
        snapshot: {
          read: () => call('snapshot.read'), unsubscribe: async () => ok(null),
          subscribe: async listener => { window.pushOvertimeSnapshot = async () => listener(await call('snapshot.read')); return ok(null) }
        },
        window: {
          onOpenSettings: listener => { window.openFixtureSettings = listener; return () => {} },
          subscribeVisibility: async listener => { listener(ok({ visible: true, sequence: 1 })); return ok(null) },
          unsubscribeVisibility: async () => ok(null)
        }
      }
    }, source.metadata)

    const toggle = page.getByRole('switch', { name: '今日加班' })
    const dialog = page.getByRole('dialog')
    const time = dialog.getByLabel('加班到')
    const timer = page.getByRole('timer')
    const pill = page.locator('.overtime-pill')
    const track = page.locator('.overtime-switch')
    const assertCentered = async () => {
      const { x, y, width, height } = await dialog.boundingBox()
      const viewport = page.viewportSize()
      assert.ok(Math.abs(x + width / 2 - viewport.width / 2) <= 1, 'horizontal center')
      assert.ok(Math.abs(y + height / 2 - viewport.height / 2) <= 1, 'vertical center')
      assert.ok(x >= 15 && y >= 15, 'dialog fits the viewport')
    }
    const geometry = () => page.locator('.dashboard-primary, .app-header, .we-countdown, .we-countdown-header, .we-countdown-value, .fish-track, .dashboard-metrics')
      .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
    const screenshot = async name => {
      await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.ready === 'true'))
      await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' })
    }

    await page.goto('http://overtime.test/index.html')
    await expect(toggle).toBeEnabled()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.overtime-home')).toBeVisible()
    await expect(track).toHaveCSS('background-color', 'rgb(119, 136, 158)')
    await expect(track.locator('span')).toHaveCSS('transform', 'none')
    await expect(track).toHaveCSS('transition-duration', '0s')
    await expect(timer).toHaveText('03:00:00')
    await expect(pill).toHaveCSS('width', '81px')
    await expect(pill).toHaveCSS('height', '34px')
    await expect(pill.locator('svg')).toHaveCSS('width', '20px')
    const original = await geometry()
    await pill.evaluate(element => { element.hidden = true; element.style.display = 'none' })
    assert.deepEqual(await geometry(), original)
    await pill.evaluate(element => { element.hidden = false; element.style.removeProperty('display') })
    await screenshot('dashboard-off')

    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(dialog).toHaveAccessibleName('加班设置')
    await expect(time).toBeFocused()
    await expect(time).toHaveValue('18:00')
    assert.deepEqual(await geometry(), original)
    await assertCentered()
    await page.setViewportSize({ width: 360, height: 410 })
    await assertCentered()
    await page.setViewportSize({ width: 720, height: 600 })
    await assertCentered()
    await screenshot('time-dialog')

    const cdp = await page.context().newCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const timeSegments = nodes.filter(node => node.role?.value === 'spinbutton')
    assert.deepEqual(timeSegments.map(node => node.value?.value), [18, 0])
    const field = await time.boundingBox()
    const openPicker = time.and(page.locator('input:open'))
    await time.click({ position: { x: field.width / 2, y: field.height / 2 } })
    await expect(openPicker).toHaveCount(1)
    await screenshot('time-picker')
    await dialog.getByRole('heading').click()
    await expect(openPicker).toHaveCount(0)
    await time.press('Space')
    await expect(openPicker).toHaveCount(1)
    await dialog.getByRole('heading').click()
    await expect(openPicker).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeFocused()
    assert.deepEqual(calls, { stage: 0, save: 0, discard: 0 })
    await toggle.click()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(toggle).toBeFocused()
    await expect(timer).toHaveText('03:00:00')

    await toggle.click()
    await expect(time).toHaveValue('18:00')
    await dialog.getByRole('button', { name: '确认加班' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('当前选择的是正常下班时间。请选择加班结束时间。')
    assert.deepEqual(calls, { stage: 0, save: 0, discard: 0 })
    await time.fill('19:00')
    failure = true
    await dialog.getByRole('button', { name: '确认加班' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('测试：配置目录不可写。')
    await expect(time).toHaveValue('19:00')
    await expect(track).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.app-toast')).toHaveCount(0)
    assert.deepEqual(calls, { stage: 1, save: 1, discard: 1 })
    assert.equal(staged, null)
    failure = false
    let releaseSave
    saveGate = new Promise(resolveSave => { releaseSave = resolveSave })
    await dialog.getByRole('button', { name: '确认加班' }).click()
    const savingButton = dialog.getByRole('button', { name: '正在保存…' })
    await expect(savingButton).toBeDisabled()
    await savingButton.evaluate(button => button.click())
    assert.equal(calls.save, 2)
    await expect(track).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    releaseSave()
    saveGate = null
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(track).toHaveCSS('background-color', 'rgb(8, 117, 237)')
    await expect(track.locator('span')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 13, 0)')
    await expect(timer).toHaveText('04:00:00')
    await page.reload()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await screenshot('dashboard-on')
    await page.getByRole('button', { name: '修改加班时间' }).click()
    await expect(time).toHaveValue('19:00')
    await time.fill('20:00')
    await dialog.getByRole('button', { name: '确认加班' }).click()
    await expect(timer).toHaveText('05:00:00')
    assert.equal(config.overtime.entries.length, 1)

    await toggle.click()
    await expect(dialog).toHaveAccessibleName('恢复正常下班时间')
    await expect(dialog).toHaveAccessibleDescription('当前已设置加班至 20:00。 确认后，今天的下班时间将恢复为 18:00。')
    await assertCentered()
    await page.setViewportSize({ width: 480, height: 520 })
    await assertCentered()
    await page.setViewportSize({ width: 720, height: 600 })
    await screenshot('cancel-dialog')
    await dialog.getByRole('button', { name: '保留加班' }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(timer).toHaveText('05:00:00')
    await toggle.click()
    failure = true
    discardBlocked = true
    await dialog.getByRole('button', { name: '确认恢复' }).click()
    await expect(dialog.getByRole('alert')).toContainText('测试：配置目录不可写。')
    await expect(track).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.app-toast')).toHaveCount(0)
    assert.equal(staged.input, null)
    failure = false
    discardBlocked = false
    await dialog.getByRole('button', { name: '重试核对' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await dialog.getByRole('button', { name: '确认恢复' }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(timer).toHaveText('03:00:00')
    const notice = page.locator('.app-toast[role=status]')
    await expect(notice).toHaveText('今天不加班，回去好好休息～')
    await screenshot('cancel-success')
    await page.setViewportSize({ width: 480, height: 520 })
    const heroBounds = await page.locator('.dashboard-primary').boundingBox()
    assert.ok((await notice.boundingBox()).y >= heroBounds.y + heroBounds.height)

    await toggle.click()
    await time.fill('19:00')
    snapshot = source.snapshots.rest
    await page.evaluate(() => window.pushOvertimeSnapshot())
    await expect(dialog.getByRole('button', { name: '确认加班' })).toBeDisabled()
    await expect(dialog.getByText('当前班次或配置已变化，请重新打开弹窗。')).toBeVisible()
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect(toggle).toBeDisabled()
    assert.deepEqual(calls, { stage: 5, save: 5, discard: 3 })

    snapshot = source.snapshots.working
    await page.evaluate(() => window.pushOvertimeSnapshot())
    const bounds = await page.locator('.overtime-pill').boundingBox()
    const primary = await page.locator('.dashboard-primary').boundingBox()
    const headingLeft = await page.locator('.we-countdown h2').evaluate(heading => {
      const range = document.createRange()
      range.selectNodeContents(heading)
      return range.getBoundingClientRect().left
    })
    const status = await page.locator('.we-countdown-header').boundingBox()
    assert.ok(bounds.x > primary.x && bounds.y > primary.y && bounds.x + bounds.width < Math.min(headingLeft, status.x))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await expect(notice).toHaveCount(0)
    await screenshot('dashboard-narrow')

    config.overtime = source.expectedByTime['00:30'].overtime
    snapshot = { ...snapshot, activeShift: { ...snapshot.activeShift, overtimeMinutes: config.overtime.entries[0].minutes } }
    await page.evaluate(() => window.pushOvertimeSnapshot())
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()
    await expect(dialog).toHaveAccessibleDescription('当前已设置加班至 2026-10-16 00:30。 确认后，今天的下班时间将恢复为 2026-10-15 18:00。')
    await dialog.getByRole('button', { name: '保留加班' }).click()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
