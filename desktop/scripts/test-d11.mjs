import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { spawnSync } from 'node:child_process'
await build({configFile:false,plugins:[vue()],logLevel:'warn',build:{ssr:'tests/unit/d11-components.entry.mjs',outDir:'test-results/d11-ssr',emptyOutDir:false,rollupOptions:{output:{entryFileNames:'components.mjs'}}}})
const result=spawnSync(process.execPath,['--test','tests/unit/d11.test.mjs'],{stdio:'inherit',windowsHide:true})
if(result.error)throw result.error
process.exitCode=result.status??1
