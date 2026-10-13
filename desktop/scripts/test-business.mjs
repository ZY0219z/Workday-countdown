import { after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const scratch = mkdtempSync(join(tmpdir(), 'workday-d05-'))
after(() => {
  assert.ok(isAbsolute(scratch) && scratch.startsWith(join(tmpdir(), 'workday-d05-')))
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})
const files = [
  ...['contracts', 'validation', 'formats'].map(name => `src/shared/${name}.ts`),
  ...['local-date', 'annual-calendar', 'calendar', 'calculation-quality', 'employment', 'rest-day', 'salary'].map(name => `src/domain/${name}.ts`),
  'src/main/services/calendar-store.ts', 'tests/unit/business.test.ts'
]
for (const file of files) {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/(from\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_match, prefix, quote, specifier) =>
    `${prefix}${quote}${specifier.endsWith('.json') ? specifier : specifier + '.mjs'}${quote}`)
  const target = join(scratch, file.replace(/\.ts$/, '.mjs'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, output)
}
for (const name of ['manifest', '2024', '2025', '2026']) {
  const target = join(scratch, `resources/calendar/${name}.json`)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(`resources/calendar/${name}.json`, target)
}
await import(pathToFileURL(join(scratch, 'tests/unit/business.test.mjs')))
