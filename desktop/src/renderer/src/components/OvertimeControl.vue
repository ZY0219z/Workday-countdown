<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import type { ContractError, DashboardSnapshot, Result } from '../../../shared/contracts'
import type { OvertimeEdit, OvertimeTarget } from '../ui/settings-controller'
import UiIcon from './UiIcon.vue'

const timeColumns = [
  { part: 'hour', label: '小时', values: Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')) },
  { part: 'minute', label: '分钟', values: Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')) }
] as const

const props = defineProps<{
  snapshot: DashboardSnapshot | null
  savedRevision: number
  ready: boolean
  recovering: boolean
  read: () => Promise<Result<OvertimeTarget>>
  save: (edit: OvertimeEdit) => Promise<Result<number>>
}>()
const emit = defineEmits<{ 'dialog-change': [open: boolean] }>()
const id = useId()
const dialog = ref<HTMLDialogElement | null>(null)
const toggle = ref<HTMLButtonElement | null>(null)
const timeTrigger = ref<HTMLButtonElement | null>(null)
const timePicker = ref<HTMLElement | null>(null)
const pickerOpen = ref(false)
const dismiss = ref<HTMLButtonElement | null>(null)
const confirm = ref<HTMLButtonElement | null>(null)
const mode = ref<'edit' | 'cancel' | 'check'>('edit')
const target = ref<OvertimeTarget | null>(null)
const time = ref('')
const error = ref('')
const validationError = ref(false)
const loading = ref(false)
const saving = ref(false)
let origin: HTMLButtonElement | null = null
let openedFor: string | null = null

const snapshotCurrent = computed(() => (props.snapshot?.configRevision ?? 0) >= props.savedRevision)
const shift = computed(() => {
  const value = props.snapshot
  return snapshotCurrent.value && value?.state !== 'rest' && value?.state !== 'incomplete' ? value?.activeShift : null
})
const shiftIdentity = computed(() => shift.value && props.snapshot
  ? JSON.stringify([props.snapshot.configRevision, props.snapshot.timeZoneId, shift.value.shiftDate]) : null)
const checked = computed(() => (shift.value?.overtimeMinutes ?? 0) > 0)
const available = computed(() => props.ready && !loading.value && !saving.value && (props.recovering || !!shift.value))
const stale = computed(() => target.value !== null && shiftIdentity.value !== openedFor)
const pickerDisabled = computed(() => saving.value || stale.value || props.recovering)
const pickerVisible = computed(() => pickerOpen.value && !pickerDisabled.value)
const selectedTime = computed(() => ({ hour: time.value.slice(0, 2), minute: time.value.slice(3) }))
const title = computed(() => mode.value === 'cancel' ? '恢复正常下班时间' : mode.value === 'check' ? '核对加班保存状态' : '加班设置')
const cancelTimes = computed(() => {
  const context = target.value?.context
  if (!context) return null
  const { shiftDate, normalEnd, finalEnd } = context
  const crossesDate = normalEnd.date !== shiftDate || finalEnd.date !== shiftDate
  return {
    normal: crossesDate ? `${normalEnd.date} ${normalEnd.time}` : normalEnd.time,
    final: crossesDate ? `${finalEnd.date} ${finalEnd.time}` : finalEnd.time
  }
})

function showError(value: ContractError) {
  validationError.value = value.code === 'VALIDATION'
  if (value.code === 'VALIDATION') error.value = value.issues.find(item => item.field === '$.expectedEndTime')?.message ?? value.message
  else if (value.code === 'REVISION_CONFLICT') error.value = `配置修订冲突（${value.expectedRevision} → ${value.actualRevision}）。请重新打开弹窗，或重启应用读取最新配置。`
  else error.value = value.message
}

function close() {
  if (saving.value || !dialog.value?.open) return
  pickerOpen.value = false
  dialog.value.close()
  emit('dialog-change', false)
  void nextTick(restoreFocus)
}

function restoreFocus() {
  const control = origin?.isConnected && !origin.disabled ? origin : toggle.value
  control?.focus()
}

function closePicker() {
  pickerOpen.value = false
  timeTrigger.value?.focus()
}

function handleEscape() {
  if (pickerVisible.value) closePicker()
  else close()
}

function dismissPickerOutside(event: MouseEvent) {
  const clicked = event.target as Node
  if (pickerOpen.value && !timeTrigger.value?.contains(clicked) && !timePicker.value?.contains(clicked)) pickerOpen.value = false
}

function revealTimeOption(list: HTMLElement, center = false) {
  const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')
  if (!selected) return
  const top = selected.offsetTop
  const bottom = top + selected.offsetHeight
  if (center) list.scrollTop = top - (list.clientHeight - selected.offsetHeight) / 2
  else if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
}

async function togglePicker() {
  if (pickerDisabled.value) return
  if (pickerVisible.value) { closePicker(); return }
  pickerOpen.value = true
  await nextTick()
  const lists = timePicker.value?.querySelectorAll<HTMLElement>('[role="listbox"]')
  lists?.forEach(list => revealTimeOption(list, true))
  lists?.[0]?.focus({ preventScroll: true })
}

function selectTime(part: 'hour' | 'minute', value: string) {
  if (pickerDisabled.value) return
  const { hour, minute } = selectedTime.value
  time.value = part === 'hour' ? `${value}:${minute}` : `${hour}:${value}`
  error.value = ''
  validationError.value = false
}

async function navigateTime(event: KeyboardEvent, column: typeof timeColumns[number]) {
  const current = Number(selectedTime.value[column.part])
  const last = column.values.length - 1
  let next: number
  switch (event.key) {
    case 'ArrowDown': next = Math.min(last, current + 1); break
    case 'ArrowUp': next = Math.max(0, current - 1); break
    case 'Home': next = 0; break
    case 'End': next = last; break
    case 'Enter':
    case ' ': event.preventDefault(); closePicker(); return
    default: return
  }
  event.preventDefault()
  const list = event.currentTarget as HTMLElement
  selectTime(column.part, column.values[next])
  await nextTick()
  revealTimeOption(list)
}

async function loadTarget() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    const result = await props.read()
    if (!dialog.value?.open) return
    if (mode.value === 'check' && !props.recovering) { close(); return }
    if (!result.ok) { showError(result.error); return }
    if (shiftIdentity.value !== openedFor || props.snapshot?.configRevision !== result.data.revision || shift.value?.shiftDate !== result.data.context.shiftDate) {
      error.value = '当前班次已变化，请重新打开加班设置。'
      return
    }
    target.value = result.data
    time.value = checked.value ? result.data.context.finalEnd.time : result.data.context.normalEnd.time
  } finally {
    loading.value = false
    await nextTick()
    if (dialog.value?.open && mode.value === 'edit' && target.value) timeTrigger.value?.focus()
    if (!dialog.value?.open) restoreFocus()
  }
}

async function open(action: 'edit' | 'cancel', event: MouseEvent) {
  if (!available.value || dialog.value?.open) return
  origin = event.currentTarget as HTMLButtonElement
  openedFor = shiftIdentity.value ?? null
  mode.value = props.recovering ? 'check' : action
  target.value = null
  time.value = ''
  error.value = ''
  validationError.value = false
  emit('dialog-change', true)
  dialog.value?.showModal()
  await nextTick()
  if (!dialog.value?.open) return
  dismiss.value?.focus()
  await loadTarget()
}

async function submit() {
  if (!target.value || stale.value || props.recovering || loading.value || saving.value) return
  const context = target.value.context
  const input = mode.value === 'cancel' ? null : time.value
  pickerOpen.value = false
  error.value = ''
  validationError.value = false
  if (input === context.normalEnd.time) {
    error.value = '当前选择的是正常下班时间。请选择加班结束时间。'
    validationError.value = true
    timeTrigger.value?.focus()
    return
  }
  saving.value = true
  const result = await props.save({ targetKey: context.targetKey, expectedRevision: target.value.revision, input })
  saving.value = false
  if (result.ok) { close(); return }
  showError(result.error)
  await nextTick()
  if (validationError.value) timeTrigger.value?.focus()
  else confirm.value?.focus()
}

async function checkAgain() {
  mode.value = 'check'
  target.value = null
  await loadTarget()
}
</script>

<template>
  <div v-show="snapshotCurrent || recovering" class="overtime-pill" :class="{ 'overtime-pill--unavailable': !available }">
    <button v-if="checked" type="button" class="overtime-icon overtime-moon" :disabled="!available"
      aria-label="修改加班时间" aria-haspopup="dialog" @click="open('edit', $event)">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10.9 2.2a9.8 9.8 0 1 0 10.9 13.3c-7.4 2.9-14.3-4.4-10.9-13.3ZM17.5 2l1.2 2.8L21.5 6l-2.8 1.2L17.5 10l-1.2-2.8L13.5 6l2.8-1.2ZM21.3 9l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8Z" /></svg>
    </button>
    <span v-else class="overtime-icon overtime-home" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="m2 11 10-9 10 9h-3v10h-5v-7h-4v7H5V11Z" /></svg>
    </span>
    <button ref="toggle" type="button" role="switch" class="overtime-switch" :aria-checked="checked"
      :aria-label="recovering ? '核对加班保存状态' : '今日加班'" aria-haspopup="dialog" :disabled="!available"
      @click="open(checked ? 'cancel' : 'edit', $event)"><span aria-hidden="true" /></button>
  </div>

  <dialog ref="dialog" class="overtime-dialog" :aria-labelledby="`${id}-title`" :aria-describedby="mode === 'cancel' && cancelTimes ? `${id}-prompt` : undefined"
    @cancel.prevent="handleEscape" @click.capture="dismissPickerOutside">
    <form class="overtime-form" @submit.prevent="submit">
      <header class="overtime-header">
        <h2 :id="`${id}-title`">{{ title }}</h2>
        <button type="button" class="overtime-close" aria-label="关闭" :disabled="saving" @click="close">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <p v-if="mode === 'cancel' && cancelTimes" :id="`${id}-prompt`">
        当前已设置加班至 {{ cancelTimes.final }}。<br />
        确认后，今天的下班时间将恢复为 {{ cancelTimes.normal }}。
      </p>
      <div v-if="mode === 'edit' && target" class="overtime-time">
        <span :id="`${id}-time-label`" class="overtime-time-label">加班到</span>
        <button ref="timeTrigger" type="button" class="we-control overtime-time-trigger" :disabled="pickerDisabled"
          :aria-labelledby="`${id}-time-label ${id}-time-value`" :aria-expanded="pickerVisible"
          :aria-controls="pickerVisible ? `${id}-picker` : undefined" :aria-invalid="validationError || undefined"
          :aria-describedby="`${id}-hint${validationError ? ` ${id}-error` : ''}`" @click="togglePicker">
          <span :id="`${id}-time-value`">{{ time }}</span><UiIcon name="clock" />
        </button>
        <div v-if="pickerVisible" :id="`${id}-picker`" ref="timePicker" class="overtime-time-picker">
          <div v-for="column in timeColumns" :key="column.part">
            <div :id="`${id}-${column.part}-label`" class="overtime-column-label">{{ column.label }}</div>
            <div role="listbox" tabindex="0" class="overtime-time-options" :aria-labelledby="`${id}-${column.part}-label`"
              :aria-activedescendant="`${id}-${column.part}-${selectedTime[column.part]}`" @keydown="navigateTime($event, column)">
              <div v-for="value in column.values" :id="`${id}-${column.part}-${value}`" :key="value" role="option"
                :aria-selected="value === selectedTime[column.part]" @click="selectTime(column.part, value)">{{ value }}</div>
            </div>
          </div>
        </div>
        <p :id="`${id}-hint`" class="we-muted">正常下班 {{ target.context.normalEnd.time }}，较早时刻按次日解释。</p>
      </div>
      <p v-if="loading" class="we-muted" role="status">正在读取当前班次…</p>
      <p v-if="stale && !saving && !error" class="overtime-error" role="status">当前班次或配置已变化，请重新打开弹窗。</p>
      <p v-if="error" :id="`${id}-error`" class="overtime-error" role="alert">{{ error }}</p>
      <div class="overtime-actions">
        <button ref="dismiss" type="button" class="we-button" :disabled="saving" @click="close">{{ mode === 'cancel' ? '保留加班' : '取消' }}</button>
        <button v-if="(recovering && !saving) || mode === 'check'" type="button" class="we-button we-button--primary" :disabled="loading || saving" @click="checkAgain">重试核对</button>
        <button v-else-if="!target && !loading && error" type="button" class="we-button we-button--primary" @click="loadTarget">重新读取</button>
        <button v-else ref="confirm" type="submit" class="we-button we-button--primary" :disabled="!target || stale || loading || saving">
          {{ saving ? '正在保存…' : mode === 'cancel' ? '确认恢复' : '确认加班' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.overtime-pill {
  position: absolute;
  z-index: 1;
  inset-block-start: clamp(10px, 3.25cqi, 24px);
  inset-inline-start: clamp(10px, 3.25cqi, var(--we-space-6));
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid var(--we-card-border, var(--we-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--we-surface) 95%, transparent);
  box-shadow: 0 2px 6px rgb(27 76 122 / 14%);
}
.overtime-pill--unavailable { opacity: .66; }
.overtime-icon, .overtime-switch, .overtime-close {
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  padding: 0;
  background: none;
}
.overtime-icon { width: 26px; height: 26px; }
.overtime-icon svg { width: 20px; height: 20px; }
.overtime-home { color: #1470e5; }
.overtime-home path { fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linejoin: round; }
.overtime-moon { color: #ffbf24; }
.overtime-moon path { fill: currentColor; }
.overtime-moon:hover:not(:disabled), .overtime-close:hover:not(:disabled) { background: var(--we-accent-soft); }
.overtime-switch {
  --knob-travel: 13px;
  width: 37px;
  height: 24px;
  justify-items: start;
  padding-inline: 3px;
  background: #77889e;
  transition: background-color 150ms ease;
}
.overtime-switch[aria-checked="true"] { background: #0875ed; }
.overtime-switch span {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(20 48 82 / 20%);
  transition: transform 150ms ease;
}
.overtime-switch[aria-checked="true"] span { transform: translateX(var(--knob-travel)); }
.overtime-switch:hover:not(:disabled) { filter: brightness(1.1); }
.overtime-pill button:not(:disabled), .overtime-close:not(:disabled) { cursor: pointer; }
.overtime-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(368px, calc(100% - 32px));
  height: fit-content;
  max-height: calc(100% - 32px);
  overflow: auto;
  padding: 0;
  border: 1px solid var(--we-card-border, var(--we-border));
  border-radius: var(--we-radius-card);
  color: var(--we-text);
  background: var(--we-surface);
  box-shadow: 0 12px 30px rgb(19 56 97 / 24%);
}
.overtime-dialog:where([data-theme="dark"] *) { color-scheme: dark; }
.overtime-dialog::backdrop { background: rgb(12 35 67 / 25%); }
.overtime-form { display: grid; gap: 9px; padding: 12px 18px 14px; }
.overtime-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--we-clock, var(--we-text)); }
.overtime-header h2 { font-size: 20px; line-height: 1.4; font-weight: 700; }
.overtime-close { color: var(--we-muted); width: 30px; height: 30px; }
.overtime-close svg { width: 18px; height: 18px; }
.overtime-close path { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.overtime-time {
  --overtime-picker-blue: #1e55a2;
  --overtime-picker-selected: #dceafd;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  align-items: center;
  border-radius: 12px;
  background: var(--we-accent-soft);
  padding: 7px 10px;
}
.overtime-time:where([data-theme="dark"] *) {
  --overtime-picker-blue: #9dc8ff;
  --overtime-picker-selected: #25436b;
}
.overtime-time-label { font-weight: 600; }
.overtime-time-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  justify-self: start;
  inline-size: 152px;
  max-inline-size: 100%;
  gap: 8px;
  font-variant-numeric: tabular-nums;
  text-align: left;
}
.overtime-time-trigger:not(:disabled) { cursor: pointer; }
.overtime-time-trigger svg { flex: none; width: 17px; height: 17px; color: var(--overtime-picker-blue); }
.overtime-time-trigger:hover:not(:disabled), .overtime-time-trigger[aria-expanded="true"] { border-color: var(--overtime-picker-blue); }
.overtime-time .overtime-time-trigger:focus-visible {
  outline: 2px solid var(--overtime-picker-blue);
  outline-offset: -2px;
}
.overtime-time-options:focus-visible {
  outline: 1px solid var(--overtime-picker-blue);
  outline-offset: 2px;
}
.overtime-time-picker {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-block: 5px 3px;
  padding: 6px;
  border: 1px solid var(--we-border);
  border-radius: 10px;
  background: var(--we-surface);
}
.overtime-column-label { padding-bottom: 3px; text-align: center; color: var(--we-muted); font-size: var(--we-text-small); }
.overtime-time-options {
  position: relative;
  block-size: clamp(56px, calc(100dvh - 260px), 140px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--we-border) transparent;
  border-radius: 6px;
}
.overtime-time-options [role="option"] {
  min-block-size: 28px;
  padding: 3px 6px;
  border-radius: 5px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.overtime-time-options [role="option"]:hover { background: var(--we-subtle); }
.overtime-time-options [role="option"][aria-selected="true"] {
  color: var(--overtime-picker-blue);
  background: var(--overtime-picker-selected);
  font-weight: 600;
}
.overtime-time p { grid-column: 1 / -1; }
.overtime-error { color: var(--we-danger-text); overflow-wrap: anywhere; }
.overtime-actions { display: grid; grid-template-columns: 1fr 1.3fr; gap: 10px; }
.overtime-actions .we-button { border-radius: 999px; min-height: 34px; font-weight: 600; }
.overtime-actions .we-button:hover:not(:disabled) { filter: brightness(.96); }
@media (forced-colors: active) {
  .overtime-home, .overtime-moon { color: ButtonText; }
  .overtime-switch { border: 1px solid ButtonText; }
  .overtime-switch span { background: ButtonText; }
  .overtime-time-options [role="option"][aria-selected="true"] { forced-color-adjust: none; color: HighlightText; background: Highlight; }
}
</style>
