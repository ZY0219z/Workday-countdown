import {defineConfig} from '@playwright/test'
import {randomUUID} from 'node:crypto'
export default defineConfig({testDir:'./tests',testMatch:'**/d15-native.spec.ts',grep:/D15 native unsaved dialog: 继续编辑$/,repeatEach:1,workers:1,retries:0,maxFailures:1,timeout:120000,globalTimeout:180000,
  globalSetup:'./scripts/d15-gui-authorization.mjs',reporter:'list',outputDir:'test-results/d15-native-runs/'+randomUUID()})
