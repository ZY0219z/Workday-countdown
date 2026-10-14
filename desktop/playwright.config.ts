import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/unit/**',
  // Default Electron tests never show/focus/restore a native window.
  testMatch: '**/background.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  outputDir: 'test-results/desktop-background'
})
