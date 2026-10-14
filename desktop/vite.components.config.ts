import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// Separate from electron-vite's production entry. Never auto-open a browser.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './', plugins: [vue()],
  server: {
    host: '127.0.0.1', open: false,
    // Only the original preview GIF outside desktop; no runtime asset copy.
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../docs/version/V2.0.0/design-reference/moyu_original.gif', import.meta.url))] }
  },
  build: {
    outDir: 'test-results/d10-components', emptyOutDir: false,
    rollupOptions: { input: fileURLToPath(new URL('preview/index.html', import.meta.url)) }
  }
})
