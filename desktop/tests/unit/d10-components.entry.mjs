import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CountdownCard from '../../src/renderer/src/components/CountdownCard.vue'
import MetricCard from '../../src/renderer/src/components/MetricCard.vue'
import StatusBadge from '../../src/renderer/src/components/StatusBadge.vue'
export { createThemeController, resolveAppearance } from '../../src/renderer/src/ui/appearance.ts'
export { countdownPresentation, badgePresentation, metricValue } from '../../src/renderer/src/ui/presentation.ts'

export function render(component, props, slots) {
  return renderToString(createSSRApp({ render: () => h({ CountdownCard, MetricCard, StatusBadge }[component], props, slots) }))
}
export async function renderPair() {
  return renderToString(createSSRApp({ render: () => h('div', [h(MetricCard, { title: 'A', value: 0 }), h(MetricCard, { title: 'B', value: null })]) }))
}
