<script setup lang="ts">
import { ref, useId } from 'vue'
defineProps<{modelValue:string;label:string;invalid?:boolean;describedBy?:string}>()
const emit=defineEmits<{'update:modelValue':[value:string]}>()
const composing=ref(false)
const hintId=useId()
function input(event:Event){if(!composing.value)emit('update:modelValue',(event.target as HTMLInputElement).value)}
function finish(event:CompositionEvent){composing.value=false;emit('update:modelValue',(event.target as HTMLInputElement).value)}
</script>
<template>
  <label class="time-input">{{ label }}<input :value="modelValue" :aria-label="label" :aria-invalid="invalid||undefined" :aria-describedby="[hintId,describedBy].filter(Boolean).join(' ')" type="text" class="we-control" placeholder="HH:MM" inputmode="text" autocomplete="off" :spellcheck="false" @input="input" @compositionstart="composing=true" @compositionend="finish" /><small :id="hintId" class="we-muted">24 小时制 HH:MM，例如 08:30</small></label>
</template>
<style scoped>.time-input{display:grid;gap:var(--we-space-1)}.time-input input{width:100%;max-width:100%}small{font-size:var(--we-text-small)}</style>
