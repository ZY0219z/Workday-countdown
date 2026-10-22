<script setup lang="ts">
import { computed, useId } from 'vue'
import { metricValue } from '../ui/presentation'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{
  title: string
  value: string | number | null
  unit?: string
  description?: string
  descriptionLabel?: string
  accessibleDescription?: string
  source?: string
  estimated?: boolean
  warning?: string
  kind?: 'generic' | 'salary'
  emptyLabel?: string
}>()
const headingId = useId()
const display = computed(() => metricValue(props.value))
</script>

<template>
  <section class="we-surface we-metric" :class="{ 'we-metric--long': display !== null && display.length > 3, 'we-metric--value-only': !description && !descriptionLabel }" :aria-labelledby="headingId" :aria-describedby="accessibleDescription ? headingId+'-meaning' : undefined">
    <h2 :id="headingId">{{ title }}</h2>
    <p v-if="accessibleDescription" :id="headingId+'-meaning'" class="we-metric-meaning">{{ accessibleDescription }}</p>
    <div class="we-metric-body">
      <div v-if="description || descriptionLabel || source || kind==='salary'" class="we-metric-details">
        <p v-if="descriptionLabel" class="we-muted we-metric-label">{{ descriptionLabel }}</p>
        <p v-if="description" class="we-muted">{{ description }}</p>
        <p v-if="source && !estimated" class="we-muted">{{ source }}</p>
        <p v-if="kind === 'salary'" class="we-muted we-metric-planned">计划日期，不代表已到账</p>
      </div>
      <p v-if="display !== null" class="we-metric-value">{{ display }} <span v-if="unit" class="we-metric-unit">{{ unit }}</span></p>
      <p v-else class="we-metric-empty">{{ emptyLabel || '暂无数据' }}</p>
    </div>
    <StatusBadge v-if="estimated" state="estimate" :note="source" />
    <p v-if="warning" class="we-metric-warning">{{ warning }}</p>
  </section>
</template>

<style scoped>
.we-metric.we-surface { min-width:0;padding:var(--we-space-4);display:grid;align-content:start;gap:var(--we-space-2);container-type:inline-size;box-shadow:none;background:linear-gradient(135deg,var(--we-surface),var(--we-subtle)); }
h2 { text-align:left;font-size:13px;font-weight:600;color:var(--we-muted);overflow-wrap:anywhere; }
.we-metric-body { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:center;gap:var(--we-space-2); }
.we-metric-details { min-width:0; }
.we-metric-details .we-muted { color:var(--we-text); }
.we-metric-details .we-metric-label { color:var(--we-muted); }
.we-metric-value { min-width:0;margin:0;text-align:right;font:500 40px/1.15 var(--we-font-numeric);font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--we-text);overflow-wrap:anywhere; }
.we-metric-meaning { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%); }
.we-metric--value-only .we-metric-body { grid-template-columns:minmax(0,1fr); }
.we-metric--value-only { grid-template-columns:minmax(0,1fr) auto; }
.we-metric--value-only h2 { grid-column:1;grid-row:1;align-self:start; }
.we-metric--value-only .we-metric-body { grid-column:2;grid-row:1; }
.we-metric--value-only.we-metric--long { grid-template-columns:minmax(0,1fr); }
.we-metric--value-only.we-metric--long .we-metric-body { grid-column:1;grid-row:2; }
.we-metric-unit { font: 400 var(--we-text-body)/1.5 var(--we-font); color: var(--we-muted); }
.we-metric-empty { min-width:0;text-align:right;font-size:var(--we-text-small);font-weight:600;overflow-wrap:anywhere; }
.we-metric-warning { color: var(--we-warning-text); font-size: var(--we-text-small); margin-top: var(--we-space-1); overflow-wrap: anywhere; }
.we-muted { overflow-wrap: anywhere; }
.we-metric--long .we-metric-body { grid-template-columns:minmax(0,1fr); }
@container (max-width:140px) { .we-metric-value { font-size:32px; } .we-metric-body { grid-template-columns:minmax(0,1fr); } }
@media (forced-colors:active) { .we-metric.we-surface { background:Canvas;border-color:CanvasText; } }
</style>
