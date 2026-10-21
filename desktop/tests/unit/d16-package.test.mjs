import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import afterPack from '../../scripts/after-pack.cjs'

function fixture(t) {
  const scratchRoot = resolve(tmpdir())
  const projectDir = mkdtempSync(join(scratchRoot, 'workday-d16-package-'))
  t.after(() => {
    assert.equal(dirname(resolve(projectDir)), scratchRoot)
    assert.ok(basename(projectDir).startsWith('workday-d16-package-'))
    rmSync(projectDir, { recursive: true, force: true })
  })
  const appOutDir = join(projectDir, 'release', 'win-unpacked')
  mkdirSync(join(appOutDir, 'resources'), { recursive: true })
  for (const [file, content] of [['resources/app.asar', 'production'], ['resources/default_app.asar', 'demo'], ['version', '44.7.0']]) writeFileSync(join(appOutDir, file), content)
  return { projectDir, appOutDir, context: { appOutDir, electronPlatformName: 'win32', packager: { projectDir } } }
}

test('custom distribution cleanup removes only generated demo and version; repeat is safe', async t => {
  const { appOutDir, context } = fixture(t)
  writeFileSync(join(appOutDir, 'resources', 'keep.txt'), 'keep')
  await afterPack(context)
  await afterPack(context)
  assert.equal(existsSync(join(appOutDir, 'resources', 'default_app.asar')), false)
  assert.equal(existsSync(join(appOutDir, 'version')), false)
  assert.equal(readFileSync(join(appOutDir, 'resources', 'app.asar'), 'utf8'), 'production')
  assert.equal(readFileSync(join(appOutDir, 'resources', 'keep.txt'), 'utf8'), 'keep')
})

test('cleanup refuses a directory outside generated release output', async t => {
  const { projectDir, context } = fixture(t)
  writeFileSync(join(projectDir, 'version'), 'user-owned')
  await assert.rejects(afterPack({ ...context, appOutDir: projectDir }), /inside project release/)
  assert.equal(readFileSync(join(projectDir, 'version'), 'utf8'), 'user-owned')
})

test('cleanup refuses output without a production archive', async t => {
  const { appOutDir, context } = fixture(t)
  rmSync(join(appOutDir, 'resources', 'app.asar'))
  await assert.rejects(afterPack(context), /Production app.asar/)
  assert.equal(existsSync(join(appOutDir, 'resources', 'default_app.asar')), true)
  assert.equal(existsSync(join(appOutDir, 'version')), true)
})

test('Windows-only cleanup leaves other platform output alone', async t => {
  const { appOutDir, context } = fixture(t)
  await afterPack({ ...context, electronPlatformName: 'linux' })
  assert.equal(existsSync(join(appOutDir, 'resources', 'default_app.asar')), true)
})

test('historical marked D08 packaging is not altered by the production hook', async t => {
  const { appOutDir, context } = fixture(t)
  await afterPack({ ...context, packager: { projectDir: join(appOutDir, 'unused-test-project'), appInfo: { metadata: { d08TestArtifact: 'D08 fixture' } } } })
  assert.equal(existsSync(join(appOutDir, 'resources', 'default_app.asar')), true)
  assert.equal(existsSync(join(appOutDir, 'version')), true)
})
