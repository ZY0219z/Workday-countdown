import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { chromium, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import requireIsolatedGuiEnvironment from './gui-authorization.mjs'
import { assertPortableTestArtifact } from './portable-test-artifact.mjs'

requireIsolatedGuiEnvironment('portableBase')
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This verification requires a Windows x64 host.')
// Keep the verification client's local CDP traffic out of host HTTP proxies.
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
const require = createRequire(import.meta.url)
const { listPackage } = require('@electron/asar')
const sourceExe = resolve(process.argv[2] || 'release/d08-gui/Workday-Escape-D08-TEST-win-x64.exe')
const artifact = assertPortableTestArtifact(sourceExe)
const scratch = mkdtempSync(join(tmpdir(), 'Workday Escape POC 独立验证 '))
const distribution = join(scratch, '仅单个 EXE')
const profile = join(scratch, 'profile')
const pocFile = join(profile, 'Workday Escape POC', 'settings.json')
mkdirSync(distribution)
mkdirSync(profile)
mkdirSync('test-results', { recursive: true })
const portableExe = join(distribution, 'Workday-Escape-2.0.0-win-x64.exe')
copyFileSync(sourceExe, portableExe)
assert.deepEqual(readdirSync(distribution), ['Workday-Escape-2.0.0-win-x64.exe'])

const systemRoot = process.env.SystemRoot || 'C:\\Windows'
const launchEnv = { ...process.env, PATH: `${systemRoot}\\System32;${systemRoot}`, Path: `${systemRoot}\\System32;${systemRoot}` }
launchEnv.WORKDAY_ESCAPE_TEST_MODE = '1'
launchEnv.WORKDAY_ESCAPE_TEST_PROFILE = profile
launchEnv.WORKDAY_ESCAPE_D08_PORTABLE_APPDATA = profile // Test artifact bootstrap only; production never reads it.
for (const name of Object.keys(launchEnv)) {
  if (/^(ELECTRON_|NODE_|NPM_|VITE_)/i.test(name)) delete launchEnv[name]
}
const evidence = {
  verifiedAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch },
  exe: { path: sourceExe, bytes: statSync(sourceExe).size, sha256: createHash('sha256').update(readFileSync(sourceExe)).digest('hex') },
  standaloneDirectory: distribution,
  runtimePath: launchEnv.PATH,
  checks: [],
  artifact,
  limitations: ['No physical network disconnection', 'No clean machine with Node/Python uninstalled', 'No signed/downloaded SmartScreen test', 'D08 runs use explicit disposable test profiles, including the no-arguments launch']
}
let child
let browser
const check = message => { evidence.checks.push({ status: 'verified', message }); console.log(`PASS: ${message}`) }
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))

async function port() {
  const server = createServer()
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const result = address.port
  await new Promise(resolveClose => server.close(resolveClose))
  return result
}

async function launch() {
  const debugPort = await port()
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`,
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>']
  child = spawn(portableExe, args, { cwd: distribution, env: launchEnv, windowsHide: true, stdio: 'ignore' })
  const launched = child
  let spawnError
  launched.once('error', error => { spawnError = error })
  const deadline = Date.now() + 60000
  let connectionError
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError
    if (launched.exitCode !== null) throw new Error(`Portable exited before renderer connection (${launched.exitCode}).`)
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 })
      const context = browser.contexts()[0]
      const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 5000 })
      await expect(page.getByRole('button', { name: '保存时间' })).toBeEnabled({ timeout: 10000 })
      return page
    } catch (error) {
      connectionError = error
      if (browser) throw error
      await delay(300)
    }
  }
  throw new Error(`Portable renderer connection timed out: ${connectionError?.message}`)
}

async function waitForExit() {
  const deadline = Date.now() + 15000
  while (child.exitCode === null && Date.now() < deadline) await delay(200)
  assert.equal(child.exitCode, 0, 'Portable launcher must finish with exit code 0.')
  if (browser) await browser.close().catch(() => {})
  browser = undefined
  child = undefined
}

function closeNativeWindow(launcherPid) {
  assert.ok(Number.isSafeInteger(launcherPid) && launcherPid > 0)
  const command = `
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $pocDeadline = (Get-Date).AddSeconds(30)
    do {
      $pocChild = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${launcherPid}" |
        Where-Object Name -eq 'Workday Escape.exe' | Select-Object -First 1
      if ($pocChild) {
        $pocWindow = Get-Process -Id $pocChild.ProcessId -ErrorAction SilentlyContinue
        if ($pocWindow -and $pocWindow.MainWindowHandle -ne 0) {
          $pocResult = [pscustomobject]@{title=$pocWindow.MainWindowTitle; executable=$pocChild.ExecutablePath; closed=$pocWindow.CloseMainWindow()}
          $pocResult | ConvertTo-Json -Compress
          exit 0
        }
      }
      Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $pocDeadline)
    throw 'The portable native window did not become visible.'
  `
  return JSON.parse(execFileSync(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 35000 }))
}

try {
  const outputRoot = resolve(sourceExe, '..')
  const archive = listPackage(join(outputRoot, 'win-unpacked/resources/app.asar')).map(path => path.replaceAll('\\', '/'))
  assert.ok(archive.some(path => path.endsWith('/out/main/index.cjs')))
  assert.ok(archive.some(path => path.endsWith('/out/preload/index.cjs')))
  assert.ok(archive.some(path => path.endsWith('/out/renderer/index.html')))
  assert.ok(!archive.some(path => /node_modules|\.py$|config\.json$/.test(path)))
  evidence.packagedFiles = archive
  check('ASAR contains the compiled main, preload and Vue assets without Python or external npm modules')
  const manifestPattern = /<requestedExecutionLevel\s+level="asInvoker"/i
  assert.match(readFileSync(sourceExe).toString('utf8'), manifestPattern)
  assert.match(readFileSync(join(outputRoot, 'win-unpacked/Workday Escape.exe')).toString('utf8'), manifestPattern)
  check('Both the portable launcher and extracted application request asInvoker')
  const admin = execFileSync(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    '([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'], { encoding: 'utf8', windowsHide: true }).trim()
  evidence.host.administratorToken = admin === 'True'
  if (admin === 'False') check('Verification host process is running without an administrator token')
  else evidence.limitations.push('Host has an administrator token; standard user execution was not verified')

  let page = await launch()
  await expect(page.getByRole('heading', { name: 'Workday Escape' })).toBeVisible()
  assert.ok(page.url().startsWith('file:///'))
  assert.ok(!page.url().toLowerCase().includes('workday-countdown'))
  evidence.rendererUrl = page.url()
  check('Single EXE starts without installation from an external directory with spaces and Chinese characters')
  check('Application runs with PATH restricted to Windows system folders and no development environment variables')
  const surface = await page.evaluate(() => ({ keys: Object.keys(window.workday).sort(), require: typeof globalThis.require, process: typeof globalThis.process }))
  assert.deepEqual(surface, { keys: ['loadSettings', 'quit', 'saveSettings'], require: 'undefined', process: 'undefined' })
  check('Packaged renderer cannot access Node and retains only the three preload methods')
  await page.getByLabel('上班时间').fill('00:00')
  await page.getByLabel('下班时间').fill('23:59')
  await page.getByRole('button', { name: '保存时间' }).click()
  await expect(page.getByRole('status')).toHaveText('时间已保存。')
  assert.deepEqual(JSON.parse(readFileSync(pocFile, 'utf8')), { workStartTime: '00:00', workEndTime: '23:59' })
  check('Portable application saves its configuration into the isolated user data profile')
  const first = await page.getByTestId('countdown').innerText()
  assert.notEqual(first, '00:00:00', 'Live countdown check must occur before 23:59.')
  const seconds = text => text.split(':').map(Number).reduce((result, part) => result * 60 + part, 0)
  await expect(page.getByTestId('countdown')).not.toHaveText(first, { timeout: 2500 })
  const second = await page.getByTestId('countdown').innerText()
  assert.ok(seconds(first) - seconds(second) >= 1 && seconds(first) - seconds(second) <= 2)
  check('Countdown decreases by one second per timer tick')
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: '保存时间' })).toBeEnabled()
  await expect(page.getByLabel('下班时间')).toHaveValue('23:59')
  await page.screenshot({ path: 'test-results/portable-window.png' })
  check('Application reloads and reads local settings with Chromium offline and a blocked network proxy')
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await waitForExit()
  check('Exit button closes the app and portable launcher normally')

  page = await launch()
  await expect(page.getByLabel('上班时间')).toHaveValue('00:00')
  await expect(page.getByLabel('下班时间')).toHaveValue('23:59')
  check('The same standalone EXE reopens and retains its saved configuration')
  const nativeWindow = closeNativeWindow(child.pid)
  assert.ok(nativeWindow.closed && nativeWindow.title.includes('Workday Escape'))
  evidence.nativeWindow = nativeWindow
  await waitForExit()
  check('Windows native window close also terminates the portable launcher')
  child = spawn(portableExe, [], { cwd: distribution, env: launchEnv, windowsHide: true, stdio: 'ignore' })
  const ordinaryWindow = closeNativeWindow(child.pid)
  assert.ok(ordinaryWindow.closed && ordinaryWindow.title.includes('Workday Escape'))
  evidence.noArgumentsWindow = ordinaryWindow
  await waitForExit()
  check('EXE starts with no command-line arguments or debugging/proxy switches using the explicit disposable test-profile environment, then closes normally')
  assert.deepEqual(readdirSync(distribution), ['Workday-Escape-2.0.0-win-x64.exe'])
  check('Distribution folder still contains only the single EXE after all three launches')
  evidence.status = 'verified'
} catch (error) {
  evidence.status = 'failed'
  evidence.error = String(error.stack || error)
  process.exitCode = 1
  console.error(evidence.error)
} finally {
  if (child?.pid && child.exitCode === null) {
    execFileSync(join(systemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  }
  if (browser) await browser.close().catch(() => {})
  writeFileSync('test-results/portable-verification.json', `${JSON.stringify(evidence, null, 2)}\n`)
  // Only remove the disposable directory returned by mkdtemp for this run.
  assert.ok(isAbsolute(scratch) && scratch.startsWith(join(tmpdir(), 'Workday Escape POC 独立验证 ')))
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
