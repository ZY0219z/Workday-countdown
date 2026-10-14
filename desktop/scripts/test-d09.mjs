// Reuse the existing isolated TypeScript/JSON Node test harness.
process.argv[2]='d09'
await import('./test-lifecycle.mjs')
