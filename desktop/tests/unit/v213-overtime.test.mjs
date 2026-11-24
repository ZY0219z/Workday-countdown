import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

test('DEV-01 shortcut exercises the production dashboard headlessly', async () => {
  const output = resolve('test-results/v213-overtime-final-edge')
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
    const time = dialog.getByRole('button', { name: /^加班至/ })
    const hours = dialog.getByRole('listbox', { name: '小时' })
    const minutes = dialog.getByRole('listbox', { name: '分钟' })
    const picker = dialog.locator('.overtime-time-picker')
    const pickTime = async (hour, minute) => {
      await time.click()
      await hours.getByRole('option', { name: hour, exact: true }).click()
      await minutes.getByRole('option', { name: minute, exact: true }).click()
      await dialog.getByRole('heading').click()
      await expect(time).toHaveAccessibleName(`加班至 ${hour}:${minute}`)
    }
    const timer = page.getByRole('timer')
    const pill = page.locator('.overtime-pill')
    const track = page.locator('.overtime-switch')
    const assertCentered = async () => {
      const { x, y, width, height } = await dialog.boundingBox()
      const viewport = page.viewportSize()
      assert.ok(Math.abs(x + width / 2 - viewport.width / 2) <= 1, 'horizontal center')
      assert.ok(Math.abs(y + height / 2 - viewport.height / 2) <= 1, 'vertical center')
      assert.ok(x >= 11 && y >= 15, 'dialog fits the viewport')
      assert.ok(width<=300,'dialog retains the compact width')
      const buttons=await dialog.locator('.overtime-actions button').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().width))
      assert.ok(Math.abs(buttons[0]-buttons[1])<=1,'dialog action buttons have equal widths')
    }
    const dialogLayout = () => dialog.evaluate(element => [element, ...element.querySelectorAll('.overtime-form, .overtime-time p, .overtime-actions')]
      .map(item => item.getBoundingClientRect().toJSON()))
    const pickerGeometry = []
    const assertFloatingPicker = async closedLayout => {
      await expect(picker).toBeVisible()
      assert.deepEqual(await dialogLayout(),closedLayout,'the picker leaves dialog, hint and action geometry unchanged')
      const bounds=await picker.boundingBox(), field=await time.boundingBox(), frame=await dialog.boundingBox()
      const {width,height}=page.viewportSize()
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,`popover fits the viewport ${JSON.stringify({bounds,field,frame,width,height})}`)
      assert.ok(Math.abs(bounds.width-field.width)<1,'popover width matches the time trigger')
      assert.ok(bounds.y>=field.y+field.height+5||bounds.y+bounds.height<=field.y-5,'popover anchors below or above the trigger')
      assert.equal(await picker.evaluate(element=>element.matches(':popover-open')),true,'picker uses the native top layer')
      assert.ok(await picker.evaluate(element=>{
        const box=element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(box.x+box.width/2,box.bottom-3))
      }),'picker is painted above the modal and its overflow boundary')
      pickerGeometry.push({viewport:page.viewportSize(),frame,trigger:field,picker:bounds})
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
    await expect(time).toHaveCSS('outline-width','1px')
    await expect(time).toHaveCSS('outline-offset','-1px')
    await expect(time).toHaveAccessibleName('加班至 18:00')
    await expect(time).toHaveCSS('width', '152px')
    await expect(dialog.locator('.overtime-time p')).toHaveText('正常下班时间：18:00')
    await expect(dialog.locator('.overtime-time p br')).toHaveCount(0)
    assert.deepEqual(await geometry(), original)
    await assertCentered()
    await page.setViewportSize({ width: 360, height: 410 })
    await assertCentered()
    await page.setViewportSize({ width: 720, height: 600 })
    await assertCentered()
    await screenshot('time-dialog-keyboard')

    let closedLayout=await dialogLayout()
    await time.click()
    assert.ok(await time.evaluate(element=>parseFloat(getComputedStyle(element).outlineWidth)<=1),'keyboard focus remains a single restrained line')
    await assertFloatingPicker(closedLayout)
    await expect(time).toHaveAttribute('aria-expanded', 'true')
    await expect(hours.getByRole('option')).toHaveCount(24)
    await expect(minutes.getByRole('option')).toHaveCount(60)
    await expect(hours.getByRole('option', { selected: true })).toBeInViewport()
    await expect(minutes.getByRole('option', { selected: true })).toBeInViewport()
    await screenshot('time-picker')
    for(const viewport of [{width:360,height:340},{width:280,height:260},{width:480,height:400}]){
      await page.keyboard.press('Escape')
      await expect(picker).toBeHidden()
      await page.setViewportSize(viewport)
      await assertCentered()
      closedLayout=await dialogLayout()
      await time.click()
      await assertFloatingPicker(closedLayout)
      await dialog.getByRole('heading').click()
      await expect(picker).toBeHidden()
      assert.deepEqual(await dialogLayout(),closedLayout)
      await time.click()
    }
    await assertCentered()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 720, height: 600 })
    await time.click()
    await hours.getByRole('option', { name: '20', exact: true }).click()
    await minutes.getByRole('option', { name: '37', exact: true }).click()
    await expect(time).toHaveAccessibleName('加班至 20:37')
    const selectedHour = hours.getByRole('option', { selected: true })
    await expect(selectedHour).toHaveText('20')
    assert.equal(await selectedHour.evaluate(element=>getComputedStyle(element).backgroundColor),await time.evaluate(element=>getComputedStyle(element.parentElement).backgroundColor))
    await expect(selectedHour).toHaveCSS('outline-style', 'none')
    await dialog.getByRole('heading').click()
    await expect(picker).toBeHidden()
    await time.press('Space')
    await expect(hours).toBeFocused()
    await expect(hours).toHaveCSS('outline-width', '1px')
    await expect(hours).toHaveCSS('outline-offset','-1px')
    await expect(selectedHour).toBeInViewport()
    await expect(minutes.getByRole('option', { selected: true })).toBeInViewport()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Tab')
    await expect(minutes).toBeFocused()
    await page.keyboard.press('End')
    await expect(time).toHaveAccessibleName('加班至 19:59')
    await expect(minutes.getByRole('option', { selected: true })).toBeInViewport()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(time).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(toggle).toBeFocused()
    assert.deepEqual(calls, { stage: 0, save: 0, discard: 0 })
    await toggle.click()
    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(toggle).toBeFocused()
    await expect(timer).toHaveText('03:00:00')

    await page.emulateMedia({ colorScheme: 'dark' })
    await toggle.click()
    await expect(time).toHaveCSS('outline-style','none')
    await assertCentered()
    await screenshot('time-dialog-dark')
    closedLayout=await dialogLayout()
    await time.click()
    await assertFloatingPicker(closedLayout)
    await screenshot('time-picker-dark')
    await dialog.getByRole('button',{name:'取消',exact:true}).click()
    await expect(picker).toBeHidden()
    await page.emulateMedia({ colorScheme: 'light' })

    await toggle.click()
    await expect(time).toHaveAccessibleName('加班至 18:00')
    await expect(time).toHaveCSS('outline-style','none')
    await screenshot('time-dialog')
    await time.click()
    await screenshot('time-picker')
    await dialog.getByRole('heading').click()
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('当前选择的是正常下班时间。请选择加班结束时间。')
    assert.deepEqual(calls, { stage: 0, save: 0, discard: 0 })
    await pickTime('19', '00')
    failure = true
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('测试：配置目录不可写。')
    await expect(time).toHaveAccessibleName('加班至 19:00')
    await expect(track).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('.app-toast')).toHaveCount(0)
    assert.deepEqual(calls, { stage: 1, save: 1, discard: 1 })
    assert.equal(staged, null)
    failure = false
    let releaseSave
    saveGate = new Promise(resolveSave => { releaseSave = resolveSave })
    await dialog.getByRole('button', { name: '保存' }).click()
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
    await expect(time).toHaveAccessibleName('加班至 19:00')
    await pickTime('20', '00')
    await dialog.getByRole('button', { name: '保存' }).click()
    await expect(timer).toHaveText('05:00:00')
    assert.equal(config.overtime.entries.length, 1)

    await toggle.click()
    await expect(dialog).toHaveAccessibleName('加班取消')
    await expect(dialog).toHaveAccessibleDescription('当前计划加班至 20:00 是否可以准点下班？')
    await assertCentered()
    await page.setViewportSize({ width: 480, height: 520 })
    await assertCentered()
    await page.setViewportSize({ width: 720, height: 600 })
    await screenshot('cancel-dialog')
    await dialog.getByRole('button', { name: '依旧加班' }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(timer).toHaveText('05:00:00')
    await toggle.click()
    failure = true
    discardBlocked = true
    await dialog.getByRole('button', { name: '到点就跑' }).click()
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
    await dialog.getByRole('button', { name: '到点就跑' }).click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(timer).toHaveText('03:00:00')
    const notice = page.locator('.app-toast[role=status]')
    await expect(notice).toHaveText('今天不加班，回去好好休息～')
    await expect(notice).toHaveCSS('background-color', 'rgb(230, 246, 236)')
    await expect(notice).toHaveCSS('border-top-color', 'rgb(179, 217, 190)')
    await expect(notice).toHaveCSS('color', 'rgb(20, 83, 45)')
    await expect(notice.locator('svg')).toHaveCSS('stroke', 'rgb(24, 115, 65)')
    await screenshot('cancel-success')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(notice).toHaveCSS('background-color', 'rgb(206, 232, 214)')
    await expect(notice).toHaveCSS('color', 'rgb(20, 83, 45)')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 480, height: 520 })
    const heroBounds = await page.locator('.dashboard-primary').boundingBox()
    assert.ok((await notice.boundingBox()).y >= heroBounds.y + heroBounds.height)

    await toggle.click()
    await pickTime('19', '00')
    snapshot = source.snapshots.rest
    await page.evaluate(() => window.pushOvertimeSnapshot())
    await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
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
    await expect(dialog).toHaveAccessibleDescription('当前计划加班至 2026-10-16 00:30 是否可以准点下班？')
    await dialog.getByRole('button', { name: '依旧加班' }).click()
    await writeFile(resolve(output,'picker-geometry.json'),JSON.stringify(pickerGeometry,null,2))
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})
