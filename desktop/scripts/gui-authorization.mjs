import { readFileSync, writeFileSync, lstatSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// No enable command or environment override. A task-specific, ignored local
// lease is created only after the user's explicit authorization, then removed.
export const guiLeasePath = resolve(dirname(fileURLToPath(import.meta.url)), '../test-results/d08-gui-lease.json')
export default function requireGuiAuthorization(scopeOrConfig = 'desktopGui') {
  const scope = typeof scopeOrConfig === 'string' ? scopeOrConfig : 'desktopGui' // Playwright globalSetup config
  const blocked = () => { throw new Error('GUI验证默认禁止：缺少本轮显式授权的有效本地许可。环境变量和启动参数不能解锁。') }
  try {
    if (process.platform !== 'win32' || !['desktopGui', 'portableBase', 'portableLifecycle'].includes(scope)) return blocked()
    const file = lstatSync(guiLeasePath)
    if (!file.isFile() || file.isSymbolicLink() || file.size > 4096) return blocked()
    const lease = JSON.parse(readFileSync(guiLeasePath, 'utf8')), now = Date.now()
    const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: desktop, windowsHide: true, encoding: 'utf8' }).trim()
    if (lease.task !== 'D08-current-desktop-2026-10-14' || lease.desktop !== desktop || lease.head !== head ||
        !Number.isSafeInteger(lease.created) || !Number.isSafeInteger(lease.expires) || now < lease.created || now >= lease.expires ||
        lease.expires - lease.created > 3600000 || !Number.isSafeInteger(lease.remaining?.[scope]) || lease.remaining[scope] < 1 || lease.remaining[scope] > 3) return blocked()
    lease.remaining[scope]--
    writeFileSync(guiLeasePath, JSON.stringify(lease, null, 2) + '\n')
  } catch { return blocked() }
}
