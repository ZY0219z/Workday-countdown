import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({ ...base,
  testMatch: ['**/desktop.spec.ts', '**/lifecycle.spec.ts'],
  globalSetup: './scripts/gui-authorization.mjs',
  outputDir: 'test-results/desktop-gui'
})
