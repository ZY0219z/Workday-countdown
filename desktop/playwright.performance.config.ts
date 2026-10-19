import {defineConfig} from '@playwright/test'
// Separate, bounded background observation. Never matches the real GUI suite.
export default defineConfig({testDir:'./tests',testMatch:'**/performance.spec.ts',workers:1,retries:0,timeout:240000,reporter:'list',outputDir:'test-results/d15-performance-runner'})
