import {defineConfig} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {d15DesktopGrep} from './scripts/d15-gui-authorization.mjs'
export default defineConfig({testDir:'./tests',testMatch:'**/d15-native.spec.ts',grep:d15DesktopGrep(),repeatEach:1,workers:1,retries:0,maxFailures:1,timeout:120000,globalTimeout:1200000,
  globalSetup:'./scripts/d15-gui-authorization.mjs',reporter:'list',outputDir:'test-results/d15-native-runs/'+randomUUID()})
