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
  hero?: boolean
}>()
const headingId = useId()
const display = computed(() => countdownPresentation(props.state, props.text, props.target?.kind))
</script>

<template>
  <section class="we-countdown" :class="{ 'we-surface': !hero, 'we-countdown--compact': compact, 'we-countdown--hero': hero }" :aria-labelledby="headingId">
    <div class="we-countdown-header"><StatusBadge :state="state" /><slot name="actions"></slot></div>
    <div class="we-countdown-body">
      <div class="we-countdown-copy">
        <h2 :id="headingId">{{ display.heading }}</h2>
        <output v-if="display.text !== null" class="we-countdown-value" role="timer" aria-live="off" :aria-label="hero ? display.heading+' '+display.text : display.heading" :style="hero ? { '--we-time-length': display.text.length } : undefined"><template v-if="hero"><template v-for="(part,index) in display.text.split(':')" :key="index"><span class="we-time-group" :class="{'we-time-group--seconds':index===2}"><span class="we-time-part">{{ part }}</span></span><span v-if="index<2" class="we-time-separator" aria-hidden="true">:</span></template></template><template v-else>{{ display.text }}</template></output>
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
.we-countdown--hero { position:relative;padding:12px var(--we-space-6) 0;text-align:center; }
.we-countdown--hero .we-countdown-header { position:absolute;top:var(--we-space-4);right:var(--we-space-6); }
.we-countdown--hero .we-countdown-body { margin-top:0; }
.we-countdown--hero h2 { color:var(--we-clock,var(--we-text));font-size:17px;font-weight:600; }
.we-countdown--hero .we-countdown-value { display:flex;justify-content:center;align-items:start;gap:8px;margin:8px 0 12px;font-size:min(96px,calc(145cqi / var(--we-time-length)));font-weight:700;line-height:1.03;letter-spacing:-.035em;color:var(--we-clock,var(--we-text));overflow-wrap:normal; }
.we-time-group { display:grid;justify-items:center; }
.we-time-group--seconds { color:var(--we-clock-seconds,var(--we-accent)); }
.we-countdown--hero .we-time-part { flex:none; }
.we-countdown--hero .we-time-separator { color:var(--we-clock-seconds,var(--we-muted));font-size:.7em;font-weight:400;line-height:1.25; }
.we-countdown--hero .we-countdown-hint { margin-top:4px; }
.we-countdown--hero .we-countdown-target,.we-countdown--hero .we-countdown-hint { font-size:13px; }
.we-countdown--hero .we-countdown-notices { display:grid;justify-items:center;gap:var(--we-space-1); }
@container (max-width: 440px) {
  .we-countdown--hero .we-countdown-value { gap:4px;font-size:min(72px,calc(138cqi / var(--we-time-length))); }
  .we-countdown-illustration { flex-basis: 80px; width: 80px; }
  .we-countdown--compact .we-countdown-illustration { flex-basis: 36px; width: 36px; }
}
@container (max-width:360px) { .we-countdown--hero .we-countdown-header { position:static;justify-content:center;margin-bottom:8px; } }
/* Keep the heading above the system text backplate around the large clock. */
@media (forced-colors:active) { .we-countdown--hero h2 { position:relative;z-index:1; } }
</style>
