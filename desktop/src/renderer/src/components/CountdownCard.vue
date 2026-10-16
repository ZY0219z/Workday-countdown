<script setup lang="ts">
import { computed, useId } from 'vue'
import type { BusinessState, LocalDate, LocalTime } from '../../../shared/contracts'
import { countdownPresentation } from '../ui/presentation'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{
  state: BusinessState
  text: string | null
  target?: { kind: 'workStart' | 'finalWorkEnd'; date?: LocalDate; time: LocalTime } | null
  hint?: string
  estimate?: string
  warning?: string
  compact?: boolean
}>()
const headingId = useId()
const display = computed(() => countdownPresentation(props.state, props.text, props.target?.kind))
</script>

<template>
  <section class="we-surface we-countdown" :class="{ 'we-countdown--compact': compact }" :aria-labelledby="headingId">
    <div class="we-countdown-header"><StatusBadge :state="state" /><slot name="actions"></slot></div>
    <div class="we-countdown-body">
      <div class="we-countdown-copy">
        <h2 :id="headingId">{{ display.heading }}</h2>
        <output v-if="display.text !== null" class="we-countdown-value" role="timer" aria-live="off" :aria-label="display.heading">{{ display.text }}</output>
        <p v-else class="we-countdown-empty">{{ display.emptyLabel }}</p>
        <p v-if="target && display.text !== null" class="we-muted we-countdown-target">{{ target.kind === 'workStart' ? '上班' : '下班时间' }}：{{ [target.date, target.time].filter(Boolean).join(' ') }}</p>
      </div>
      <div v-if="$slots.illustration" class="we-countdown-illustration"><slot name="illustration"></slot></div>
    </div>
    <p v-if="hint" class="we-muted we-countdown-hint">{{ hint }}</p>
    <div v-if="estimate || warning" class="we-countdown-notices">
      <StatusBadge v-if="estimate" state="estimate" :note="estimate" />
      <p v-if="warning" class="we-countdown-warning">{{ warning }}</p>
    </div>
  </section>
</template>

<style scoped>
.we-countdown { padding: var(--we-space-5); container-type: inline-size; }
.we-countdown-header { display: flex; align-items: center; justify-content: space-between; gap: var(--we-space-2); }
.we-countdown-body { display: flex; align-items: center; gap: var(--we-space-4); margin-top: var(--we-space-3); }
.we-countdown-copy { min-width: 0; flex: 1; }
h2 { font-size: var(--we-text-title); font-weight: 600; }
.we-countdown-value { display: block; font: 650 clamp(36px, 12cqi, 56px)/1.25 var(--we-font-numeric); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.we-countdown-illustration { flex: 0 0 126px; width: 126px; }
.we-countdown-illustration :deep(canvas), .we-countdown-illustration :deep(img), .we-countdown-illustration :deep(svg) { display: block; width: 100%; height: auto; }
.we-countdown-empty { margin-top: var(--we-space-2); font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
.we-countdown-target { overflow-wrap: anywhere; }
.we-countdown-hint, .we-countdown-notices { margin-top: var(--we-space-2); }
.we-countdown-warning { margin-top: var(--we-space-1); color: var(--we-warning-text); font-size: var(--we-text-small); overflow-wrap: anywhere; }
.we-countdown--compact { padding: var(--we-space-2); }
.we-countdown--compact h2 { font-size: var(--we-text-small); }
.we-countdown--compact .we-countdown-body { gap: var(--we-space-2); margin-top: var(--we-space-1); }
.we-countdown--compact .we-countdown-value { font-size: clamp(22px, 12cqi, 30px); line-height: 1.2; }
.we-countdown--compact .we-countdown-illustration { flex-basis: 36px; width: 36px; }
.we-countdown--compact .we-countdown-empty { font-size: 14px; }
.we-countdown--compact .we-countdown-hint { margin-top: var(--we-space-1); }
@container (max-width: 440px) {
  .we-countdown-illustration { flex-basis: 80px; width: 80px; }
  .we-countdown--compact .we-countdown-illustration { flex-basis: 36px; width: 36px; }
}
</style>
