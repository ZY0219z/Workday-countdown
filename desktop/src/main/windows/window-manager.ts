import type { Result } from '../../shared/contracts'
import { success } from '../../shared/validation'

export interface ManagedWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  show(): void
  hide(): void
  restore(): void
  focus(): void
  setAlwaysOnTop(enabled: boolean): void
  on(event: string, callback: () => void): unknown
  removeListener(event: string, callback: () => void): unknown
}
export type WindowState = 'mainVisible' | 'mainMinimized' | 'mainHidden' | 'miniVisible' | 'trayOnly' | 'quitting' | 'starting'
export interface TrayRecovery { isAvailable(): boolean; registerRestore(callback: () => void): () => void }
export function createWindowManager(createMain: () => ManagedWindow) {
  let main: ManagedWindow | null = null, mini: ManagedWindow | null = null
  let miniEnabled = false, quitting = false, creating = false, switching = false, disposed = false
  let recovery: TrayRecovery | null = null, releaseRecovery: (() => void) | null = null
  let recoveryGeneration: object | null = null, hiddenMain = false
  const listeners = new Map<ManagedWindow, Array<[string, () => void]>>()
  const alive = (window: ManagedWindow | null): ManagedWindow | null => window && !window.isDestroyed() ? window : null
  const available = () => { try { return !!recovery?.isAvailable() } catch { return false } }
  const unavailable = (): Result<never> => ({ ok: false, error: { code: 'UNAVAILABLE', message: '当前窗口能力未就绪或正在退出。' } })
  function reconcile(): void {
    if (switching || quitting || disposed || creating) return
    main = alive(main); mini = alive(mini)
    if (main?.isVisible() && mini?.isVisible()) { switching = true; mini.hide(); switching = false }
    if ((main || mini) && !main?.isVisible() && !(main?.isMinimized() && !hiddenMain) && !mini?.isVisible() && !available()) showMain()
  }
  function attach(window: ManagedWindow, role: 'main' | 'mini'): void {
    const bound: Array<[string, () => void]> = []
    for (const event of ['show', 'hide', 'minimize', 'restore']) {
      const callback = () => reconcile(); window.on(event, callback); bound.push([event, callback])
    }
    const closed = () => { detach(window); if (role === 'main' && main === window) main = null; if (role === 'mini' && mini === window) mini = null;
      if (!quitting && !disposed && !alive(main) && !alive(mini)?.isVisible() && !available()) showMain(); else reconcile() }
    window.on('closed', closed); bound.push(['closed', closed]); listeners.set(window, bound)
  }
  function detach(window: ManagedWindow): void { for (const [event, callback] of listeners.get(window) ?? []) window.removeListener(event, callback); listeners.delete(window) }
  function ensureMain(): Result<ManagedWindow> {
    if (quitting || disposed) return unavailable()
    const existing = alive(main)
    if (existing) return success(existing)
    if (creating) return unavailable()
    creating = true
    try { main = createMain(); if (main.isDestroyed()) { main = null; return unavailable() }; attach(main, 'main'); return success(main) }
    catch { main = null; return unavailable() }
    finally { creating = false }
  }
  function showMain(): Result<null> {
    const window = ensureMain()
    if (!window.ok) return window
    switching = true
    try { alive(mini)?.hide(); hiddenMain = false; if (window.data.isMinimized()) window.data.restore(); window.data.show(); window.data.focus(); return success(null) }
    catch { return unavailable() }
    finally { switching = false }
  }
  function showMini(): Result<null> {
    if (quitting || disposed || !miniEnabled || !alive(mini)) return unavailable()
    switching = true
    try { hiddenMain = true; alive(main)?.hide(); if (mini!.isMinimized()) mini!.restore(); mini!.show(); mini!.focus(); return success(null) }
    catch { showMain(); return unavailable() }
    finally { switching = false; reconcile() }
  }
  return {
    ensureMain, showMain, showMini,
    getMain: () => alive(main),
    registerMini(window: ManagedWindow): Result<null> {
      if (quitting || disposed || window.isDestroyed() || alive(mini) || window === alive(main)) return unavailable()
      switching = true
      try { window.hide(); mini = window; attach(window, 'mini'); return success(null) }
      finally { switching = false; reconcile() }
    },
    setMiniEnabled(enabled: boolean): Result<null> { if (quitting || disposed || typeof enabled !== 'boolean') return unavailable(); miniEnabled = enabled; return enabled ? success(null) : showMain() },
    setMiniTop(enabled: boolean): Result<null> { if (quitting || disposed || !alive(mini) || typeof enabled !== 'boolean') return unavailable(); mini!.setAlwaysOnTop(enabled); return success(null) },
    hideMain(): Result<null> {
      if (quitting || disposed || !alive(main)) return unavailable()
      if (!available() && !alive(mini)?.isVisible()) { showMain(); return { ok: false, error: { code: 'UNAVAILABLE', message: '托盘恢复能力不可用，主窗口保持可见。' } } }
      hiddenMain = true; main!.hide(); return success(null)
    },
    hideMini(): Result<null> { if (quitting || disposed || !alive(mini)) return unavailable(); if (!available()) return showMain(); mini!.hide(); return success(null) },
    registerTrayRecovery(port: TrayRecovery): Result<() => void> {
      if (quitting || disposed) return unavailable()
      let release: () => void
      try { release = port.registerRestore(() => { showMain() }); if (typeof release !== 'function') return unavailable() }
      catch { return unavailable() }
      try { releaseRecovery?.() } catch { /* New recovery is already registered. */ }
      const generation = {}; recoveryGeneration = generation; recovery = port; releaseRecovery = release
      let revoked = false
      return success(() => { if (revoked) return; revoked = true; if (recoveryGeneration === generation) {
        try { releaseRecovery?.() } finally { releaseRecovery = null; recovery = null; recoveryGeneration = null; reconcile() }
      } })
    },
    state(): WindowState {
      reconcile()
      if (quitting) return 'quitting'
      if (alive(mini)?.isVisible()) return 'miniVisible'
      if (alive(main)?.isMinimized() && !hiddenMain) return 'mainMinimized'
      if (alive(main)?.isVisible()) return 'mainVisible'
      if (available()) return 'trayOnly'
      return main ? 'mainHidden' : 'starting'
    },
    beginQuit() { quitting = true },
    abortQuit() { if (!disposed) { quitting = false; showMain() } },
    dispose() { if (disposed) return; disposed = true; quitting = true; try { releaseRecovery?.() } catch { /* Cleanup must still release all listeners. */ }; recovery = null; releaseRecovery = null; recoveryGeneration = null;
      for (const window of [...listeners.keys()]) detach(window); main = null; mini = null }
  }
}
export type WindowManager = ReturnType<typeof createWindowManager>
