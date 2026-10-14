import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, normalize, resolve } from 'node:path'

export const testArtifactMarker = 'D08-LOCAL-TEST-ONLY-2026-10-14'
// Only copied into the specially named TEST artifact, never desktop/out or
// production package.json. Production main stays packaged, with all test hooks
// disabled; only Electron's native appData root is isolated before it starts.
export const testEntry = `// ${testArtifactMarker}
const { app } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
try {
  const input = process.env.WORKDAY_ESCAPE_D08_PORTABLE_APPDATA
  if (!input || !path.isAbsolute(input)) throw Error('Missing isolated test appData')
  const root = fs.realpathSync(input), temp = fs.realpathSync(os.tmpdir()), inside = path.relative(temp, root)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || !/^(workday-d08-|Workday Escape POC 独立验证 )/.test(inside.split(path.sep)[0])) throw Error('Unowned test appData')
  app.setPath('appData', root)
  require('./index.cjs')
} catch (error) { console.error(error); app.exit(1) }
`
export function assertPortableTestArtifact(exe) {
  const { extractFile } = createRequire(import.meta.url)('@electron/asar')
  const archive = join(resolve(exe, '..'), 'win-unpacked/resources/app.asar')
  const manifest = JSON.parse(readFileSync(join(resolve(exe, '..'), 'd08-test-artifact.json'), 'utf8'))
  const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex')
  assert.equal(manifest.marker, testArtifactMarker)
  assert.equal(manifest.exeSha256, sha(exe), 'EXE must be the artifact bound to the audited test ASAR')
  assert.equal(manifest.asarSha256, sha(archive))
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString())
  assert.equal(metadata.d08TestArtifact, testArtifactMarker, 'Refuse to launch a production EXE into real user data')
  assert.equal(metadata.main, 'out/main/d08-test-entry.cjs')
  assert.equal(extractFile(archive, normalize(metadata.main)).toString(), testEntry)
  const main = extractFile(archive, normalize('out/main/index.cjs'))
  assert.ok(main.equals(readFileSync('out/main/index.cjs')), 'Test artifact must contain current unchanged production main')
  const { listPackage } = createRequire(import.meta.url)('@electron/asar')
  for (const item of listPackage(archive)) {
    const file = item.replaceAll('\\', '/').replace(/^\//, '')
    if (file.startsWith('out/') && !file.endsWith('/') && /\.(cjs|html|js|css)$/.test(file) && file !== 'out/main/d08-test-entry.cjs')
      assert.ok(extractFile(archive, normalize(file)).equals(readFileSync(file)), `Unchanged production file: ${file}`)
  }
  return { testArtifact: testArtifactMarker, productionMainSha256: createHash('sha256').update(main).digest('hex') }
}
