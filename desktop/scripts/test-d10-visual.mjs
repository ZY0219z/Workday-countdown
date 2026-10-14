import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { build } from 'vite'
import { chromium } from 'playwright'

// Headless browser, not Electron or a real GUI suite. No persistent user profile,
// no GUI lease, no automatic visible-browser fallback and no sandbox override.
await build({ configFile: 'vite.components.config.ts', logLevel: 'warn' })
const output = resolve('test-results/d10-components'), evidenceDirectory = resolve('test-results/d10-visual')
await mkdir(evidenceDirectory, { recursive: true })
const files = await readdir(output, { recursive: true, withFileTypes: true })
const assets = new Map(files.filter(file => file.isFile()).map(file => {
  const full = resolve(file.parentPath, file.name)
  return ['/' + relative(output, full).split(sep).join('/'), full]
}))
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.gif': 'image/gif' }
const browser = await chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true })
const checks = [], evidence = {}, errors = [], blockedRequests = []
async function check(name, run) {
  try { await run(); checks.push({ name, status: 'PASS' }); process.stdout.write(`PASS ${name}\n`) }
  catch (error) { checks.push({ name, status: 'FAIL', message: error.message }); throw error }
}
try {
  const page = await browser.newPage({ viewport: { width: 1640, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), full = url.origin === 'http://d10.test' ? assets.get(url.pathname) : undefined
    if (!full) { blockedRequests.push(url.href); return route.abort() }
    const extension = full.slice(full.lastIndexOf('.'))
    await route.fulfill({ body: await readFile(full), contentType: types[extension] || 'application/octet-stream' })
  })
  await page.goto('http://d10.test/preview/index.html')
  await page.locator('[data-testid="live-theme"][data-theme="light"]').waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.ready === 'true'))

  const live = page.getByTestId('live-theme'), mode = live.getByLabel('显示模式'), accent = live.getByLabel('配色')
  await check('default system/ocean; explicit light/dark and optional coral use the same components', async () => {
    assert.equal(await mode.inputValue(), 'system'); assert.equal(await accent.inputValue(), 'ocean')
    for (const selectedMode of ['light', 'dark']) for (const selectedAccent of ['ocean', 'coral']) {
      await mode.selectOption(selectedMode); await accent.selectOption(selectedAccent)
      await page.waitForFunction(({ selectedMode, selectedAccent }) => { const host = document.querySelector('[data-testid="live-theme"]'); return host.dataset.theme === selectedMode && host.dataset.accent === selectedAccent }, { selectedMode, selectedAccent })
      assert.equal(await live.locator('.we-countdown-value').innerText(), '03:28:17')
    }
  })
  await check('system color-scheme changes; explicit mode is stable; scope does not leak', async () => {
    const outsideBefore = await page.locator('#outside-scope').evaluate(element => ({ color: getComputedStyle(element).color, bg: getComputedStyle(element).backgroundColor, token: getComputedStyle(element).getPropertyValue('--we-bg') }))
    await mode.selectOption('system'); await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => document.querySelector('[data-testid="live-theme"]').dataset.theme === 'dark')
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.querySelector('[data-testid="live-theme"]').dataset.theme === 'light')
    await mode.selectOption('light'); await page.emulateMedia({ colorScheme: 'dark' }); assert.equal(await live.getAttribute('data-theme'), 'light')
    const outsideAfter = await page.locator('#outside-scope').evaluate(element => ({ color: getComputedStyle(element).color, bg: getComputedStyle(element).backgroundColor, token: getComputedStyle(element).getPropertyValue('--we-bg') }))
    assert.deepEqual(outsideAfter, outsideBefore); assert.equal(outsideAfter.token, '')
    await page.emulateMedia({ colorScheme: 'light' }); await accent.selectOption('ocean')
  })
  await check('actual theme and badge text contrast; controls and focus tokens meet 3:1', async () => {
    evidence.contrast = await page.evaluate(() => {
      const luminance = color => {
        const value = color.trim(), channels = value.startsWith('#') ? value.slice(1).match(/../g).map(x => parseInt(x, 16)) : value.match(/[\d.]+/g).slice(0, 3).map(Number)
        return channels.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0)
      }
      const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
      return [...document.querySelectorAll('.preview-theme')].map(host => {
        const css = getComputedStyle(host), token = name => css.getPropertyValue('--we-' + name)
        const renderedBadges = [...host.querySelectorAll('.we-badge')].map(element => { const style = getComputedStyle(element); return ratio(style.color, style.backgroundColor) })
        return { theme: host.dataset.theme, accent: host.dataset.accent, renderedBadges,
          text: ratio(token('text'), token('surface')), muted: ratio(token('muted'), token('surface')), accentText: ratio(token('accent'), token('surface')),
          button: ratio(token('button'), token('button-text')), controlBorder: ratio(token('control-border'), token('surface')), focus: ratio(token('accent'), token('bg')),
          badges: ['positive', 'neutral', 'warning', 'danger'].map(tone => ({ tone, contrast: ratio(token(tone + '-text'), token(tone + '-bg')) })) }
      })
    })
    for (const theme of evidence.contrast) {
      for (const key of ['text', 'muted', 'accentText', 'button']) assert.ok(theme[key] >= 4.5, JSON.stringify(theme))
      for (const key of ['controlBorder', 'focus']) assert.ok(theme[key] >= 3, JSON.stringify(theme))
      assert.ok(theme.badges.every(badge => badge.contrast >= 4.5), JSON.stringify(theme))
      assert.ok(theme.renderedBadges.every(contrast => contrast >= 4.5), JSON.stringify(theme))
    }
  })
  await check('all business states, estimates, rest/no-progress and salary ambiguity remain explicit', async () => {
    const text = await page.locator('.preview-states').innerText()
    for (const label of ['上班前', '工作中', '午休中', '加班中', '已下班', '休息日', '数据不完整', '估算', '无工作进度', '暂无唯一计划日期', '计划日期，不代表已到账', '2026-10-15']) assert.ok(text.includes(label), label)
    const breakCard = page.locator('.preview-state-grid .we-countdown').filter({ has: page.getByText('午休中', { exact: true }) })
    assert.ok((await breakCard.innerText()).includes('05:30:00')); assert.ok((await breakCard.innerText()).includes('最终下班'))
    assert.equal(await page.locator('.preview-state-grid .we-metric').filter({ hasText: '有效零值' }).locator('.we-metric-value').innerText(), '0 天')
    assert.equal(await page.locator('.preview-state-grid .we-countdown').filter({ hasText: '暂无可用倒计时' }).locator('[role="timer"]').count(), 0)
  })
  await check('tabular countdown digits have stable width; timer never announces each second', async () => {
    const output = live.locator('.we-countdown-value'), widths = []
    for (const value of ['03:28:17', '11:11:11', '88:88:88']) widths.push(await output.evaluate((element, value) => { element.textContent = value; const range = document.createRange(); range.selectNodeContents(element); return range.getBoundingClientRect().width }, value))
    await output.evaluate(element => { element.textContent = '03:28:17' })
    assert.ok(Math.max(...widths) - Math.min(...widths) < .5, JSON.stringify(widths)); evidence.digitWidths = widths
    assert.equal(await output.getAttribute('aria-live'), 'off'); assert.equal(await output.getAttribute('role'), 'timer')
    assert.equal(await output.evaluate(element => getComputedStyle(element).fontVariantNumeric), 'tabular-nums')
  })
  await check('720x780 has two metric columns; 480x560 stacks and scrolls to final content', async () => {
    evidence.main = await page.getByTestId('main-wide').evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, columns: getComputedStyle(element.querySelector('.preview-metrics')).gridTemplateColumns })))
    for (const window of evidence.main) { assert.equal(window.width, 720); assert.equal(window.height, 780); assert.equal(window.columns.split(' ').length, 2) }
    const narrow = page.getByTestId('main-narrow')
    evidence.narrow = await narrow.evaluate(element => { const body = element.querySelector('.preview-window-scroll'); return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, columns: getComputedStyle(element.querySelector('.preview-metrics')).gridTemplateColumns, scrolls: body.scrollHeight > body.clientHeight } })
    assert.equal(evidence.narrow.width, 480); assert.equal(evidence.narrow.height, 560); assert.equal(evidence.narrow.columns.split(' ').length, 1); assert.equal(evidence.narrow.scrolls, true)
    await narrow.locator('button').scrollIntoViewIfNeeded()
    assert.equal(await narrow.evaluate(element => { const button = element.querySelector('button').getBoundingClientRect(), body = element.querySelector('.preview-window-scroll').getBoundingClientRect(); return button.top >= body.top && button.bottom <= body.bottom + 1 }), true)
  })
  await check('280x132 and 240x112 static mini frames keep long digits and hints reachable', async () => {
    evidence.mini = await page.locator('.preview-mini').evaluateAll(elements => elements.map(element => {
      const output = element.querySelector('.we-countdown-value')
      return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, text: output.textContent, horizontalOverflow: element.scrollWidth > element.clientWidth + 1, digitsOverflow: output.scrollWidth > output.clientWidth + 1, scrolls: element.scrollHeight > element.clientHeight, overflowY: getComputedStyle(element).overflowY }
    }))
    for (const mini of evidence.mini) { assert.ok(mini.width === 280 || mini.width === 240); assert.equal(mini.height, mini.width === 280 ? 132 : 112); assert.equal(mini.horizontalOverflow, false); assert.equal(mini.digitsOverflow, false); assert.equal(mini.overflowY, 'auto') }
    assert.ok(evidence.mini.some(mini => mini.text === '100:00:00'))
    const small = page.getByTestId('mini-small'); await small.locator('.we-countdown-hint').scrollIntoViewIfNeeded()
    assert.equal(await small.evaluate(element => { const hint = element.querySelector('.we-countdown-hint').getBoundingClientRect(), frame = element.getBoundingClientRect(); return hint.top >= frame.top && hint.bottom <= frame.bottom + 1 }), true)
  })
  await check('keyboard tab has visible focus; controls have 32 DIP minimum targets', async () => {
    await page.reload(); await live.locator('select').first().waitFor()
    await page.keyboard.press('Tab')
    evidence.focus = await mode.evaluate(element => { const style = getComputedStyle(element); return { focused: element === document.activeElement, visible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), height: element.getBoundingClientRect().height } })
    assert.equal(evidence.focus.focused, true); assert.equal(evidence.focus.visible, true); assert.equal(evidence.focus.outlineStyle, 'solid'); assert.ok(evidence.focus.outlineWidth >= 3); assert.ok(evidence.focus.height >= 32)
    assert.ok(await live.locator('.we-check').evaluate(element => element.getBoundingClientRect().height >= 32))
  })
  await check('application OR system reduced motion disables scoped transitions without affecting outside', async () => {
    await page.evaluate(() => { for (const selector of ['[data-testid="live-theme"] h2', '#outside-scope']) { const element = document.querySelector(selector); element.style.transition = 'opacity 10s linear' } })
    await live.getByLabel('减少动画').check(); await page.waitForFunction(() => document.querySelector('[data-testid="live-theme"]').dataset.reducedMotion === 'true')
    assert.equal(await live.locator('h2').evaluate(element => getComputedStyle(element).transitionDuration), '0s')
    assert.equal(await page.locator('#outside-scope').evaluate(element => getComputedStyle(element).transitionDuration), '10s')
    await live.getByLabel('减少动画').uncheck(); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.querySelector('[data-testid="live-theme"]').dataset.reducedMotion === 'true')
    assert.equal(await live.locator('h2').evaluate(element => getComputedStyle(element).transitionDuration), '0s')
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForFunction(() => document.querySelector('[data-testid="live-theme"]').dataset.reducedMotion === 'false')
  })
  await check('forced colors retain card/badge borders and focus indication in headless emulation', async () => {
    await page.emulateMedia({ forcedColors: 'active' }); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    await mode.focus()
    evidence.forcedColors = await live.evaluate(element => { const card = getComputedStyle(element.querySelector('.we-countdown')), badge = getComputedStyle(element.querySelector('.we-badge')); return { active: matchMedia('(forced-colors: active)').matches, cardBorder: parseFloat(card.borderTopWidth), cardStyle: card.borderTopStyle, badgeBorder: parseFloat(badge.borderTopWidth), shadow: card.boxShadow } })
    assert.equal(evidence.forcedColors.active, true); assert.equal(evidence.forcedColors.cardStyle, 'solid'); assert.ok(evidence.forcedColors.cardBorder >= 1); assert.ok(evidence.forcedColors.badgeBorder >= 1); assert.equal(evidence.forcedColors.shadow, 'none')
    assert.ok(await mode.evaluate(element => element.matches(':focus-visible') && parseFloat(getComputedStyle(element).outlineWidth) >= 3))
    await page.emulateMedia({ forcedColors: 'none' })
  })
  await check('original cat/fish pixels render; preview has no IPC, configuration write or animations', async () => {
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.dataset.ready === 'true'))
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('canvas')].every(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(x => x !== 0))), true)
    assert.equal(await page.evaluate(() => typeof window.workday + ':' + typeof window.workdayV2), 'undefined:undefined')
    assert.equal(await page.evaluate(() => localStorage.length), 0)
    assert.equal(blockedRequests.length, 0); assert.deepEqual(errors, [])
  })
  await check('responsive 480 CSS-pixel viewport does not horizontally hide critical content', async () => {
    await page.setViewportSize({ width: 480, height: 560 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true)
    assert.equal(await page.locator('.we-countdown-value').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1)), true)
  })
  await page.setViewportSize({ width: 1640, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' }); await mode.selectOption('light'); await accent.selectOption('ocean')
  await page.locator('.preview-gallery').screenshot({ path: resolve(evidenceDirectory, 'd10-themes.png'), animations: 'disabled' })
  await page.locator('.preview-states').screenshot({ path: resolve(evidenceDirectory, 'd10-states.png'), animations: 'disabled' })
} finally {
  await writeFile(resolve(evidenceDirectory, 'results.json'), JSON.stringify({ browser: browser.version(), headless: true, chromiumSandbox: true, checks, evidence, errors, blockedRequests }, null, 2))
  await browser.close()
  process.stdout.write(`D10 headless: ${checks.filter(check => check.status === 'PASS').length}/${checks.length} PASS\n`)
}
