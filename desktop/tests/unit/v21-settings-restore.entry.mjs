import { createApp } from 'vue'
import App from '../../src/renderer/src/App.vue'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/styles/base.css'
import '../../src/renderer/src/style.css'

// Real App/controller with in-memory ports. No Electron, config files or OS windows.
const clone = value => structuredClone(value)
const ok = data => ({ ok: true, data: clone(data) })
let app
window.__settingsInit = fixture => {
  app?.unmount()
  let session = clone(fixture.session), snapshot = clone(fixture.snapshot)
  let savedSession = clone(session)
  const saves = [], calls = { recovery: 0, imports: [], apply: 0, quit: 0 }
  window.workdayV2 = {
    settingsDraft: {
      read: async () => ok(session),
      update: async request => {
        session = { ...session, draft: clone(request.draft), dirty: true }
        return ok(session)
      },
      discard: async () => { session = clone(savedSession); return ok(session) }
    },
    config: { save: async request => {
      saves.push(clone(request))
      session = { ...session, saved: { ...session.saved, ...clone(request.settings), revision: session.expectedRevision + 1 },
        draft: clone(request.settings), dirty: false, expectedRevision: session.expectedRevision + 1, issues: [] }
      snapshot.configRevision = session.expectedRevision
      savedSession = clone(session)
      return ok({ config: session.saved, warnings: [] })
    } },
    calendar: { readMetadata: async () => ok(fixture.metadata) },
    snapshot: { read: async () => ok(snapshot), subscribe: async () => ok(null), unsubscribe: async () => ok(null) },
    window: {
      onOpenSettings: () => () => {},
      subscribeVisibility: async listener => { listener(ok({ visible: true, sequence: 1 })); return ok(null) },
      unsubscribeVisibility: async () => ok(null)
    },
    app: { quit: async () => { calls.quit++; return { ok: false, error: { code: 'CANCELLED', message: 'Main 退出确认取消' } } } },
    data: {
      previewRecovery: async () => {
        calls.recovery++
        if (session.configurationStatus === 'future') return { ok: false, error: { code: 'UNAVAILABLE', message: '较新版本配置只读，不覆盖。' } }
        return ok({ previewToken: 'memory-only', expectedRevision: session.expectedRevision,
          choices: [{ field: 'employee.startDate', current: session.draft.employee.startDate, incoming: '2026-09-01', issues: [] }],
          notes: [], undatedOvertimeMinutes: null, alreadyProcessed: false })
      },
      previewImport: async input => { calls.imports.push(clone(input)); return { ok: false, error: { code: 'CANCELLED', message: '已取消' } } },
      cancelImport: async () => ok(null),
      applyImport: async () => { calls.apply++; return { ok: false, error: { code: 'FORBIDDEN', message: '未覆盖只读配置。' } } }
    }
  }
  window.__settingsState = () => clone({ session, saves, calls })
  app = createApp(App); app.mount('#app')
}
