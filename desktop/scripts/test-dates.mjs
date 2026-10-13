import { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const scratch = mkdtempSync(join(tmpdir(), 'workday-d03-'))
after(() => {
  assert.ok(isAbsolute(scratch) && scratch.startsWith(join(tmpdir(), 'workday-d03-')))
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})
const files = [
  ...['contracts', 'validation', 'formats', 'config-schema'].map(name => `src/shared/${name}.ts`),
  ...['local-date', 'local-time', 'time-zone', 'clock'].map(name => `src/domain/${name}.ts`),
  ...['intl-time-zone', 'system-clock'].map(name => `src/adapters/${name}.ts`),
  'tests/unit/dates.test.ts'
]
for (const file of files) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/(from\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_match, prefix, quote, specifier) => `${prefix}${quote}${specifier}.mjs${quote}`)
  const target = join(scratch, file.replace(/\.ts$/, '.mjs'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, output)
}
await import(pathToFileURL(join(scratch, 'tests/unit/dates.test.mjs')))
