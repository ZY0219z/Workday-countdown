import { after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const suite=process.argv[2]??'lifecycle'
assert.ok(['lifecycle','d09'].includes(suite))
const scratch = mkdtempSync(join(tmpdir(), 'workday-d08-'))
after(() => {
  assert.ok(isAbsolute(scratch) && scratch.startsWith(join(tmpdir(), 'workday-d08-')))
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})
const files = [
  ...['contracts', 'validation', 'formats', 'config-schema', 'capabilities', 'settings-draft'].map(name => `src/shared/${name}.ts`),
  ...['local-date', 'local-time', 'time-zone', 'clock', 'annual-calendar', 'calendar', 'calculation-quality', 'schedule', 'overtime', 'progress', 'salary'].map(name => `src/domain/${name}.ts`),
  ...['intl-time-zone', 'system-clock'].map(name => `src/adapters/${name}.ts`),
  ...['calendar-store','config-validation','config-files','config-store','migration-files','migration-service'].map(name => `src/main/services/${name}.ts`), ...['app-identity','single-instance','windows/window-bounds','windows/window-manager','lifecycle/operation-barrier','lifecycle/quit-coordinator','lifecycle/poc-draft','lifecycle/background-testing'].map(name => `src/main/${name}.ts`), 'src/shared/settings.ts', 'tests/unit/config-fixtures.ts', 'tests/unit/lifecycle.test.ts'
]
if(suite==='d09')files.push(...['src/domain/dashboard.ts','src/domain/time-zone-cache.ts','src/domain/employment.ts','src/domain/rest-day.ts',
  'src/shared/ipc.ts','src/shared/bridge.ts','src/main/services/snapshot-service.ts','src/main/services/clock.ts','src/main/services/runtime.ts','src/main/ipc/router.ts','tests/unit/d09.test.ts'])
for (const file of files) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/(from\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_match, prefix, quote, specifier) =>
    `${prefix}${quote}${specifier.endsWith('.json') ? specifier : specifier + '.mjs'}${quote}`)
  const target = join(scratch, file.replace(/\.ts$/, '.mjs'))
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, output)
}
for (const name of ['manifest', '2024', '2025', '2026']) {
  const target = join(scratch, `resources/calendar/${name}.json`)
  mkdirSync(dirname(target), { recursive: true }); copyFileSync(`resources/calendar/${name}.json`, target)
}
await import(pathToFileURL(join(scratch, `tests/unit/${suite}.test.mjs`)))
