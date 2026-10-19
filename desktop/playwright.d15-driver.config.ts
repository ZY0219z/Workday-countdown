import {defineConfig} from '@playwright/test'
import {randomUUID} from 'node:crypto'
// Infrastructure only: native-hidden/nonfocusable, no GUI permission or UIA.
export default defineConfig({testDir:'./tests',testMatch:'**/d15-driver-background.spec.ts',workers:1,retries:0,timeout:60000,globalTimeout:120000,
  reporter:'list',outputDir:'test-results/d15-driver-background/'+randomUUID()})
