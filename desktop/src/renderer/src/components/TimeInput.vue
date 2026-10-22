<script setup lang="ts">
import { ref, useId } from 'vue'
import UiIcon from './UiIcon.vue'
defineProps<{modelValue:string;label:string;invalid?:boolean;describedBy?:string;row?:boolean;icon?:'clock'|'coffee'}>()
const emit=defineEmits<{'update:modelValue':[value:string]}>()
const composing=ref(false)
const hintId=useId()
function input(event:Event){if(!composing.value)emit('update:modelValue',(event.target as HTMLInputElement).value)}
function finish(event:CompositionEvent){composing.value=false;emit('update:modelValue',(event.target as HTMLInputElement).value)}
</script>
<template>
  <label class="time-input" :class="{'time-input--row':row}"><span class="time-input-label"><UiIcon v-if="row" :name="icon||'clock'" />{{ label }}</span><span class="time-input-control"><input :value="modelValue" :aria-label="label" :aria-invalid="invalid||undefined" :aria-describedby="[hintId,describedBy].filter(Boolean).join(' ')" type="text" class="we-control" placeholder="HH:MM" inputmode="text" autocomplete="off" :spellcheck="false" @input="input" @compositionstart="composing=true" @compositionend="finish" /><UiIcon v-if="row" class="time-input-clock" name="clock" /></span><small :id="hintId" class="we-muted">24 小时制 HH:MM，例如 08:30</small></label>
</template>
<style scoped>
.time-input{display:grid;gap:var(--we-space-1)}.time-input input{width:100%;max-width:100%}small{font-size:var(--we-text-small)}
.time-input-control { position:relative;display:block;min-width:0; }
.time-input--row { grid-template-columns:minmax(0,1fr) minmax(120px,180px);align-items:center;gap:12px; }
.time-input-label { display:flex;align-items:center;gap:12px; }
.time-input-label svg { flex:none;width:22px;height:22px;color:var(--we-settings-icon,var(--we-accent)); }
.time-input--row input { min-height:40px;padding-right:34px;font-size:15px;font-variant-numeric:tabular-nums; }
.time-input--row .time-input-label { font-size:15px;color:var(--we-muted); }
.time-input-clock { position:absolute;right:11px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:var(--we-muted);pointer-events:none; }
.time-input--row small { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
@media(max-width:400px) { .time-input--row { grid-template-columns:minmax(0,1fr) 132px;gap:8px; }.time-input--row .time-input-label { gap:8px;font-size:13px; } }
</style>
