import { createApp, h, nextTick, ref, shallowRef } from 'vue'
import DashboardVariants from '../../src/renderer/src/preview/DashboardVariants.vue'
import '../../src/renderer/src/styles/tokens.css'
import '../../src/renderer/src/styles/base.css'
import '../../src/renderer/src/style.css'

// Static comparison shell. No Electron bridge, clock, real config or window actions.
const snapshot = shallowRef(null), variant = ref('a'), theme = ref('light'), accent = ref('ocean')
createApp({ render: () => h('div', {
  class: 'workday-ui app-shell', 'data-theme': theme.value, 'data-accent': accent.value, 'data-reduced-motion': 'true'
}, [h('div', { class: 'app-content' }, [
  h('header', { class: 'app-header' }, [h('h1', '今天你摸鱼了吗'), h('div', { class: 'app-header-actions', inert: '' }, [
    h('button', { class: 'we-button app-mini' }, '迷你模式'),
    h('button', { class: 'we-button app-menu', 'aria-label': '设置' }, [h('svg', { viewBox: '0 0 20 20' }, [h('path', { d: 'M4 5h12M4 10h12M4 15h12' })])])
  ])]),
  h('main', [h(DashboardVariants, { variant: variant.value, snapshot: snapshot.value })])
])]) }).mount('#app')

window.__variants = async value => {
  snapshot.value = value.snapshot; variant.value = value.variant
  theme.value = value.theme ?? 'light'; accent.value = value.accent ?? 'ocean'
  await nextTick()
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))
}
