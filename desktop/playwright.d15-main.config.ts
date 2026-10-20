import {defineConfig} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {d15MainGrep} from './scripts/d15-gui-authorization.mjs'
export default defineConfig({testDir:'./tests',testMatch:'**/d15-native.spec.ts',grep:d15MainGrep(),repeatEach:1,workers:1,retries:0,maxFailures:1,timeout:270000,globalTimeout:300000,
  globalSetup:'./scripts/d15-gui-authorization.mjs',reporter:'list',outputDir:'test-results/d15-native-runs/'+randomUUID()})
