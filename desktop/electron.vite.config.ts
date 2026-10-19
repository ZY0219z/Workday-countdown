import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command }) => ({
  main: {
    build: {
      rollupOptions: {
        input: resolve('src/main/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true }
      }
    }
  },
  renderer: {
    plugins: [vue(), {
      name: 'development-csp',
      transformIndexHtml: command === 'serve' ? html => html
        .replace("style-src 'self';", "style-src 'self' 'unsafe-inline';")
        .replace("connect-src 'none';", "connect-src 'self' ws://127.0.0.1:*;") : undefined
    }],
    build: { rollupOptions: { input: {index:resolve('src/renderer/index.html'),mini:resolve('src/renderer/mini.html')} } },
    server: { host: '127.0.0.1', fs: { allow: [resolve('src'), resolve('node_modules'), resolve('../docs/version/V2.0.0/design-reference/moyu_original.gif'), resolve('../assets/image/wave-fin.png')] } }
  }
}))
