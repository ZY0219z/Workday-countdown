<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { LOCAL_TIME_PATTERN } from '../../../shared/formats'
import UiIcon from './UiIcon.vue'

const props=defineProps<{modelValue:string;label:string;invalid?:boolean;describedBy?:string;row?:boolean;iconTile?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:string]}>()
const composing=ref(false)
const id=useId()
const picker=ref<HTMLElement|null>(null)
const columns=[
  {label:'小时',values:Array.from({length:24},(_,index)=>String(index).padStart(2,'0'))},
  {label:'分钟',values:Array.from({length:60},(_,index)=>String(index).padStart(2,'0'))}
]
const selected=computed(()=>LOCAL_TIME_PATTERN.test(props.modelValue)?props.modelValue.split(':'):['00','00'])

function openPicker(focusOptions=false){
  if(!picker.value?.matches(':popover-open'))picker.value?.showPopover()
  if(focusOptions)picker.value?.querySelector('select')?.focus()
}
function closePicker(){
  if(picker.value?.matches(':popover-open'))picker.value.hidePopover()
}
function onPickerToggle(event:ToggleEvent){
  if(event.newState!=='open')return
  for(const select of picker.value?.querySelectorAll('select')??[]){
    select.selectedOptions[0]?.scrollIntoView({block:'nearest', inline:'nearest'})
  }
}
function chooseTime(index:number,event:Event){
  const parts=selected.value.slice()
  parts[index]=(event.currentTarget as HTMLSelectElement).value
  emit('update:modelValue',parts.join(':'))
}
function input(event:Event){
  closePicker()
  if(!composing.value)emit('update:modelValue',(event.target as HTMLInputElement).value)
}
function finish(event:CompositionEvent){composing.value=false;emit('update:modelValue',(event.target as HTMLInputElement).value)}
</script>
<template>
  <div class="time-input" :class="{'time-input--row':row}">
    <label :for="`${id}-field`" class="time-input-label"><UiIcon v-if="row" name="clock" :tile="iconTile" />{{ label }}</label>
    <div class="time-input-control" :style="{'--time-anchor':`--time-${id}`}">
      <input :id="`${id}-field`" :value="modelValue" :aria-label="label" :aria-invalid="invalid||undefined" :aria-controls="`${id}-picker`"
        :aria-describedby="[`${id}-hint`,describedBy].filter(Boolean).join(' ')" type="text" class="we-control"
        placeholder="HH:MM" inputmode="text" autocomplete="off" :spellcheck="false"
        @click="openPicker()" @keydown.alt.down.prevent="openPicker(true)" @input="input"
        @compositionstart="composing=true;closePicker()" @compositionend="finish" />
      <button type="button" class="time-input-clock" :aria-label="`选择${label}`" :popovertarget="`${id}-picker`"><UiIcon name="clock" /></button>
      <div :id="`${id}-picker`" ref="picker" popover="auto" role="group" :aria-label="`${label}选择器`"
        class="time-input-picker" @toggle="onPickerToggle" @keydown.enter.prevent="closePicker">
        <label v-for="(column,index) in columns" :key="column.label">
          <span>{{ column.label }}</span>
          <select :value="selected[index]" size="5" @change="chooseTime(index,$event)">
            <option v-for="value in column.values" :key="value" :value="value">{{ value }}</option>
          </select>
        </label>
      </div>
    </div>
    <small :id="`${id}-hint`" class="we-muted">24 小时制 HH:MM，例如 08:30。可输入或选择时间。</small>
  </div>
</template>
<style scoped>
.time-input{display:grid;gap:var(--we-space-1)}.time-input input{width:100%;max-width:100%}small{font-size:var(--we-text-small)}
.time-input-control { position:relative;display:block;min-width:0; }
.time-input--row { grid-template-columns:minmax(0,1fr) minmax(120px,180px);align-items:center;gap:12px; }
.time-input-label { display:flex;align-items:center;gap:12px; }
.time-input-label svg { flex:none;color:var(--we-settings-icon,var(--we-accent)); }
.time-input-label svg:not(.ui-icon--tile) { width:22px;height:22px; }
.time-input input { padding-right:34px; }
.time-input--row input { min-height:40px;font-size:15px;font-variant-numeric:tabular-nums; }
.time-input--row .time-input-label { font-size:15px;color:var(--we-muted); }
.time-input-clock { position:absolute;inset-inline-end:5px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--we-muted); }
.time-input-clock:not(:disabled) { cursor:pointer; }
.time-input-clock:hover:not(:disabled) { background:var(--we-accent-soft);color:var(--we-accent); }
.time-input-clock svg { width:17px;height:17px; }
.time-input-picker {
  grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:8px;border:1px solid var(--we-border);
  border-radius:10px;background:var(--we-surface);color:var(--we-text);box-shadow:var(--we-shadow);
  min-inline-size:120px;max-inline-size:calc(100vw - 24px);
}
.time-input-picker:popover-open { display:grid; }
.time-input-picker label { display:grid;gap:4px;color:var(--we-muted);font-size:var(--we-text-small);text-align:center; }
.time-input-picker select {
  inline-size:100%;min-inline-size:0;block-size:min(126px,36dvh);border:1px solid var(--we-border);border-radius:6px;background:var(--we-surface);
  color:var(--we-text);font:inherit;font-size:14px;text-align:center;font-variant-numeric:tabular-nums;scrollbar-width:thin;
}
.time-input-picker option { padding:3px 4px; }
.time-input-picker option:checked { background:var(--we-accent-soft);color:var(--we-text);font-weight:600; }
@supports (top: anchor(bottom)) {
  .time-input-control { anchor-name:var(--time-anchor); }
  .time-input-picker {
    position-anchor:var(--time-anchor);inset:auto;top:calc(anchor(bottom) + 6px);left:anchor(left);margin:0;
    inline-size:anchor-size(width);position-try-fallbacks:flip-block;
  }
}
.time-input--row small { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
@media(max-width:400px) { .time-input--row { grid-template-columns:minmax(0,1fr) 132px;gap:8px; }.time-input--row .time-input-label { gap:8px;font-size:13px; } }
</style>
