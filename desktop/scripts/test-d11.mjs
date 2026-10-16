import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { spawnSync } from 'node:child_process'
const suite=process.argv[2]??'d11'
if(!['d11','d12'].includes(suite))throw Error('Unknown component suite')
await build({configFile:false,plugins:[vue()],logLevel:'warn',build:{ssr:`tests/unit/${suite}-components.entry.mjs`,outDir:`test-results/${suite}-ssr`,emptyOutDir:false,rollupOptions:{output:{entryFileNames:'components.mjs'}}}})
const result=spawnSync(process.execPath,['--test',`tests/unit/${suite}.test.mjs`],{stdio:'inherit',windowsHide:true})
if(result.error)throw result.error
process.exitCode=result.status??1
