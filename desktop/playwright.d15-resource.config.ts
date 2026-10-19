import {defineConfig} from '@playwright/test'
import {randomUUID} from 'node:crypto'
// One native-hidden sampler verification; never selects a visible GUI test.
export default defineConfig({testDir:'./tests',testMatch:'**/d15-resource-background.spec.ts',workers:1,retries:0,repeatEach:1,
  timeout:60000,globalTimeout:90000,reporter:'list',outputDir:'test-results/d15-resource-background/'+randomUUID()})
