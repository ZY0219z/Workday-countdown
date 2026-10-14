<script setup lang="ts">
import { computed } from 'vue'
import { badgePresentation } from '../ui/presentation'
import type { BadgeState } from '../ui/presentation'

const props = defineProps<{ state: BadgeState; note?: string }>()
const presentation = computed(() => badgePresentation(props.state))
</script>

<template>
  <span class="we-badge" :data-tone="presentation.tone" role="status" aria-live="polite" aria-atomic="true">
    <span class="we-badge-dot" aria-hidden="true"></span>
    <span>{{ presentation.label }}<template v-if="note"> · {{ note }}</template></span>
  </span>
</template>

<style scoped>
.we-badge { display: inline-flex; align-items: center; gap: var(--we-space-1); width: fit-content; max-width: 100%; padding: 3px var(--we-space-2); border: 1px solid transparent; border-radius: 24px; font-size: var(--we-text-small); font-weight: 600; color: var(--we-neutral-text); background: var(--we-neutral-bg); overflow-wrap: anywhere; }
.we-badge-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.we-badge[data-tone="positive"] { color: var(--we-positive-text); background: var(--we-positive-bg); }
.we-badge[data-tone="warning"] { color: var(--we-warning-text); background: var(--we-warning-bg); }
.we-badge[data-tone="danger"] { color: var(--we-danger-text); background: var(--we-danger-bg); }
@media (forced-colors: active) { .we-badge { border-color: CanvasText; } }
</style>
