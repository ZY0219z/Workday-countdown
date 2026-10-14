import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium, expect } from '@playwright/test'
import requireIsolatedGuiEnvironment from './gui-authorization.mjs'
import { assertPortableTestArtifact } from './portable-test-artifact.mjs'

requireIsolatedGuiEnvironment('portableLifecycle')
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows x64 is required.')
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',')
const exec = promisify(execFile), source = resolve(process.argv[2] || 'release/d08-gui/Workday-Escape-D08-TEST-win-x64.exe')
const artifact = assertPortableTestArtifact(source)
const scratch = mkdtempSync(join(tmpdir(), 'workday-d08-portable-')), profile = join(scratch, 'profile')
const a = join(scratch, '副本 A', 'Workday-Escape-2.0.0-win-x64.exe'), b = join(scratch, '副本 B', 'renamed-copy.exe')
for (const path of [profile, join(scratch, '副本 A'), join(scratch, '副本 B'), join(profile, 'Workday Escape')]) mkdirSync(path, { recursive: true })
copyFileSync(source, a); copyFileSync(source, b)
const sentinel = join(profile, 'Workday Escape', 'settings.json'), original = '{"schemaVersion":99,"marker":"D08 must never touch formal configuration"}'
writeFileSync(sentinel, original)
const systemRoot = process.env.SystemRoot || 'C:\\Windows'
const env = { ...process.env, PATH: `${systemRoot}\\System32;${systemRoot}`, Path: `${systemRoot}\\System32;${systemRoot}`,
  WORKDAY_ESCAPE_TEST_MODE: '1', WORKDAY_ESCAPE_TEST_PROFILE: profile }
env.WORKDAY_ESCAPE_D08_PORTABLE_APPDATA = profile
for (const name of Object.keys(env)) if (/^(ELECTRON_|NODE_|NPM_|VITE_)/i.test(name)) delete env[name]
const evidence = { verifiedAt: new Date().toISOString(), exe: { path: source, bytes: statSync(source).size,
  sha256: createHash('sha256').update(readFileSync(source)).digest('hex') }, artifact, checks: [], secondaryLauncherMilliseconds: [],
  limitations: ['Uses explicit disposable profiles; does not write the real user configuration',
    'No real tray/MiniView', 'No physical second monitor, unplugging or changing DPI',
    'No clean machine, physical network disconnection or downloaded SmartScreen verification'] }
const children = [], trackers = []; let browser, primary
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms))
const check = message => { evidence.checks.push({ status: 'verified', message }); console.log(`PASS: ${message}`) }
async function ps(command) {
  const { stdout } = await exec(join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);${command}`],
    { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 })
  return stdout.trim()
}
async function snapshot() {
  return JSON.parse(await ps('$items=@(Get-CimInstance Win32_Process | ForEach-Object {[pscustomobject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;created=[string]$_.CreationDate}});ConvertTo-Json -InputObject $items -Compress'))
}
function track(root) {
  const seen = new Map([[root, undefined]])
  const tracker = { async live() {
    const all = await snapshot(); let changed = true
    while (changed) { changed = false
      for (const item of all) { const parent = seen.get(item.parent), currentParent = all.find(p => p.pid === item.parent)
        if (!seen.has(item.pid) && seen.has(item.parent) && (!parent || !currentParent || currentParent.created === parent)) { seen.set(item.pid, item.created); changed = true }
      }
    }
    for (const item of all) if (seen.has(item.pid) && seen.get(item.pid) === undefined) seen.set(item.pid, item.created)
    return all.filter(item => seen.has(item.pid) && seen.get(item.pid) === item.created).map(item => item.pid)
  } }
  trackers.push(tracker); return tracker
}
async function start(exe, args) {
  const child = spawn(exe, args, { env, cwd: scratch, windowsHide: true, stdio: 'ignore' })
  children.push(child)
  await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject) })
  const tree = track(child.pid); await tree.live(); return { child, tree }
}
async function port() {
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done))
  const value = server.address().port; await new Promise(done => server.close(done)); return value
}
async function launch(exe) {
  const debugPort = await port(); primary = await start(exe, [`--remote-debugging-port=${debugPort}`, '--proxy-server=http://127.0.0.1:9'])
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    assert.equal(primary.child.exitCode, null, 'Primary Portable exited during startup.')
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }); break }
    catch { await delay(300) }
  }
  assert.ok(browser, 'CDP did not become available.')
  const context = browser.contexts()[0], page = context.pages()[0] || await context.waitForEvent('page')
  await expect(page.getByRole('button', { name: '保存时间' })).toBeEnabled({ timeout: 10000 })
  await primary.tree.live(); return page
}
async function secondary(args = []) {
  const began = performance.now()
  const result = await start(b, args)
  // This bound includes extracting/scanning the Portable runtime and cleaning
  // its resources, matching primary STARTUP's 60s bound. It is not a G05
  // restore-speed acceptance; true exit after a ready window remains 15s below.
  try { await expect.poll(async () => { await result.tree.live(); return result.child.exitCode }, { timeout: 60000 }).toBe(0) }
  catch (error) {
    const ids = await result.tree.live()
    console.error('D08 owned secondary diagnostics', await ps(`$ids=@(${ids.join(',')});Get-CimInstance Win32_Process | Where-Object {$ids -contains [int]$_.ProcessId} | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`))
    console.error('D08 owned secondary windows', await ps(`Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,MainWindowHandle | ConvertTo-Json -Compress`))
    throw error
  }
  await expect.poll(() => result.tree.live(), { timeout: 15000 }).toEqual([])
  evidence.secondaryLauncherMilliseconds.push(Math.round(performance.now() - began))
}
async function windowHandle() {
  const ids = await primary.tree.live(); assert.ok(ids.length)
  const output = await ps(`$items=@(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*Workday Escape*'} | ForEach-Object {[long]$_.MainWindowHandle});ConvertTo-Json -InputObject $items -Compress`)
  const handles = JSON.parse(output); assert.equal(handles.length, 1, 'Only one real main window should exist.'); return handles[0]
}
async function native(handle, minimize = false) {
  assert.ok(Number.isSafeInteger(handle) && handle > 0)
  return JSON.parse(await ps(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class D08Native { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n); }';${minimize ? `[void][D08Native]::ShowWindowAsync([IntPtr]${handle},6);` : ''}[pscustomobject]@{minimized=[D08Native]::IsIconic([IntPtr]${handle});visible=[D08Native]::IsWindowVisible([IntPtr]${handle})}|ConvertTo-Json -Compress`))
}
async function exit(page) {
  await primary.tree.live()
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect.poll(() => primary.child.exitCode, { timeout: 15000 }).toBe(0)
  await expect.poll(() => primary.tree.live(), { timeout: 15000 }).toEqual([])
  await browser.close().catch(() => {}); browser = undefined
}
try {
  let page = await launch(a)
  const url = page.url(), handle = await windowHandle()
  await page.getByLabel('上班时间').fill('08:30'); await page.getByLabel('下班时间').fill('19:00')
  await page.getByRole('button', { name: '保存时间' }).click(); await expect(page.getByRole('status')).toHaveText('时间已保存。')
  check('Copied single EXE launches from an unrelated directory with only Windows PATH; POC save works')
  await secondary(['--import-config=arbitrary.json', '--execute=never', '--user-data-dir=C:\\ignored-profile'])
  assert.equal(page.url(), url); assert.equal(await windowHandle(), handle); await expect(page.getByLabel('下班时间')).toHaveValue('19:00')
  assert.equal(readFileSync(sentinel, 'utf8'), original)
  check('Renamed EXE in a different directory restores the SAME native window; arbitrary second-instance arguments do not import, exit or change formal configuration')
  await native(handle, true); await expect.poll(async () => (await native(handle)).minimized).toBe(true)
  await secondary(); await expect.poll(async () => (await native(handle)).minimized).toBe(false)
  assert.equal((await native(handle)).visible, true); assert.equal(await windowHandle(), handle)
  check('Second Portable launch restores the original minimized window')
  await Promise.all([secondary(), secondary()]); assert.equal(await windowHandle(), handle)
  check('Concurrent secondary Portable launchers and all captured descendants exit without a second main window')
  await exit(page); check('Explicit true exit terminates the primary launcher and captured Electron process tree')
  page = await launch(b); await expect(page.getByLabel('下班时间')).toHaveValue('19:00'); assert.equal(readFileSync(sentinel, 'utf8'), original)
  await secondary(); await exit(page)
  check('Renamed copy can become the next primary, retain POC settings, release its lock and exit cleanly')
  assert.deepEqual(readdirSync(join(scratch, '副本 A')), ['Workday-Escape-2.0.0-win-x64.exe'])
  assert.deepEqual(readdirSync(join(scratch, '副本 B')), ['renamed-copy.exe'])
  check('Both distribution folders contain exactly one EXE after all launches; no sidecar dependency')
  evidence.status = 'verified'
} catch (error) { evidence.status = 'failed'; evidence.error = String(error.stack || error); console.error(evidence.error); process.exitCode = 1 }
finally {
  if (browser) await browser.close().catch(() => {})
  // Kill only creation-time-checked descendants of launchers owned by this run.
  for (const tree of trackers) for (const pid of await tree.live()) await exec(join(systemRoot, 'System32/taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
  mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/d08-portable-lifecycle.json', JSON.stringify(evidence, null, 2) + '\n')
  assert.ok(isAbsolute(scratch) && scratch.startsWith(join(tmpdir(), 'workday-d08-portable-')))
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
}
