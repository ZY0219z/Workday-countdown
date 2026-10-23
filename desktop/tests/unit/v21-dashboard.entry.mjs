import { createApp, h, nextTick, ref, shallowRef } from 'vue'
import Dashboard from '../../src/renderer/src/views/DashboardView.vue'
import AppTitle from '../../src/renderer/src/components/AppTitle.vue'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/styles/base.css'
import '../../src/renderer/src/style.css'

// Isolated Dashboard only: no Electron bridge, config access or business clock.
const snapshot = shallowRef(null), motionAllowed = ref(false)
const theme = ref('light'), accent = ref('ocean'), reduced = ref(true)
createApp({ render: () => h('div', {
  class: 'workday-ui app-shell', 'data-theme': theme.value, 'data-accent': accent.value,
  'data-reduced-motion': String(reduced.value)
}, [h('div', { class: 'app-content app-content--dashboard' }, [
  h('header', { class: 'app-header' }, [h(AppTitle), h('div', { class: 'app-header-actions' }, [
    h('button', { class: 'we-button app-mini' }, '迷你模式'),
    h('button', { class: 'we-button app-menu', 'aria-label': '设置' }, [h('svg', { viewBox: '0 0 20 20' }, [h('path', { d: 'M4 5h12M4 10h12M4 15h12' })])])
  ])]), h('main', { class: 'app-main--dashboard' }, [h(Dashboard, { snapshot: snapshot.value, motionAllowed: motionAllowed.value })])
])]) }).mount('#app')

window.__dashboard = async value => {
  snapshot.value = value.snapshot
  theme.value = value.theme ?? 'light'; accent.value = value.accent ?? 'ocean'
  reduced.value = value.reduced ?? true; motionAllowed.value = value.motionAllowed ?? false
  await nextTick()
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
}
