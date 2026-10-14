<script setup lang="ts">
import { computed, ref } from 'vue'
import CountdownCard from '../components/CountdownCard.vue'
import MetricCard from '../components/MetricCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { useTheme } from '../composables/useTheme'
import type { Appearance } from '../ui/appearance'
import type { BusinessState } from '../../../shared/contracts'
import OriginalStill from './OriginalStill.vue'

const host = ref<HTMLElement | null>(null)
const preferences = ref<Appearance>({ mode: 'system', accent: 'ocean', reduceMotion: false })
useTheme(host, preferences)
const themes = [
  { theme: 'light', accent: 'ocean', label: '海蓝 · 亮色' },
  { theme: 'dark', accent: 'ocean', label: '海蓝 · 深色' },
  { theme: 'light', accent: 'coral', label: '珊瑚 · 亮色' },
  { theme: 'dark', accent: 'coral', label: '珊瑚 · 深色' }
] as const
const states: { state: BusinessState; text: string | null; hint?: string; estimate?: string; warning?: string }[] = [
  { state: 'beforeWork', text: '00:30:00', hint: '上班前等待 · 进度 0%' },
  { state: 'working', text: '03:28:17', hint: '有效工作进度 62% · 固定示例' },
  { state: 'break', text: '05:30:00', hint: '午休 12:00–13:00 · 进度暂停，仍计至最终下班' },
  { state: 'overtime', text: '00:45:00', hint: '班次归属 2026-10-14 · 最终结束 2026-10-15 00:30' },
  { state: 'finished', text: null }, { state: 'rest', text: null },
  { state: 'incomplete', text: null, warning: '缺少有效排班 · 无工作进度' },
  { state: 'working', text: '03:28:17', estimate: '2027 年度数据不完整 · 按每周规则估算' }
]
const target = computed(() => ({ kind: 'finalWorkEnd' as const, date: '2026-10-14', time: '18:00' }))
</script>

<template>
  <main class="preview-page">
    <header class="preview-intro"><h1>D10 · 视觉基础与组件</h1><p>隔离预览，全部为固定输入。无业务时钟、设置保存或窗口操作；海蓝为默认，珊瑚为可选。</p></header>
    <div id="outside-scope">作用域外样例：主题切换不影响这段文字。</div>
    <section ref="host" class="workday-ui preview-live" data-testid="live-theme">
      <div class="preview-controls">
        <label>显示模式 <select v-model="preferences.mode" class="we-control"><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">深色</option></select></label>
        <label>配色 <select v-model="preferences.accent" class="we-control"><option value="ocean">海蓝</option><option value="coral">珊瑚</option></select></label>
        <label class="we-check"><input v-model="preferences.reduceMotion" type="checkbox" /> 减少动画</label>
      </div>
      <CountdownCard state="working" text="03:28:17" :target="target" hint="摸一会鱼，下班就更近啦！">
        <template #illustration><OriginalStill /></template>
      </CountdownCard>
    </section>

    <section class="preview-gallery" aria-label="四种主题组件对照">
      <article v-for="theme in themes" :key="theme.label" class="workday-ui preview-theme" :data-theme="theme.theme" :data-accent="theme.accent" data-reduced-motion="true">
        <h2>{{ theme.label }}</h2>
        <div class="preview-window" data-testid="main-wide">
          <div class="preview-window-heading">Workday Escape <span class="we-muted">2026-10-14 · 静态组件示例</span></div>
          <div class="preview-window-scroll">
            <CountdownCard state="working" text="03:28:17" :target="target" hint="摸一会鱼，下班就更近啦！">
              <template #illustration><OriginalStill /></template>
            </CountdownCard>
            <div class="preview-metrics">
              <MetricCard title="今日工作进度" :value="62" unit="%" description="按有效工作时长，排除午休" />
              <MetricCard title="下个休息日" :value="3" unit="天" description="2026-10-17" source="每周工作规则" />
              <MetricCard title="下次计划发薪" :value="18" unit="天" kind="salary" description="2026-11-01 · 固定示例" />
              <MetricCard title="在职自然日" :value="820" unit="天" description="不含今天；入职当天为 0" />
              <MetricCard title="累计计划工作日" :value="583" unit="天" source="按当前工作周回算历史" estimated description="估算，不代表实际出勤" />
              <MetricCard title="暂无可用进度" :value="null" empty-label="无活动班次 · 无工作进度" />
            </div>
          </div>
        </div>
        <div class="preview-mini" data-testid="mini-default">
          <CountdownCard compact state="working" text="03:28:17" hint="进度 62% · 迷你静态样例">
            <template #illustration><OriginalStill /></template>
            <template #actions><button type="button" class="we-button preview-return" disabled title="静态示例，不执行窗口操作">返回主窗口</button></template>
          </CountdownCard>
        </div>
      </article>
    </section>

    <section class="workday-ui preview-states" data-theme="light" data-accent="ocean" data-reduced-motion="true" aria-label="固定状态和边界">
      <h2>状态与缺失数据</h2>
      <div class="preview-state-grid">
        <CountdownCard v-for="(sample, i) in states" :key="i" v-bind="sample" :target="sample.state === 'beforeWork' ? { kind: 'workStart', time: '09:00' } : sample.state === 'overtime' ? { kind: 'finalWorkEnd', date: '2026-10-15', time: '00:30' } : target" />
        <MetricCard title="发薪周期需确认" :value="null" kind="salary" empty-label="暂无唯一计划日期" warning="多个周期重合，等待用户明确选择" />
        <MetricCard title="有效零值" :value="0" unit="天" />
        <CountdownCard state="incomplete" text="not-a-time" warning="非法显示值不伪装为 00:00:00" />
      </div>
      <h2>窄窗 480×560 · 内容可滚动</h2>
      <div class="preview-window preview-window--narrow" data-testid="main-narrow">
        <div class="preview-window-heading">Workday Escape · 窄窗静态样例</div>
        <div class="preview-window-scroll">
          <CountdownCard state="break" text="05:30:00" :target="target" hint="午休不计工作进度，倒计时包含午休墙上时长">
            <template #illustration><OriginalStill /></template>
          </CountdownCard>
          <div class="preview-metrics">
            <MetricCard title="长数字压力示例（非有效班次）" value="123456789" unit="天" />
            <MetricCard title="工作进度" :value="null" empty-label="无活动班次 · 无工作进度" />
            <MetricCard title="估算休息日" :value="2" unit="天" source="2027 年度数据不完整" estimated />
            <MetricCard title="在职自然日" :value="0" unit="天" description="入职当天" />
          </div>
          <button class="we-button" type="button" disabled>末尾操作样例（预览不执行）</button>
        </div>
      </div>
      <h2>迷你最小尺寸 240×112 · 长数字仅为排版压力</h2>
      <div class="preview-mini preview-mini--small" data-testid="mini-small">
        <CountdownCard compact state="working" text="100:00:00" hint="非有效班次 · 仅压力示例">
          <template #illustration><OriginalStill /></template>
          <template #actions><button type="button" class="we-button preview-return" disabled title="静态示例，不执行窗口操作">返回主窗口</button></template>
        </CountdownCard>
      </div>
      <div class="preview-badges"><StatusBadge v-for="sample in states" :key="sample.state + (sample.estimate || '')" :state="sample.estimate ? 'estimate' : sample.state" /></div>
    </section>
  </main>
</template>

<style scoped>
.preview-page { padding: 24px; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.preview-intro { max-width: 820px; margin-bottom: 16px; }
.preview-intro h1 { margin: 0 0 8px; font-size: 24px; }
#outside-scope { margin-bottom: 16px; }
.preview-live, .preview-states { padding: var(--we-space-5); border-radius: var(--we-radius-card); }
.preview-live { max-width: 720px; margin-bottom: 24px; }
.preview-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--we-space-4); margin-bottom: var(--we-space-4); }
.preview-controls label { display: flex; align-items: center; gap: var(--we-space-2); }
.preview-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 760px), 1fr)); gap: 24px; }
.preview-theme { min-width: 0; padding: var(--we-space-5); border-radius: var(--we-radius-card); }
.preview-theme > h2, .preview-states > h2 { font-size: var(--we-text-title); margin-bottom: var(--we-space-4); }
.preview-window { width: min(100%, 720px); height: 780px; display: flex; flex-direction: column; border: 1px solid var(--we-border); border-radius: var(--we-radius-card); overflow: hidden; container-type: inline-size; }
.preview-window-heading { flex: none; display: flex; flex-wrap: wrap; gap: var(--we-space-2); padding: var(--we-space-3) var(--we-space-4); font-weight: 600; }
.preview-window-scroll { min-height: 0; overflow: auto; padding: var(--we-space-4); display: flex; flex-direction: column; gap: var(--we-space-4); }
.preview-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--we-space-3); }
.preview-mini { width: 280px; height: 132px; overflow: auto; margin-top: var(--we-space-4); }
.preview-mini--small { width: 240px; height: 112px; margin-bottom: var(--we-space-5); }
.preview-return { font-size: var(--we-text-small); }
.preview-window--narrow { width: min(100%, 480px); height: 560px; margin-bottom: var(--we-space-5); }
.preview-states { margin-top: 24px; }
.preview-state-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: var(--we-space-3); margin-bottom: var(--we-space-5); }
.preview-badges { display: flex; flex-wrap: wrap; gap: var(--we-space-2); }
@container (max-width: 639px) { .preview-metrics { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) { .preview-page { padding: 8px; } .preview-theme, .preview-states { padding: var(--we-space-2); } }
</style>
