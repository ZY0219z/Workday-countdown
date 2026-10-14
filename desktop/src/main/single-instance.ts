import type { Result } from '../shared/contracts'
import { success } from '../shared/validation'

export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  releaseSingleInstanceLock(): void
  quit(): void
  on(event: 'second-instance', callback: () => void): void
  off(event: 'second-instance', callback: () => void): void
}
export interface SingleInstance {
  primary: boolean
  markReady(): void
  beginQuit(): void
  dispose(): void
}
export function acquireSingleInstance(app: SingleInstanceApp, restoreMain: () => void): Result<SingleInstance> {
  let owned = false, ready = false, stopping = false, disposed = false, pending = false
  const restore = () => { if (stopping || disposed) return; pending = true; if (ready) { pending = false; restoreMain() } }
  try {
    app.on('second-instance', restore) // Ignore ALL argv/cwd/additionalData.
    owned = app.requestSingleInstanceLock()
    if (!owned) { app.off('second-instance', restore); disposed = true; app.quit() }
    return success({ primary: owned,
      markReady() { if (!owned || disposed || stopping) return; ready = true; if (pending) restore() },
      beginQuit() { stopping = true; pending = false },
      dispose() { if (disposed) return; disposed = true; stopping = true; app.off('second-instance', restore); if (owned) { app.releaseSingleInstanceLock(); owned = false } }
    })
  } catch {
    app.off('second-instance', restore)
    if (owned) app.releaseSingleInstanceLock()
    return { ok: false, error: { code: 'UNAVAILABLE', message: '无法取得应用单实例锁，未创建窗口。' } }
  }
}
