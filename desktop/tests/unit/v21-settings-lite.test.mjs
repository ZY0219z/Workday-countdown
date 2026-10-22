import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium, expect } from '@playwright/test'
import { fixtures, createSettingsDraft } from '../../test-results/d11-ssr/components.mjs'

test('UI-07 real App saves common settings without resetting hidden fields; leave/IME/recovery stay safe',async()=>{
  const directory=resolve('test-results/v21-ui06-ui07/settings'),bundle=resolve(directory,'bundle')
  await mkdir(directory,{recursive:true})
  await build({configFile:false,plugins:[vue()],logLevel:'warn',define:{'process.env.NODE_ENV':'"production"'},build:{outDir:bundle,emptyOutDir:false,lib:{entry:resolve('tests/unit/v21-settings-lite.entry.mjs'),formats:['es'],fileName:()=>'settings.mjs'}}})
  const css=(await readdir(bundle)).find(file=>file.endsWith('.css')), f=fixtures()
  const config=structuredClone(f.config)
  config.appearance={mode:'dark',accent:'coral',reduceMotion:false}
  config.calendar.overrides={'2026-10-20':'rest','2026-10-21':'work'}
  config.desktop.alwaysOnTop=true
  const session={...createSettingsDraft(config).data,configurationStatus:'ready',expectedEnd:f.expectedEnd}
  const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true})
  try{
    const page=await browser.newPage({viewport:{width:720,height:580}})
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000)
    await page.route('http://settings.test/**',async route=>{
      const path=new URL(route.request().url()).pathname.slice(1)
      if(!path)return route.fulfill({contentType:'text/html',body:`<html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/${css}"><div id="app"></div><script type="module" src="/settings.mjs"></script></html>`})
      if(path!=='settings.mjs'&&path!==css)return route.fulfill({status:404,body:''})
      return route.fulfill({contentType:path.endsWith('.css')?'text/css':'text/javascript',body:await readFile(resolve(bundle,path))})
    })
    await page.goto('http://settings.test/')
    await page.waitForFunction(()=>typeof window.__settingsInit==='function')
    const initialize=async status=>{
      await page.evaluate(value=>window.__settingsInit(value),{session:{...session,configurationStatus:status},snapshot:f.snapshots.working,metadata:f.metadata})
      await page.getByRole('button',{name:'设置',exact:true}).click()
      await expect(page.getByRole('heading',{name:status==='ready'?'设置中心':'配置恢复',exact:true})).toBeVisible()
    }
    await initialize('ready')
    const view=page.getByRole('region',{name:'设置中心',exact:true})
    assert.doesNotMatch(await view.innerText(),/更多设置|设置分组|外观主题|离线工作日历|导出已保存配置|预览最近有效备份/)
    await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-theme','light')
    await expect(page.locator('[data-workday-root]')).toHaveAttribute('data-accent','ocean')
    await page.getByLabel('上班时间',{exact:true}).fill('08:45')
    await page.getByLabel('下班时间',{exact:true}).fill('18:30')
    await page.getByLabel('每月发薪日',{exact:true}).fill('15')
    await page.getByLabel('入职日期',{exact:true}).fill('2026-09-30')
    await page.getByRole('switch',{name:'启用迷你模式'}).check()
    await page.getByRole('button',{name:'保存设置',exact:true}).click()
    await expect(page.getByRole('heading',{name:'设置中心',exact:true})).toHaveCount(0)
    let state=await page.evaluate(()=>window.__settingsState())
    assert.equal(state.calls.save.length,1)
    const stored=state.calls.save[0].settings
    for(const key of ['calendar','appearance','overtime'])assert.deepEqual(stored[key],session.draft[key],key)
    assert.deepEqual(stored.schedule.workWeek,session.draft.schedule.workWeek)
    assert.deepEqual(stored.schedule.breaks,session.draft.schedule.breaks)
    assert.deepEqual({...stored.desktop,miniEnabled:session.draft.desktop.miniEnabled},session.draft.desktop)
    assert.equal(stored.desktop.miniEnabled,true);assert.equal(stored.schedule.startTime,'08:45');assert.equal(stored.schedule.endTime,'18:30');assert.equal(stored.salary.day,15)
    assert.equal(stored.employee.startDate,'2026-09-30')
    await page.getByRole('button',{name:'设置',exact:true}).click()
    await page.screenshot({path:resolve(directory,'settings-daily.png'),fullPage:true})
    await page.getByLabel('今天预计下班时间',{exact:true}).fill('19:00')
    await expect.poll(async()=>(await page.evaluate(()=>window.__settingsState())).calls.expectedEnd.at(-1)?.input).toBe('19:00')
    await page.getByRole('button',{name:'取消今天加班',exact:true}).click()
    await expect.poll(async()=>(await page.evaluate(()=>window.__settingsState())).calls.expectedEnd.at(-1)?.input).toBe(null)
    await expect(page.getByLabel('今天预计下班时间',{exact:true})).toHaveValue('18:00')
    const input=page.getByLabel('上班时间',{exact:true})
    await input.dispatchEvent('compositionstart')
    await page.getByRole('button',{name:'保存设置',exact:true}).click()
    await expect(page.getByRole('alert')).toContainText('输入法组合输入')
    await input.dispatchEvent('compositionend')
    await input.fill('08:50')
    await page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button',{name:'继续编辑',exact:true}).click()
    await page.getByRole('button',{name:'退出程序',exact:true}).click()
    await expect.poll(async()=>(await page.evaluate(()=>window.__settingsState())).calls.quitRequests).toBe(1)
    assert.equal((await page.evaluate(()=>window.__settingsState())).calls.quit,0)
    await page.getByRole('button',{name:'取消 / 返回仪表盘',exact:true}).click()
    await page.getByRole('button',{name:'放弃',exact:true}).click()
    assert.equal((await page.evaluate(()=>window.__settingsState())).saved.draft.schedule.startTime,'08:45')
    for(const status of ['recoverable','invalid','future']){
      await initialize(status)
      await expect(page.getByLabel('上班时间',{exact:true})).toBeDisabled()
      await expect(page.getByRole('button',{name:'保存设置',exact:true})).toBeDisabled()
      await expect(page.getByRole('button',{name:'确认备份并应用所选字段',exact:true})).toHaveCount(0)
      await page.getByRole('button',{name:'预览最近有效备份',exact:true}).click()
      if(status==='future'){
        await expect(page.getByRole('alert')).toContainText('较新版本配置只读')
        await expect(page.getByRole('region',{name:'导入预览',exact:true})).toHaveCount(0)
        assert.equal((await page.evaluate(()=>window.__settingsState())).calls.apply,0)
        continue
      }
      await expect(page.getByRole('region',{name:'导入预览',exact:true})).toBeVisible()
      assert.equal((await page.evaluate(()=>window.__settingsState())).calls.apply,0)
      await page.getByRole('button',{name:'确认备份并应用所选字段',exact:true}).click()
      await expect(page.getByRole('alert')).toContainText('只读版本保护')
      assert.equal((await page.evaluate(()=>window.__settingsState())).saved.expectedRevision,session.expectedRevision)
    }
    await page.screenshot({path:resolve(directory,'settings-recovery.png'),fullPage:true})
    await page.setViewportSize({width:280,height:114})
    await page.evaluate(value=>window.__settingsInit(value),{session,snapshot:f.snapshots.working,metadata:f.metadata,mini:true})
    const mini=page.getByRole('region',{name:'迷你倒计时',exact:true})
    await expect(mini).toHaveAttribute('data-theme','light');await expect(mini).toHaveAttribute('data-accent','ocean')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=280&&document.documentElement.scrollHeight<=114),true)
    await page.screenshot({path:resolve(directory,'mini-shared-style.png')})
    assert.deepEqual(errors,[])
  }finally{await browser.close()}
})
