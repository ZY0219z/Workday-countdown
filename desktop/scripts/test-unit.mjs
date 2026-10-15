import { spawnSync } from 'node:child_process'

for (const name of ['logic', 'contracts', 'dates', 'calendar', 'business', 'shifts', 'storage', 'lifecycle', 'd09', 'd10', 'd11', 'd11-services']) {
  const result = spawnSync(process.execPath, [`scripts/test-${name}.mjs`], { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
