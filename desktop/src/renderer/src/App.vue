<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { DEFAULT_SETTINGS, validateSettings } from '../../shared/settings'
import { getCountdown } from '../../shared/countdown'

const settings = ref({ ...DEFAULT_SETTINGS })
const workStartTime = ref(settings.value.workStartTime)
const workEndTime = ref(settings.value.workEndTime)
const now = ref(new Date())
const busy = ref(true)
const message = ref('')
const hasError = ref(false)
const countdown = computed(() => getCountdown(now.value, settings.value))
let timer: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  timer = setInterval(() => { now.value = new Date() }, 1000)
  try {
    const result = await window.workday.loadSettings()
    settings.value = result.settings
    workStartTime.value = result.settings.workStartTime
    workEndTime.value = result.settings.workEndTime
    message.value = result.warning || ''
    hasError.value = !!result.warning
  } catch {
    message.value = '无法读取配置，请重新打开应用。'
    hasError.value = true
  } finally { busy.value = false }
})

onUnmounted(() => clearInterval(timer))

async function save(): Promise<void> {
  busy.value = true
  message.value = ''
  try {
    const value = validateSettings({ workStartTime: workStartTime.value, workEndTime: workEndTime.value })
    settings.value = await window.workday.saveSettings(value).catch(() => {
      throw new Error('无法保存时间，请检查用户数据目录的写入权限后重试。')
    })
    now.value = new Date()
    message.value = '时间已保存。'
    hasError.value = false
  } catch (error) {
    message.value = error instanceof Error ? error.message : '保存失败，请重试。'
    hasError.value = true
  } finally { busy.value = false }
}

async function quit(): Promise<void> {
  try { await window.workday.quit() }
  catch { message.value = '退出失败，请使用窗口关闭按钮。'; hasError.value = true }
}
</script>

<template>
  <main>
    <header>
      <p class="version">V2.0 · 阶段 1 技术演示</p>
      <h1>Workday Escape</h1>
    </header>
    <section class="countdown" aria-labelledby="countdown-label">
      <p id="countdown-label" data-testid="status">{{ countdown.status }}</p>
      <output role="timer" aria-label="下班倒计时" data-testid="countdown">{{ countdown.text }}</output>
      <p>今日 {{ settings.workStartTime }} — {{ settings.workEndTime }}</p>
    </section>
    <form @submit.prevent="save">
      <div class="times">
        <label>上班时间<input v-model="workStartTime" type="time" required :disabled="busy" /></label>
        <label>下班时间<input v-model="workEndTime" type="time" required :disabled="busy" /></label>
      </div>
      <p class="hint">使用电脑本地时间，仅支持同日班次。</p>
      <p class="message" :class="{ error: hasError }" role="status">{{ message }}</p>
      <div class="actions">
        <button type="submit" :disabled="busy">{{ busy ? '处理中…' : '保存时间' }}</button>
        <button class="secondary" type="button" @click="quit">退出</button>
      </div>
    </form>
  </main>
</template>
