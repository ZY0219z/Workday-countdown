import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { fixtures, initialEditor, renderSettings } from '../../test-results/d11-ssr/components.mjs'

test('UI-01/UI-05 headless CSS states preserve selection, primary, disabled and focus across four themes', async () => {
  const read = path => readFile(resolve(path), 'utf8')
  const [tokens, base, miniSource, settingsSource, timeSource, errorsSource] = await Promise.all([
    read('src/renderer/src/styles/tokens.css'), read('src/renderer/src/styles/base.css'),
    read('src/renderer/src/MiniApp.vue'), read('src/renderer/src/views/SettingsView.vue'),
    read('src/renderer/src/components/TimeInput.vue'), read('src/renderer/src/components/FieldErrors.vue')
  ])
  const styles = `${tokens}\n${base}\n${miniSource.match(/<style>([\s\S]*?)<\/style>/)[1]}`
  const directory = resolve('test-results/v21-ui-feedback')
  await mkdir(directory, { recursive: true })
  const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 760 } })
    const style = locator => locator.evaluate(element => {
      const css = getComputedStyle(element)
      return { background: css.backgroundColor, color: css.color, border: css.borderColor, shadow: css.boxShadow }
    })
    const away = () => page.mouse.move(0, 0)
    for (const theme of ['light', 'dark']) for (const accent of ['ocean', 'coral']) {
      await page.setContent(`<style>${styles}</style><div class="workday-ui" data-theme="${theme}" data-accent="${accent}" style="padding:16px">
        <section class="settings"><button id="normal" class="we-button">取消 / 返回仪表盘</button>
        <button id="primary" class="we-button we-button--primary">保存设置</button>
        <button id="selected" class="we-button" aria-pressed="true">已选中</button>
        <button id="disabled" class="we-button" disabled>不可操作</button>
        <fieldset disabled><button id="fieldset-disabled" class="we-button">保存中</button></fieldset></section>
        <section class="mini-shell" style="min-height:0;margin-top:16px;width:280px"><nav><button id="pin" aria-pressed="false">置顶</button></nav></section></div>`)
      const normal = page.locator('#normal'), pin = page.locator('#pin')
      await away()
      const normalStyle = await style(normal), pinNormal = await style(pin)
      await normal.hover()
      const hover = await style(normal)
      assert.notEqual(hover.background, normalStyle.background)
      await page.mouse.down()
      assert.notEqual((await style(normal)).background, hover.background)
      await page.mouse.up()
      for (const id of ['primary', 'selected', 'disabled', 'fieldset-disabled']) {
        await away()
        const control = page.locator(`#${id}`), before = await style(control)
        await control.hover()
        assert.deepEqual(await style(control), before, `${theme}/${accent}/${id} hover`)
        await page.mouse.down()
        assert.deepEqual(await style(control), before, `${theme}/${accent}/${id} active`)
        await page.mouse.up()
      }
      await normal.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      assert.equal(await normal.evaluate(element => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 3), true)
      await pin.hover()
      const pinHover = await style(pin)
      assert.notDeepEqual(pinHover, pinNormal)
      await pin.evaluate(element => element.setAttribute('aria-pressed', 'true'))
      const pinnedHover = await style(pin)
      await away()
      const pinned = await style(pin)
      assert.notDeepEqual(pinned, pinNormal)
      assert.notDeepEqual(pinnedHover, pinned)
      assert.equal(pinnedHover.background, pinned.background)
      assert.equal(pinnedHover.color, pinned.color)
      await pin.hover()
      await page.mouse.down()
      assert.notEqual((await style(pin)).shadow, pinnedHover.shadow)
      await page.mouse.up()
      await pin.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      assert.equal(await pin.evaluate(element => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 2), true)
      await pin.evaluate(element => { element.disabled = true })
      await away()
      const pinDisabled = await style(pin)
      await pin.hover()
      assert.deepEqual(await style(pin), pinDisabled)
      await pin.evaluate(element => { element.disabled = false })
      await page.screenshot({ path: resolve(directory, `buttons-${accent}-${theme}.png`) })
    }
    const issues = [{ field: '$.schedule.startTime', reason: 'FORMAT', message: 'invalid fixture' }, { field: '$.schedule', reason: 'RANGE', message: 'group fixture' }]
    const html = await renderSettings(initialEditor(), fixtures().metadata, { issues })
    const settingsStyles = [settingsSource, timeSource, errorsSource].map(source => source.match(/<style scoped>([\s\S]*?)<\/style>/)[1]).join('\n')
    await page.setContent(`<style>${tokens}\n${base}\n${settingsStyles}</style><main class="workday-ui" data-theme="light" data-accent="ocean" style="padding:16px">${html}</main>`)
    assert.equal(await page.locator('.field-error').count(), 2)
    await page.screenshot({ path: resolve(directory, 'settings-errors.png'), fullPage: true })
  } finally {
    await browser.close()
  }
})
