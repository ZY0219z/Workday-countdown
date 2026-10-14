import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { spawnSync } from 'node:child_process'

// Existing Vue compiler + Node test runner, no new testing framework or DOM mock.
await build({ configFile: false, plugins: [vue()], logLevel: 'warn', build: {
  ssr: 'tests/unit/d10-components.entry.mjs', outDir: 'test-results/d10-ssr', emptyOutDir: false,
  rollupOptions: { output: { entryFileNames: 'components.mjs' } }
} })
const result = spawnSync(process.execPath, ['--test', 'tests/unit/d10.test.mjs'], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
