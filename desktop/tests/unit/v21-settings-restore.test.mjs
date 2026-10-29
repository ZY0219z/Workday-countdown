import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures, createSettingsDraft } from '../../test-results/d11-ssr/components.mjs'

test('UI-17 concise settings preserve drafts, time explanations, validation and recovery', async () => {
  const directory = resolve('test-results/v21-ui17/settings'), bundle = resolve(directory, 'bundle')
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
    const initialize = async (status = 'ready', appearance = config.appearance, source = session, expectedEndResponses) => {
      const value = structuredClone(source)
      value.configurationStatus = status; value.saved.appearance = appearance; value.draft.appearance = appearance
      await page.evaluate(value => window.__settingsInit(value), { session: value, snapshot: f.snapshots.working, metadata: f.metadata, expectedEndResponses })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await expect(page.getByRole('region',{name:'设置中心',exact:true})).toBeVisible()
      if(status==='ready')await expect(page.locator('.settings-title')).toHaveCount(0)
      else await expect(page.getByRole('heading',{name:'配置恢复',exact:true})).toBeVisible()
    }
    await initialize()
    const workTimes = async paired => {
      const geometry = await page.locator('.settings-work-times input').evaluateAll(inputs => inputs.map(input => input.getBoundingClientRect().toJSON()))
      assert.equal(geometry.length,2)
      assert.ok(geometry.every(input=>input.width>=120&&input.height>=40),'time controls retain usable sizes')
      assert.equal(Math.abs(geometry[0].top-geometry[1].top)<1,paired,'work time inputs use the expected responsive layout')
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    }
    const layouts=[]
    const personalFields=async paired=>{
      const geometry=await page.locator('.settings-personal-fields > .settings-card').evaluateAll(cards=>cards.map(card=>({
        card:card.getBoundingClientRect().toJSON(),input:card.querySelector('input').getBoundingClientRect().toJSON(),label:card.querySelector('.settings-label').getBoundingClientRect().toJSON(),text:card.textContent
      })))
      assert.equal(geometry.length,2)
      assert.equal(Math.abs(geometry[0].card.top-geometry[1].card.top)<1,paired,'employment and salary use the expected responsive columns')
      if(paired)assert.ok(Math.abs(geometry[0].card.height-geometry[1].card.height)<1,'paired cards stretch evenly to fit their own help')
      for(const field of geometry){assert.ok(field.input.width>=120&&field.input.height>=40);assert.ok(field.input.top>=field.label.bottom+7,'labels remain above their own controls')}
      assert.ok(geometry[0].text.includes('可留空'));assert.ok(geometry[1].text.includes('发上月工资'))
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      const top=await page.locator('.settings').evaluate(element=>({section:element.getBoundingClientRect().top,first:element.querySelector('.settings-work-times').getBoundingClientRect().top}))
      assert.ok(Math.abs(top.section-top.first)<1,'no removed heading row or blank space remains')
      layouts.push({viewport:page.viewportSize(),paired,geometry,top})
    }
    await workTimes(true)
    await personalFields(true)
    const checkIcons=async()=>{
      const icons=await page.locator('.settings .ui-icon--tile').evaluateAll(elements=>elements.map(element=>({
        bounds:element.getBoundingClientRect().toJSON(),viewBox:element.getAttribute('viewBox'),aspect:element.getAttribute('preserveAspectRatio'),stroke:element.getAttribute('stroke-width'),shrink:getComputedStyle(element).flexShrink,
        paths:[...element.querySelectorAll('path')].map(p=>{const b=p.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height}})
      })))
      assert.equal(icons.length,6,'six field labels retain their framed icons without the removed normal heading')
      assert.ok(icons.every(icon=>icon.bounds.width===34&&icon.bounds.height===34&&icon.viewBox==='0 0 24 24'&&icon.aspect==='xMidYMid meet'&&icon.stroke==='1.9'&&icon.shrink==='0'),'icons retain identical square geometry and stroke')
    }
    await checkIcons()
    await expect(page.locator('.settings-card')).toHaveCount(5)
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
    await page.getByLabel('入职日期', { exact: true }).fill('2025-07-20')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置中心', exact: true })).toHaveCount(0)
    let state = await page.evaluate(() => window.__settingsState())
    assert.equal(state.saves.length, 1)
    const stored = state.saves[0].settings
    for (const key of ['calendar', 'appearance', 'overtime']) assert.deepEqual(stored[key], session.draft[key], key)
    assert.deepEqual(stored.employee,{...session.draft.employee,startDate:'2025-07-20'})
    assert.deepEqual(stored.schedule, { ...session.draft.schedule, startTime: '08:45', endTime: '18:30' })
    assert.deepEqual(stored.salary, { ...session.draft.salary, day: 15 })
    assert.deepEqual(stored.desktop, { ...session.draft.desktop, miniEnabled: true })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByLabel('上班时间', { exact: true })).toHaveValue('08:45')
    await expect(page.getByLabel('下班时间', { exact: true })).toHaveValue('18:30')
    await expect(page.getByLabel('启用迷你窗', { exact: true })).toBeChecked()
    await expect(page.getByLabel('入职日期',{exact:true})).toHaveValue('2025-07-20')
    await expect(page.getByLabel('每月发薪日',{exact:true})).toHaveValue('15')
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
    await page.getByLabel('下班时间', { exact: true }).fill('bad')
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    for(const label of ['上班时间','下班时间']) {
      const input=page.getByLabel(label,{exact:true})
      await expect(input).toHaveAttribute('aria-invalid','true')
      assert.ok(await input.evaluate(element=>element.getAttribute('aria-describedby').split(' ').some(id=>{
        const error=document.getElementById(id)
        return error?.getAttribute('role')==='alert'&&error.textContent.trim().length>0
      })),'each invalid input points to its rendered error, independently of its format hint')
    }
    const descriptions=await page.locator('.settings-work-times input').evaluateAll(inputs=>inputs.map(input=>input.getAttribute('aria-describedby')))
    assert.notEqual(descriptions[0],descriptions[1])
    await page.getByLabel('下班时间', { exact: true }).fill('18:30')
    await expect(page.getByLabel('下班时间',{exact:true})).toBeFocused()
    assert.equal((await page.evaluate(() => window.__settingsState())).saves.length, 1)
    await page.getByLabel('上班时间', { exact: true }).fill('08:45')
    await page.getByLabel('每月发薪日', { exact: true }).fill('16')
    await page.getByRole('button', { name: '退出程序', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.__settingsState())).calls.quit).toBe(1)
    await expect(page.getByRole('region', { name: '设置中心', exact: true })).toBeVisible()
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
      await checkIcons()
      await page.screenshot({path:resolve(directory,`settings-${appearance.mode}-${appearance.accent}.png`),fullPage:true})
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
    visual.schedule.startTime = '08:30'; visual.schedule.endTime = '18:00'
    visual.employee.startDate = '2025-07-17'; visual.desktop.miniEnabled = true
    const visualSession = { ...createSettingsDraft(visual).data, expectedEnd: { ...f.expectedEnd,
      shiftDate: '2026-10-23', normalEnd: { date: '2026-10-23', time: '18:00' }, finalEnd: { date: '2026-10-23', time: '18:00' } } }
    await initialize('ready', config.appearance, visualSession)
    await workTimes(true)
    await personalFields(true)
    await expect(page.getByRole('heading',{name:'今天你摸鱼了吗',level:1,exact:true})).toHaveCount(1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(directory, 'settings-approved.png'), fullPage: true })
    await page.locator('.settings-work-times').screenshot({path:resolve(directory,'work-times.png')})
    await page.locator('.app-title').screenshot({path:resolve(directory,'title.png')})
    await page.locator('.settings-personal-fields').screenshot({path:resolve(directory,'personal-fields.png')})
    for(const width of [600,480,360]) {
      await page.setViewportSize({width,height:580});await workTimes(false);await personalFields(false);await checkIcons()
      await page.getByRole('button',{name:'保存设置',exact:true}).scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(()=>scrollY>0),'long settings remain vertically scrollable')
      await page.evaluate(()=>scrollTo(0,0))
    }
    await page.setViewportSize({ width: 360, height: 580 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(directory, 'settings-360.png'), fullPage: true })
    await page.setViewportSize({width:720,height:580})
    const overtime=structuredClone(visualSession)
    overtime.draft.schedule.endTime=overtime.saved.schedule.endTime='12:00'
    overtime.draft.overtime.entries=overtime.saved.overtime.entries=[{shiftDate:'2026-10-29',minutes:60}]
    const current={available:true,targetKey:'ui17-overtime',shiftDate:'2026-10-29',normalEnd:{date:'2026-10-29',time:'12:00'},finalEnd:{date:'2026-10-29',time:'13:00'},minutes:60}
    overtime.expectedEnd=current
    const cancelled={...current,previewEnd:current.normalEnd}
    await initialize('ready',config.appearance,overtime,{
      '12:00':{context:cancelled},cancel:{context:cancelled},'13:00':{context:{...current,previewEnd:current.finalEnd}},
      bad:{context:current,issues:[{field:'$.expectedEndTime',reason:'FORMAT',message:'请输入24小时制HH:MM（00:00–23:59）。'}]}
    })
    await expect(page.locator('.settings-expected')).toContainText('已设置加班 60 分钟')
    await expect(page.locator('.settings-end-comparison')).toHaveCount(0)
    await page.getByLabel('每月发薪日',{exact:true}).fill('11')
    await expect(page.locator('.settings-save-state')).toHaveText('有未保存修改')
    await expect(page.locator('.settings-end-comparison')).toHaveCount(0)
    await page.getByLabel('今天预计下班时间',{exact:true}).fill('12:00')
    await expect(page.locator('.settings-end-comparison')).toContainText('当前生效：13:00（已设置加班 60 分钟）')
    await expect(page.locator('.settings-end-comparison')).toContainText('保存后：12:00')
    assert.equal((await page.evaluate(()=>window.__settingsState())).saves.length,0)
    await page.screenshot({path:resolve(directory,'settings-pending-overtime.png'),fullPage:true})
    await page.locator('.settings-expected').screenshot({path:resolve(directory,'overtime-comparison.png')})
    await page.getByRole('button',{name:'取消今天加班',exact:true}).click()
    await expect.poll(async()=>(await page.evaluate(()=>window.__settingsState())).calls.expectedEnd.at(-1)?.input).toBe(null)
    await expect(page.getByLabel('今天预计下班时间',{exact:true})).toHaveValue('12:00')
    await expect(page.locator('.settings-end-comparison')).toContainText('保存后：12:00')
    await page.getByLabel('今天预计下班时间',{exact:true}).fill('13:00')
    await expect(page.locator('.settings-end-comparison')).toHaveCount(0)
    await page.getByLabel('今天预计下班时间',{exact:true}).fill('bad')
    await expect(page.getByLabel('今天预计下班时间',{exact:true})).toHaveAttribute('aria-invalid','true')
    await expect(page.locator('.settings-end-comparison')).toHaveCount(0)
    await expect(page.locator('.settings-expected [role="alert"]')).toContainText('HH:MM')

    const overnight=structuredClone(visualSession)
    overnight.draft.schedule.endTime=overnight.saved.schedule.endTime='22:00'
    overnight.draft.overtime.entries=overnight.saved.overtime.entries=[{shiftDate:'2026-10-29',minutes:150}]
    overnight.expectedEnd={...current,normalEnd:{date:'2026-10-29',time:'22:00'},finalEnd:{date:'2026-10-30',time:'00:30'},minutes:150}
    const nextEnd={date:'2026-10-30',time:'01:00'}
    await initialize('ready',config.appearance,overnight,{'01:00':{context:{...overnight.expectedEnd,previewEnd:nextEnd}}})
    await expect(page.locator('.settings-expected')).toContainText('当前生效：2026-10-30 00:30')
    await page.getByLabel('今天预计下班时间',{exact:true}).fill('01:00')
    await expect(page.locator('.settings-end-comparison')).toContainText('保存后：2026-10-30 01:00')
    await page.screenshot({path:resolve(directory,'settings-overnight.png'),fullPage:true})
    const unavailable=structuredClone(visualSession)
    unavailable.expectedEnd={available:false,message:'当前没有可明确识别的常规班次，不能设置今天加班。'}
    await initialize('ready',config.appearance,unavailable)
    await expect(page.getByLabel('今天预计下班时间',{exact:true})).toBeDisabled()
    await expect(page.locator('.settings-expected')).toContainText('当前没有可明确识别的常规班次')
    await expect(page.locator('.settings-end-comparison')).toHaveCount(0)

    const invalidFields=structuredClone(visualSession)
    invalidFields.issues=[{field:'$.employee.startDate',reason:'FORMAT',message:'invalid date'},{field:'$.salary.day',reason:'RANGE',message:'invalid salary'}]
    await initialize('ready',config.appearance,invalidFields)
    for(const label of ['入职日期','每月发薪日']){
      const input=page.getByLabel(label,{exact:true})
      await expect(input).toHaveAttribute('aria-invalid','true')
      assert.ok(await input.evaluate(element=>{
        const error=document.getElementById(element.getAttribute('aria-describedby'))
        return error?.getAttribute('role')==='alert'&&element.closest('.settings-card').contains(error)&&error.textContent.trim().length>0
      }),'each personal field points to its own card error')
    }
    await initialize('ready',config.appearance,visualSession)
    await page.setViewportSize({width:360,height:580})
    await page.emulateMedia({forcedColors:'active'})
    assert.equal(await page.locator('.app-title-art').evaluate(element=>getComputedStyle(element).display),'none')
    await workTimes(false)
    await page.screenshot({path:resolve(directory,'settings-forced-colors-360.png'),fullPage:true})
    await page.close()
    page = await browser.newPage({ viewport: { width: 480, height: 387 }, deviceScaleFactor: 1.5 })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://settings.test/**', serve)
    await page.goto('http://settings.test/')
    await page.waitForFunction(() => typeof window.__settingsInit === 'function')
    await initialize('ready', config.appearance, visualSession)
    assert.equal(await page.evaluate(() => devicePixelRatio), 1.5)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await checkIcons()
    await personalFields(false)
    await page.screenshot({ path: resolve(directory, 'settings-dpr150.png'), fullPage: true })
    await page.locator('.settings-work-times').screenshot({path:resolve(directory,'icons-zoom-dpr150.png')})
    await page.close()
    page = await browser.newPage({viewport:{width:720,height:580},deviceScaleFactor:3})
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('http://settings.test/**',serve);await page.goto('http://settings.test/')
    await page.waitForFunction(()=>typeof window.__settingsInit==='function')
    await initialize('ready',config.appearance,visualSession);await checkIcons();await workTimes(true)
    const names=['上班','下班','预计下班','入职','发薪','迷你窗'],frames=[]
    for(const [i,name] of names.entries()){
      const buffer=await page.locator('.settings .ui-icon--tile').nth(i).screenshot()
      await writeFile(resolve(directory,`icon-${i}.png`),buffer)
      frames.push(`<figure><img src="data:image/png;base64,${buffer.toString('base64')}"><figcaption>${name}</figcaption></figure>`)
    }
    await page.close()
    page=await browser.newPage({viewport:{width:900,height:190}})
    await page.setContent(`<style>body{margin:0;padding:16px;background:#f0f7fd;color:#16375f;font:14px 'Microsoft YaHei',sans-serif}p{margin:0 0 12px}.icons{display:flex;gap:16px}figure{margin:0;text-align:center}img{display:block;width:102px;height:102px}figcaption{margin-top:8px}</style><p>真实 Vue 图标局部截图 · DPR 3 · 保持原始像素</p><div class="icons">${frames.join('')}</div>`)
    await page.screenshot({path:resolve(directory,'icons-strip.png'),fullPage:true})
    assert.deepEqual(errors, [])
    await writeFile(resolve(directory,'checks.json'),JSON.stringify({headless:true,errors,layouts,checks:['responsive personal cards and unchanged work time inputs','no normal heading row; named settings region retained','native date and bounded number save/reload','independent field errors and no focus capture','13:00 current vs 12:00 unsaved; unchanged/no-preview suppressed','invalid preview, cancellation and explicit overnight date','hidden draft fields, IME, Mini, cancel/quit/discard and recovery','themes, forced colors, DPR 1.5, no horizontal overflow']},null,2))
  } finally {
    await browser.close()
  }
})
