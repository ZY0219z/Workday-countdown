import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const scratch = mkdtempSync(join(tmpdir(), 'workday-logic-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
for (const [name, source] of [
  ['settings', 'src/shared/settings.ts'],
  ['countdown', 'src/shared/countdown.ts'],
  ['settings-store', 'src/main/settings-store.ts']
]) {
  const result = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  })
  writeFileSync(join(scratch, `${name}.mjs`), result.outputText.replaceAll("'../shared/settings'", "'./settings.mjs'"))
}
const { validateSettings, DEFAULT_SETTINGS } = await import(pathToFileURL(join(scratch, 'settings.mjs')))
const { getCountdown } = await import(pathToFileURL(join(scratch, 'countdown.mjs')))
const { loadSettings, saveSettings } = await import(pathToFileURL(join(scratch, 'settings-store.mjs')))
const at = (hour, minute = 0, second = 0, millisecond = 0) => new Date(2026, 9, 13, hour, minute, second, millisecond)

test('valid times retain only the two allowed fields', () => {
  assert.deepEqual(validateSettings({ ...DEFAULT_SETTINGS, path: 'ignored' }), DEFAULT_SETTINGS)
})
test('malformed times and values are rejected', () => {
  for (const value of [null, [], {}, { workStartTime: '8:30', workEndTime: '18:00' },
    { workStartTime: '08:30', workEndTime: '24:00' }, { workStartTime: '08:60', workEndTime: '18:00' }]) {
    assert.throws(() => validateSettings(value))
  }
})
test('equal and overnight times are explicitly rejected', () => {
  assert.throws(() => validateSettings({ workStartTime: '18:00', workEndTime: '18:00' }))
  assert.throws(() => validateSettings({ workStartTime: '22:00', workEndTime: '06:00' }))
})
test('before work shows the remaining time to today’s end', () => {
  assert.deepEqual(getCountdown(at(8), DEFAULT_SETTINGS), { seconds: 36000, status: '尚未上班', text: '10:00:00' })
})
test('work start is included and the countdown handles seconds', () => {
  assert.equal(getCountdown(at(8, 30), DEFAULT_SETTINGS).status, '距离下班')
  assert.equal(getCountdown(at(17, 59, 58, 200), DEFAULT_SETTINGS).text, '00:00:02')
})
test('at and after work end the countdown is zero', () => {
  for (const now of [at(18), at(23, 59, 59)]) {
    assert.deepEqual(getCountdown(now, DEFAULT_SETTINGS), { seconds: 0, status: '已经下班啦！', text: '00:00:00' })
  }
})
test('a new local calendar day recalculates its own target', () => {
  const nextDay = new Date(2026, 9, 14, 0, 0, 0)
  assert.equal(getCountdown(nextDay, DEFAULT_SETTINGS).text, '18:00:00')
})
test('missing config uses defaults without creating a file', () => {
  assert.deepEqual(loadSettings(join(scratch, 'missing.json')), { settings: DEFAULT_SETTINGS, warning: null })
})
test('saving round trips a JSON configuration; invalid saves preserve it', () => {
  const file = join(scratch, 'profile', 'settings.json')
  const settings = { workStartTime: '09:00', workEndTime: '19:00' }
  saveSettings(file, settings)
  assert.deepEqual(loadSettings(file), { settings, warning: null })
  assert.throws(() => saveSettings(file, { workStartTime: '22:00', workEndTime: '06:00' }))
  assert.deepEqual(loadSettings(file).settings, settings)
})
test('corrupt config is preserved and produces an explicit warning', () => {
  const file = join(scratch, 'corrupt.json')
  writeFileSync(file, '{broken')
  const result = loadSettings(file)
  assert.deepEqual(result.settings, DEFAULT_SETTINGS)
  assert.ok(result.warning)
  assert.equal(readFileSync(file, 'utf8'), '{broken')
})
