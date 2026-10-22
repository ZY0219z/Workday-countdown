import { createApp } from 'vue'
import App from '../../src/renderer/src/App.vue'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/styles/base.css'
import '../../src/renderer/src/style.css'

// Real App/controller with in-memory ports. No Electron, config files or OS windows.
const clone = value => structuredClone(value)
const ok = data => ({ ok: true, data: clone(data) })
window.__settingsInit = fixture => {
  let session = clone(fixture.session), snapshot = clone(fixture.snapshot)
  const saves = []
  window.workdayV2 = {
    settingsDraft: {
      read: async () => ok(session),
      update: async request => {
        session = { ...session, draft: clone(request.draft), dirty: true }
        return ok(session)
      }
    },
    config: { save: async request => {
      saves.push(clone(request))
      session = { ...session, saved: { ...session.saved, ...clone(request.settings), revision: session.expectedRevision + 1 },
        draft: clone(request.settings), dirty: false, expectedRevision: session.expectedRevision + 1, issues: [] }
      snapshot.configRevision = session.expectedRevision
      return ok({ config: session.saved, warnings: [] })
    } },
    calendar: { readMetadata: async () => ok(fixture.metadata) },
    snapshot: { read: async () => ok(snapshot), subscribe: async () => ok(null), unsubscribe: async () => ok(null) },
    window: {
      onOpenSettings: () => () => {},
      subscribeVisibility: async listener => { listener(ok({ visible: true, sequence: 1 })); return ok(null) },
      unsubscribeVisibility: async () => ok(null)
    }
  }
  window.__settingsState = () => clone({ session, saves })
  createApp(App).mount('#app')
}
