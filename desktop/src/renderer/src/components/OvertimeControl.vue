<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import type { ContractError, DashboardSnapshot, Result } from '../../../shared/contracts'
import type { OvertimeEdit, OvertimeTarget } from '../ui/settings-controller'

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
const timeInput = ref<HTMLInputElement | null>(null)
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
const title = computed(() => mode.value === 'cancel' ? '取消加班？' : mode.value === 'check' ? '核对加班保存状态' : '加班设置')

function showError(value: ContractError) {
  validationError.value = value.code === 'VALIDATION'
  if (value.code === 'VALIDATION') error.value = value.issues.find(item => item.field === '$.expectedEndTime')?.message ?? value.message
  else if (value.code === 'REVISION_CONFLICT') error.value = `配置修订冲突（${value.expectedRevision} → ${value.actualRevision}）。请重新打开弹窗，或重启应用读取最新配置。`
  else error.value = value.message
}

function close() {
  if (saving.value || !dialog.value?.open) return
  dialog.value.close()
  emit('dialog-change', false)
  void nextTick(restoreFocus)
}

function restoreFocus() {
  const control = origin?.isConnected && !origin.disabled ? origin : toggle.value
  control?.focus()
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
    time.value = checked.value ? result.data.context.finalEnd.time : ''
  } finally {
    loading.value = false
    await nextTick()
    if (dialog.value?.open && mode.value === 'edit' && target.value) timeInput.value?.focus()
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
  error.value = ''
  validationError.value = false
  if (input === context.normalEnd.time) {
    error.value = '该时间与正常下班时间相同。请选择加班结束时间。'
    validationError.value = true
    timeInput.value?.focus()
    return
  }
  saving.value = true
  const result = await props.save({ targetKey: context.targetKey, expectedRevision: target.value.revision, input })
  saving.value = false
  if (result.ok) { close(); return }
  showError(result.error)
  await nextTick()
  if (validationError.value) timeInput.value?.focus()
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

  <dialog ref="dialog" class="overtime-dialog" :aria-labelledby="`${id}-title`" :aria-describedby="mode === 'cancel' ? `${id}-prompt` : undefined"
    @cancel.prevent="close">
    <form class="overtime-form" @submit.prevent="submit">
      <header class="overtime-header">
        <h2 :id="`${id}-title`">{{ title }}</h2>
        <button type="button" class="overtime-close" aria-label="关闭" :disabled="saving" @click="close">
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <p v-if="mode === 'cancel'" :id="`${id}-prompt`">确定取消今天的加班吗？取消后将恢复正常下班时间。</p>
      <div v-if="mode === 'edit' && target" class="overtime-time">
        <label :for="`${id}-time`">加班到</label>
        <input :id="`${id}-time`" ref="timeInput" v-model="time" type="time" class="we-control" step="60" required
          :disabled="saving || stale || recovering" :aria-invalid="validationError || undefined"
          :aria-describedby="`${id}-hint${validationError ? ` ${id}-error` : ''}`" @input="error = ''; validationError = false" />
        <p :id="`${id}-hint`" class="we-muted">正常下班 {{ target.context.normalEnd.time }}，较早时刻按次日解释。</p>
      </div>
      <p v-if="loading" class="we-muted" role="status">正在读取当前班次…</p>
      <p v-if="stale && !saving && !error" class="overtime-error" role="status">当前班次或配置已变化，请重新打开弹窗。</p>
      <p v-if="error" :id="`${id}-error`" class="overtime-error" role="alert">{{ error }}</p>
      <div class="overtime-actions">
        <button ref="dismiss" type="button" class="we-button" :disabled="saving" @click="close">{{ mode === 'cancel' ? '继续加班' : '取消' }}</button>
        <button v-if="(recovering && !saving) || mode === 'check'" type="button" class="we-button we-button--primary" :disabled="loading || saving" @click="checkAgain">重试核对</button>
        <button v-else-if="!target && !loading && error" type="button" class="we-button we-button--primary" @click="loadTarget">重新读取</button>
        <button v-else ref="confirm" type="submit" class="we-button we-button--primary" :disabled="!target || stale || loading || saving">
          {{ saving ? '正在保存…' : mode === 'cancel' ? '确认取消' : '确认加班' }}
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
  gap: 5px;
  padding: 4px 7px;
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
.overtime-icon { width: 30px; height: 30px; }
.overtime-icon svg { width: 23px; height: 23px; }
.overtime-home { color: #1470e5; }
.overtime-home path { fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linejoin: round; }
.overtime-moon { color: #ffbf24; }
.overtime-moon path { fill: currentColor; }
.overtime-moon:hover:not(:disabled), .overtime-close:hover:not(:disabled) { background: var(--we-accent-soft); }
.overtime-switch {
  --knob-travel: 17px;
  width: 43px;
  height: 26px;
  justify-items: start;
  padding-inline: 3px;
  background: #77889e;
  transition: background-color 150ms ease;
}
.overtime-switch[aria-checked="true"] { background: #0875ed; }
.overtime-switch span {
  width: 20px;
  height: 20px;
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
  inset-block: auto 14px;
  width: min(368px, calc(100% - 32px));
  max-height: calc(100% - 32px);
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  align-items: center;
  border-radius: 12px;
  background: var(--we-accent-soft);
  padding: 7px 10px;
}
.overtime-time label { font-weight: 600; }
.overtime-time input { width: 100%; min-width: 0; font-variant-numeric: tabular-nums; }
.overtime-time p { grid-column: 1 / -1; }
.overtime-error { color: var(--we-danger-text); overflow-wrap: anywhere; }
.overtime-actions { display: grid; grid-template-columns: 1fr 1.3fr; gap: 10px; }
.overtime-actions .we-button { border-radius: 999px; min-height: 34px; font-weight: 600; }
.overtime-actions .we-button:hover:not(:disabled) { filter: brightness(.96); }
@container (max-width: 440px) {
  .overtime-pill { gap: 3px; padding: 2px 5px; }
  .overtime-icon { width: 25px; height: 28px; }
  .overtime-icon svg { width: 20px; height: 20px; }
  .overtime-switch { --knob-travel: 13px; width: 37px; height: 24px; }
  .overtime-switch span { width: 18px; height: 18px; }
}
@media (forced-colors: active) {
  .overtime-home, .overtime-moon { color: ButtonText; }
  .overtime-switch { border: 1px solid ButtonText; }
  .overtime-switch span { background: ButtonText; }
}
</style>
