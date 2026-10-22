<script setup lang="ts">
import { computed, useId } from 'vue'
import { metricValue } from '../ui/presentation'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{
  title: string
  value: string | number | null
  unit?: string
  description?: string
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
  <section class="we-surface we-metric" :aria-labelledby="headingId">
    <h2 :id="headingId">{{ title }}</h2>
    <p v-if="display !== null" class="we-metric-value">{{ display }} <span v-if="unit" class="we-metric-unit">{{ unit }}</span></p>
    <p v-else class="we-metric-empty">{{ emptyLabel || '暂无数据' }}</p>
    <StatusBadge v-if="estimated" state="estimate" :note="source" />
    <p v-if="description" class="we-muted">{{ description }}</p>
    <p v-if="source && !estimated" class="we-muted">{{ source }}</p>
    <p v-if="kind === 'salary'" class="we-muted we-metric-planned">计划日期，不代表已到账</p>
    <p v-if="warning" class="we-metric-warning">{{ warning }}</p>
  </section>
</template>

<style scoped>
.we-metric { min-width:0;min-height:112px;padding:var(--we-space-4);display:flex;flex-direction:column;align-items:center;gap:var(--we-space-1);text-align:center; }
h2 { font-size: var(--we-text-body); font-weight: 600; overflow-wrap: anywhere; }
.we-metric-value { margin:0;font:650 32px/1.25 var(--we-font-numeric);font-variant-numeric:tabular-nums;color:var(--we-accent);overflow-wrap:anywhere;max-width:100%; }
.we-metric-unit { font: 400 var(--we-text-body)/1.5 var(--we-font); color: var(--we-muted); }
.we-metric-empty { margin: var(--we-space-2) 0; font-size: var(--we-text-body); font-weight: 600; }
.we-metric-warning { color: var(--we-warning-text); font-size: var(--we-text-small); margin-top: var(--we-space-1); overflow-wrap: anywhere; }
.we-muted { overflow-wrap: anywhere; }
</style>
