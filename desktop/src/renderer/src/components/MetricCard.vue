<script setup lang="ts">
import { computed, useId } from 'vue'
import { metricValue } from '../ui/presentation'
import StatusBadge from './StatusBadge.vue'
import UiIcon from './UiIcon.vue'

const props = defineProps<{
  title: string
  value: string | number | null
  unit?: string
  description?: string
  descriptionLabel?: string
  source?: string
  estimated?: boolean
  warning?: string
  kind?: 'generic' | 'salary'
  emptyLabel?: string
  tone?: 'rest' | 'salary' | 'employment'
}>()
const headingId = useId()
const display = computed(() => metricValue(props.value))
const hasDetails = computed(() => !!(props.descriptionLabel || props.description || (props.source && !props.estimated) || props.kind === 'salary'))
const icons = { rest: 'palm', salary: 'wallet', employment: 'calendar' } as const
</script>

<template>
  <section class="we-surface we-metric" :class="[tone && 'we-metric--'+tone, { 'we-metric--long': display !== null && display.length > 3, 'we-metric--value-only': !hasDetails }]" :style="{ '--we-value-length': display?.length || 1 }" :aria-labelledby="headingId">
    <div class="we-metric-heading"><span v-if="tone" class="we-metric-icon"><UiIcon :name="icons[tone]" /></span><h2 :id="headingId">{{ title }}</h2></div>
    <div class="we-metric-body">
      <p v-if="display !== null" class="we-metric-value">{{ display }} <span v-if="unit" class="we-metric-unit">{{ unit }}</span></p>
      <p v-else class="we-metric-empty">{{ emptyLabel || '暂无数据' }}</p>
      <div v-if="hasDetails" class="we-metric-details">
        <p v-if="descriptionLabel" class="we-muted we-metric-label">{{ descriptionLabel }}</p>
        <p v-if="description" class="we-muted">{{ description }}</p>
        <p v-if="source && !estimated" class="we-muted">{{ source }}</p>
        <p v-if="kind === 'salary'" class="we-muted we-metric-planned">计划日期，不代表已到账</p>
      </div>
    </div>
    <StatusBadge v-if="estimated" state="estimate" :note="source" />
    <p v-if="warning" class="we-metric-warning">{{ warning }}</p>
  </section>
</template>

<style scoped>
.we-metric { min-width:0;padding:var(--we-space-4);display:grid;grid-template-rows:auto 1fr;gap:var(--we-space-2);container-type:inline-size;min-height:138px; }
.we-metric.we-metric--rest { --metric-tint:var(--we-rest-tint,#e3f5ff);--metric-icon:var(--we-rest-icon,#17638c); }
.we-metric.we-metric--salary { --metric-tint:var(--we-salary-tint,#fff1da);--metric-icon:var(--we-salary-icon,#986014); }
.we-metric.we-metric--employment { --metric-tint:var(--we-employment-tint,#eee8ff);--metric-icon:var(--we-employment-icon,#6450a7); }
.we-metric[class*="we-metric--"] { background:linear-gradient(135deg,color-mix(in srgb,var(--metric-tint,var(--we-subtle)) 58%,var(--we-surface)),var(--we-surface));border-color:var(--we-card-border,var(--we-border)); }
.we-metric-heading { display:flex;align-items:center;gap:10px;min-width:0; }
.we-metric-icon { display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:12px;background:var(--metric-tint);color:var(--metric-icon); }
.we-metric-icon svg { width:24px;height:24px; }
h2 { text-align:left;font-size:var(--we-text-body);font-weight:600;overflow-wrap:anywhere; }
.we-metric-body { min-width:0;display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:2px; }
.we-metric-details { min-width:0;text-align:right; }
.we-metric-details .we-muted { color:var(--we-muted); }
.we-metric-value { display:flex;align-items:baseline;justify-content:flex-end;gap:6px;min-width:0;max-width:100%;margin:0;white-space:nowrap;font:700 min(46px,calc((100cqi - 24px) / var(--we-value-length) * 1.7))/1.08 var(--we-font-numeric);font-variant-numeric:tabular-nums;letter-spacing:-.03em;color:var(--we-clock,var(--we-text)); }
.we-metric-unit { font: 400 var(--we-text-body)/1.5 var(--we-font); color: var(--we-muted); }
.we-metric-empty { min-width:0;text-align:right;font-size:var(--we-text-small);font-weight:600;overflow-wrap:anywhere; }
.we-metric-warning { color: var(--we-warning-text); font-size: var(--we-text-small); margin-top: var(--we-space-1); overflow-wrap: anywhere; }
.we-muted { overflow-wrap: anywhere; }
.we-metric-unit { flex-shrink:0; }
@container (max-width:140px) { .we-metric-icon { width:26px;height:26px; }.we-metric-heading { gap:6px; }.we-metric-value { font-size:min(36px,calc((100cqi - 24px) / var(--we-value-length) * 1.7)); } }
@media (forced-colors:active) { .we-metric[class*="we-metric--"] { background:Canvas;border-color:CanvasText; }.we-metric-icon { background:Canvas;color:CanvasText; } }
</style>
