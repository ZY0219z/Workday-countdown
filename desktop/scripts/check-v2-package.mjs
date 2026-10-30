// Static inspection only. Extract the Portable with 7-Zip first; never run it.
// Usage (from desktop): node scripts/check-v2-package.mjs <candidate-dir> <extracted-payload-dir>
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, posix, resolve } from 'node:path'
import { extractFile, listPackage, statFile } from '@electron/asar'

const [candidateArg, payloadArg] = process.argv.slice(2)
assert.ok(candidateArg && payloadArg && process.argv.length === 4, 'Supply candidate and independently extracted payload directories')
const candidate = resolve(candidateArg), payload = resolve(payloadArg)
const hash = data => createHash('sha256').update(data).digest('hex')
function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${entry.name}`)
    const name = prefix + entry.name
    return entry.isDirectory() ? files(join(directory, entry.name), name + '/') : [name]
  }).sort()
}

const sourcePackage = JSON.parse(readFileSync('package.json', 'utf8'))
const expectedVersion = '2.1.1'
assert.equal(sourcePackage.version, expectedVersion)
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
assert.equal(lock.version, expectedVersion)
assert.equal(lock.packages[''].version, expectedVersion)
assert.deepEqual(lock.packages[''].devDependencies, sourcePackage.devDependencies)
const exeName = 'Workday Escape.exe'
assert.deepEqual(readdirSync(candidate).filter(name => /\.exe$/i.test(name)), [exeName], 'Only the expected Portable may be present at the candidate root')
const exe = join(candidate, exeName), staged = join(candidate, 'win-unpacked')
const exeBytes = statSync(exe).size
assert.ok(exeBytes > 0 && exeBytes <= 120 * 1024 ** 2, 'Portable size exceeds 120 MiB')
const stagedFiles = files(staged)
assert.deepEqual(files(payload), stagedFiles, 'Portable payload file list differs from staged distribution')
for (const file of stagedFiles) assert.equal(hash(readFileSync(join(payload, file))), hash(readFileSync(join(staged, file))), `Portable payload differs: ${file}`)
for (const file of ['resources/default_app.asar', 'version']) assert.ok(!existsSync(join(payload, file)), `Stock Electron demo/marker remains: ${file}`)

const archive = join(payload, 'resources', 'app.asar')
const entries = new Map(listPackage(archive).map(native => [native.replaceAll('\\', '/').replace(/^\//, ''), native.replace(/^[\\/]+/, '')]))
const embeddedFiles = [...entries].filter(([, native]) => !statFile(archive, native).files).map(([name]) => name).sort()
assert.deepEqual(embeddedFiles.filter(name => name !== 'package.json'), files('out').map(name => 'out/' + name), 'ASAR must contain exactly the fresh production build and package.json')
const extract = name => extractFile(archive, entries.get(name))
for (const name of embeddedFiles.filter(name => name !== 'package.json')) {
  assert.equal(hash(extract(name)), hash(readFileSync(name)), `Stale embedded build: ${name}`)
  assert.ok(!/\.(?:map|ts|vue)$|(?:^|\/)(?:tests?|fixtures?|node_modules|test-results|\.env)(?:[./]|$)/i.test(name), `Non-production file: ${name}`)
}
const metadata = JSON.parse(extract('package.json'))
assert.equal(metadata.name, sourcePackage.name)
assert.equal(metadata.main, 'out/main/index.cjs')
assert.equal(metadata.version, sourcePackage.version)
assert.equal(metadata.description, sourcePackage.description)
assert.ok(!metadata.d08TestArtifact && !metadata.scripts && !metadata.devDependencies)
assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0, 'Unexpected external runtime dependency')

const main = extract(metadata.main).toString(), preload = extract('out/preload/index.cjs').toString()
for (const guard of ['const testMode = !electron.app.isPackaged &&', 'const devUrl = !electron.app.isPackaged ?', 'contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', 'webSecurity: true', 'action: "deny"', 'setPermissionRequestHandler', 'setPermissionCheckHandler', 'com.workdayescape', 'app.setPath("userData", paths.data.userData)', 'renderer/mini.html']) assert.ok(main.includes(guard), `Missing production guard/identity: ${guard}`)
assert.ok(preload.includes('process.isMainFrame') && preload.includes('--workday-window-role='))
const builtins = new Set([...builtinModules, ...builtinModules.map(name => 'node:' + name), 'electron'])
for (const code of [main, preload]) for (const match of code.matchAll(/require\(["']([^"']+)["']\)/g)) assert.ok(builtins.has(match[1]), `External require: ${match[1]}`)
for (const page of ['index', 'mini']) {
  const html = extract(`out/renderer/${page}.html`).toString()
  for (const csp of ["script-src 'self'", "connect-src 'none'"]) assert.ok(html.includes(csp), `${page}: missing CSP ${csp}`)
  const directives = new Map(html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].split(';').map(value => {
    const [key, ...sources] = value.trim().split(/\s+/)
    return [key, sources.join(' ')]
  }).filter(([key]) => key))
  assert.equal(directives.get('object-src') ?? directives.get('default-src'), "'none'", `${page}: object content must be denied, including CSP fallback`)
  assert.ok(!/unsafe-inline|unsafe-eval|@vite\/client|https?:\/\//.test(html), `${page}: development or remote content`)
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(entries.has(posix.normalize(posix.join('out/renderer', match[1]))), `Missing HTML asset: ${match[1]}`)
}
for (const [pattern, original] of [[/moyu-tray-.+\.png$/, 'src/main/tray/moyu-tray.png'], [/moyu_original-.+\.gif$/, '../docs/version/V2.0.0/design-reference/moyu_original.gif']]) {
  const name = embeddedFiles.find(name => pattern.test(name))
  assert.ok(name, `Missing ${original}`)
  assert.equal(hash(extract(name)), hash(readFileSync(original)), `Changed original asset: ${original}`)
}
// UI-13 replaced the old PNG wave with inline SVG water. Verify the current
// wave path and every illustration, including Vite's whitespace/quote encoding.
const rendererCode = embeddedFiles.filter(name => /^out\/renderer\/assets\/.+\.js$/.test(name)).map(name => extract(name).toString()).join('\n')
const rendererCss = embeddedFiles.filter(name => /^out\/renderer\/assets\/.+\.css$/.test(name)).map(name => extract(name).toString()).join('\n')
const normalizeSvg = value => value.replace(/\s+/g, ' ').replaceAll('"', "'").replace(/>\s+</g, '><').replace(/\s*\/>/g, '/>').trim()
const embeddedSvgs = [...rendererCode.matchAll(/data:image\/svg\+xml,([^"\s]+)/g)].map(match => normalizeSvg(decodeURIComponent(match[1])))
for (const name of ['reef', 'rest', 'salary', 'employment']) {
  const original = `src/renderer/src/assets/dashboard/${name}.svg`
  assert.ok(embeddedSvgs.includes(normalizeSvg(readFileSync(original, 'utf8'))), `Missing or changed production SVG: ${original}`)
}
const wave = readFileSync('src/renderer/src/components/FishProgress.vue', 'utf8').match(/const wave='([^']+)'/)?.[1]
assert.ok(wave && rendererCode.includes(wave), 'Missing exact production SVG wave path')
assert.ok(/animation:[^;{}]*fish-water-flow[^;{}]*14s/.test(rendererCss) && rendererCss.includes('animation-duration:16s'), 'Missing dual-layer water animation styles')
for (const name of embeddedFiles.filter(name => /\.(?:cjs|js|html|json)$/.test(name))) assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk-proj-|ghp_)[a-zA-Z0-9_-]{24,}/.test(extract(name).toString()), `Potential credential in ${name}`)

const allowedRuntime = new Set(files('node_modules/electron/dist').filter(name => !['electron.exe', 'LICENSE', 'resources/default_app.asar', 'version'].includes(name)))
for (const file of stagedFiles) {
  if (['Workday Escape.exe', 'LICENSE.electron.txt', 'resources/app.asar', 'resources/elevate.exe'].includes(file)) continue
  assert.ok(allowedRuntime.has(file), `Unexpected distribution resource: ${file}`)
  assert.equal(hash(readFileSync(join(payload, file))), hash(readFileSync(join('node_modules/electron/dist', file))), `Modified Electron runtime resource: ${file}`)
}
assert.equal(hash(readFileSync(join(payload, 'LICENSE.electron.txt'))), hash(readFileSync('node_modules/electron/dist/LICENSE')))
for (const [file, machine] of [[exe, 0x14c], [join(payload, 'Workday Escape.exe'), 0x8664]]) {
  const binary = readFileSync(file), header = binary.readUInt32LE(0x3c)
  assert.equal(binary.toString('ascii', 0, 2), 'MZ')
  assert.equal(binary.readUInt32LE(header), 0x4550)
  assert.equal(binary.readUInt16LE(header + 4), machine, 'Expected x86 NSIS wrapper and x64 Electron payload')
  const offset = binary.indexOf(Buffer.from('<requestedExecutionLevel'))
  assert.ok(offset >= 0 && /level=["']asInvoker["']/.test(binary.toString('utf8', offset, offset + 200)), 'Executable must not request administrator privileges')
}
console.log(JSON.stringify({ scope: 'DEV-01 V2.1.1 static package only; EXE NOT RUN', version: metadata.version, exe, exeBytes, exeMiB: exeBytes / 1024 ** 2, sha256: hash(readFileSync(exe)), asarSha256: hash(readFileSync(archive)), payloadFiles: stagedFiles.length, embeddedFiles, originalAssetsUnchanged: true, dashboardSvgsAndWaveVerified: true, securityGuardsPresent: true, runtimeResourcesMatchInstalledElectron: true, architecture: 'Windows x64 payload / x86 Portable launcher', executionLevel: 'asInvoker', externalRuntimeDependencies: [] }, null, 2))
