<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot } from '../../../shared/contracts'
import StatusBadge from '../components/StatusBadge.vue'
import MoyuIllustration from '../components/MoyuIllustration.vue'
import { countdownPresentation } from '../ui/presentation'
import { durationText, wallLabel, qualityText, affectedWarnings } from '../ui/dashboard-display'
import { progressRatio } from '../ui/fish-progress'

// Exploration only. Imported by the isolated preview entry, never by App.vue.
const props = defineProps<{ variant: 'a' | 'b' | 'c'; snapshot: DashboardSnapshot | null }>()
const target = computed(() => {
  const s = props.snapshot
  if (!s?.countdown) return null
  const wall = wallLabel(s.countdown.targetAt, s.timeZoneId)
  return wall ? { ...wall, label: s.countdown.target === 'workStart' ? '上班时间' : '下班时间' } : null
})
const countdown = computed(() => countdownPresentation(props.snapshot?.state ?? 'incomplete', durationText(props.snapshot?.countdown?.seconds), props.snapshot?.countdown?.target))
const parts = computed(() => countdown.value.text?.split(':') ?? [])
const ratio = computed(() => progressRatio(props.snapshot?.progress?.percent))
const percentage = computed(() => ratio.value === null ? '暂无进度' : `${Number((ratio.value * 100).toFixed(1))}%`)
const progressStyle = computed(() => ({ '--progress': `${(ratio.value ?? 0) * 100}%` }))
const notices = computed(() => {
  const s = props.snapshot
  if (!s) return ['暂时无法计算，请查看设置。']
  return [...new Set([
    s.countdown?.quality.approximate ? qualityText(s.countdown.quality) : '',
    s.progress?.quality.approximate ? qualityText(s.progress.quality) : '',
    affectedWarnings(s, 'countdown'), affectedWarnings(s, 'progress')
  ].filter(Boolean))]
})
const metrics = computed(() => {
  const s = props.snapshot
  return [
    { title: '下个休息日', value: s?.nextRest?.days ?? null, label: '休息日期',
      detail: s?.nextRest?.date ?? '暂无可用日期',
      warning: s ? [s.nextRest?.quality.approximate ? qualityText(s.nextRest.quality) : '', affectedWarnings(s, 'nextRest')].filter(Boolean).join('；') : '' },
    { title: '下次预计发薪', value: s?.salary?.days ?? null, label: '预计日期',
      detail: s?.salary?.actualDate ?? (s?.salaryAmbiguity ? '发薪周期存在歧义' : '暂无计划日期'),
      warning: s ? [s.salary?.quality.approximate ? qualityText(s.salary.quality) : '', affectedWarnings(s, 'salary')].filter(Boolean).join('；') : '' },
    { title: '已工作', value: s?.employment.elapsedNaturalDays ?? null, label: '自然日累计',
      detail: s?.employment.status === 'notStarted' ? '尚未入职' : s?.employment.status === 'unset' ? '尚未设置入职日期' : s ? `截至 ${s.localDate}` : '暂无可用结果', warning: '' }
  ]
})
</script>

<template>
  <section class="variants" :class="`variant-${variant}`" :data-variant="variant" aria-label="Dashboard 方案预览">
    <div class="journey">
      <section class="hero" aria-label="主倒计时">
        <div class="hero-heading">
          <h2>{{ countdown.heading }}</h2>
          <StatusBadge :state="snapshot?.state ?? 'incomplete'" />
        </div>
        <div v-if="countdown.text" class="clock" role="timer" :aria-label="countdown.text">
          <template v-for="(part, index) in parts" :key="index">
            <span v-if="index" class="separator" aria-hidden="true">:</span>
            <span class="clock-group" aria-hidden="true"><span class="digit">{{ part }}</span><span class="unit">{{ ['小时', '分钟', '秒'][index] }}</span></span>
          </template>
        </div>
        <p v-else class="clock-empty">{{ countdown.emptyLabel }}</p>
        <div class="hero-foot">
          <p v-if="target" class="target"><span>{{ target.label }}</span><strong>{{ target.time }}</strong><span class="target-date" :class="{ 'cross-day': target.date !== snapshot?.localDate }">{{ target.date }}</span></p>
          <p class="motto">摸鱼一小步，下班一大步</p>
        </div>
        <p v-for="notice in notices" :key="notice" class="notice">{{ notice }}</p>
      </section>

      <section class="progress-section" aria-label="今日工作进度" :style="progressStyle">
        <h2>今日工作进度</h2>
        <div v-if="ratio !== null" class="progress-scene" role="progressbar" aria-label="今日工作进度" :aria-valuenow="Number((ratio * 100).toFixed(1))" :aria-valuemin="0" :aria-valuemax="100">
          <div class="channel" aria-hidden="true">
            <div class="progress-fill">
              <svg v-if="variant === 'b'" class="waterline" viewBox="0 0 600 14" preserveAspectRatio="none"><path d="M0 6 Q75 -4 150 6 T300 6 T450 6 T600 6 V14 H0Z" /></svg>
            </div>
          </div>
          <div class="mascot-cursor" aria-hidden="true">
            <span v-if="variant === 'c'" class="cursor-readout">{{ percentage }}</span>
            <div class="cat"><MoyuIllustration :playing="false" /></div>
            <span v-if="variant === 'a'" class="frontier"></span>
          </div>
          <p v-if="variant !== 'c'" class="progress-readout" aria-hidden="true"><strong>{{ percentage }}</strong><span>已完成</span></p>
          <div v-if="variant === 'c'" class="rail-ticks" aria-hidden="true"><i v-for="tick in 9" :key="tick"></i></div>
          <div class="endpoints" aria-hidden="true"><span>上班</span><span>下班</span></div>
        </div>
        <p v-else class="progress-empty">无有效班次或暂不可计算，不代表 0%</p>
      </section>
    </div>

    <div class="metrics">
      <section v-for="metric in metrics" :key="metric.title" class="summary">
        <h2>{{ metric.title }}</h2>
        <div class="summary-body">
          <p class="summary-value"><strong>{{ metric.value ?? '—' }}</strong><span v-if="metric.value !== null">天</span></p>
          <div class="summary-detail"><span>{{ metric.label }}</span><p>{{ metric.detail }}</p></div>
        </div>
        <p v-if="metric.warning" class="notice">{{ metric.warning }}</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.variants { display:grid;gap:14px;container-type:inline-size; }
.journey { display:grid;gap:14px; }
.hero,.progress-section,.summary { min-width:0;border:1px solid var(--we-border);border-radius:16px;background:var(--we-surface); }
h2 { font-size:14px;font-weight:600;line-height:1.5; }
.hero { padding:18px 24px 16px; }
.hero-heading { display:flex;align-items:center;justify-content:space-between;gap:12px; }
.hero-heading h2 { color:var(--we-muted);font-weight:500; }
.clock { display:flex;align-items:flex-start;justify-content:center;gap:14px;margin:14px 0 20px;font-family:var(--we-font-numeric);font-variant-numeric:tabular-nums; }
.clock-group { display:grid;text-align:center; }
.digit { font-size:96px;line-height:1.06;letter-spacing:-.035em;font-weight:650; }
.unit { color:var(--we-muted);font-size:11px;margin-top:4px; }
.separator { font-size:64px;font-weight:300;line-height:1.4;color:var(--we-muted); }
.hero-foot { display:flex;justify-content:space-between;align-items:center;gap:12px; }
.target { display:flex;align-items:baseline;gap:8px;font-size:12px;color:var(--we-muted);flex-wrap:wrap; }
.target strong { font-size:16px;font-weight:600;color:var(--we-text);font-variant-numeric:tabular-nums; }
.motto { color:var(--we-muted);font-size:12px; }
.notice { color:var(--we-warning-text);font-size:12px;line-height:1.5;overflow-wrap:anywhere;margin-top:8px!important; }
.clock-empty { padding:32px 0;text-align:center;font-size:24px; }
.progress-section { padding:14px 20px 12px; }
.progress-scene { position:relative;height:108px;container-type:inline-size; }
.channel { position:absolute;left:0;right:0;top:53px;height:16px;border-radius:10px;background:var(--we-track);overflow:hidden; }
.progress-fill { width:var(--progress);height:100%;background:var(--we-accent); }
.mascot-cursor { position:absolute;left:clamp(0px,calc(var(--progress) - 36px),calc(100% - 72px));top:0;width:72px; }
.cat { width:72px;height:69px;position:relative;z-index:1; }
.cat :deep(canvas) { display:block;width:100%;height:100%;object-fit:contain; }
.frontier { position:absolute;left:32px;top:62px;width:8px;height:8px;border-radius:50%;background:var(--we-surface);outline:3px solid var(--we-accent); }
.progress-readout { position:absolute;left:50%;transform:translateX(-50%);top:79px;display:flex;align-items:baseline;gap:8px;white-space:nowrap; }
.progress-readout strong { font-family:var(--we-font-numeric);font-size:20px;font-weight:650;font-variant-numeric:tabular-nums; }
.progress-readout span { color:var(--we-muted);font-size:11px; }
.endpoints { position:absolute;top:83px;left:0;right:0;display:flex;justify-content:space-between;color:var(--we-muted);font-size:11px; }
.progress-empty { padding:24px 0;font-size:12px;color:var(--we-muted); }
.metrics { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px; }
.summary { padding:14px; }
.summary h2 { text-align:left;font-size:13px; }
.summary-body { display:grid;grid-template-columns:auto 1fr;align-items:center;gap:12px;margin-top:16px; }
.summary-value { display:flex;align-items:baseline;gap:4px;white-space:nowrap;font-family:var(--we-font-numeric); }
.summary-value strong { font-size:44px;line-height:1.15;font-weight:600;letter-spacing:-.03em;font-variant-numeric:tabular-nums; }
.summary-value > span { font-size:12px;color:var(--we-muted); }
.summary-detail { color:var(--we-muted);font-size:11px;text-align:right;line-height:1.6; }
.summary-detail > span { font-size:10px; }
.summary-detail p { color:var(--we-text);font-variant-numeric:tabular-nums;overflow-wrap:anywhere; }

/* A · 航线: open numerals, a precise frontier, values balanced against dates. */
.variant-a .clock-group:last-child .digit { font-weight:350;color:var(--we-muted); }
.variant-a .hero-foot { border-top:1px solid var(--we-border);padding-top:12px; }
.variant-a .target-date { display:none; }

/* B · 水槽: countdown and pond share a surface; the cat meets the water edge. */
.variant-b .journey { gap:0;border:1px solid var(--we-border);border-radius:16px;background:var(--we-surface);overflow:hidden; }
.variant-b .hero,.variant-b .progress-section { border:0;border-radius:0;background:transparent; }
.variant-b .hero { padding:16px 24px 12px; }
.variant-b .hero-heading { justify-content:center;position:relative; }
.variant-b .hero-heading :deep(.we-badge) { position:absolute;right:0; }
.variant-b .clock { gap:6px;margin:10px 0; }
.variant-b .digit { font-weight:400;font-size:96px; }
.variant-b .separator { font-size:72px;line-height:1.2;font-weight:300; }
.variant-b .clock .unit { display:none; }
.variant-b .hero-foot { justify-content:center;flex-direction:column;gap:8px; }
.variant-b .target-date { order:-1; }
.variant-b .target strong { font-size:14px; }
.variant-b .progress-section { padding:10px 24px 12px; }
.variant-b .progress-section h2 { font-size:12px;color:var(--we-muted);font-weight:500; }
.variant-b .progress-scene { height:114px;margin-top:14px; }
.variant-b .channel { top:39px;height:52px;border-radius:0 0 12px 12px;background:var(--we-subtle);border-bottom:1px solid var(--we-border); }
.variant-b .progress-fill { position:relative;background:color-mix(in srgb,var(--we-accent) 38%,var(--we-surface));top:6px;height:calc(100% - 6px);clip-path:inset(-12px 0 0); }
.waterline { position:absolute;top:-12px;left:0;width:100cqw;height:14px;fill:color-mix(in srgb,var(--we-accent) 38%,var(--we-surface)); }
.variant-b .mascot-cursor { top:-13px;left:clamp(0px,calc(var(--progress) - 42px),calc(100% - 84px));width:84px; }
.variant-b .cat { width:84px;height:81px; }
.variant-b .progress-readout { top:70px;gap:6px;z-index:2;line-height:1; }
.variant-b .progress-readout strong { color:var(--we-text);font-size:20px; }
.variant-b .progress-readout span { display:none; }
.variant-b .endpoints { top:98px; }
.variant-b .summary { padding:14px 16px 0;overflow:hidden; }
.variant-b .summary-body { display:flex;flex-direction:column;gap:14px;margin-top:12px; }
.variant-b .summary-value strong { font-size:48px; }
.variant-b .summary-detail { width:calc(100% + 32px);padding:9px 8px;background:var(--we-subtle);border-top:1px solid var(--we-border);text-align:center; }
.variant-b .summary-detail > span { display:none; }
.variant-b .summary:last-child .summary-detail > span { display:inline;margin-right:5px; }
.variant-b .summary:last-child .summary-detail p { display:inline;font-size:10px; }
.variant-b .summary > .notice { margin:8px 0!important; }

/* C · 桌面时钟: tactile clock cells, a cat/readout slider, right aligned totals. */
.variant-c .hero { padding:18px 20px 16px; }
.variant-c .hero-heading { padding:0 4px; }
.variant-c .clock { gap:10px;margin:16px 0 14px; }
.variant-c .clock-group { flex:1;max-width:176px;padding:8px 12px 10px;background:var(--we-subtle);border-radius:12px;border:1px solid var(--we-border); }
.variant-c .digit { font-size:84px;line-height:1.05;font-weight:600; }
.variant-c .unit { margin-top:0; }
.variant-c .separator { display:none; }
.variant-c .hero-foot { padding:0 4px; }
.variant-c .target-date { display:none; }
.variant-a .target-date.cross-day,.variant-c .target-date.cross-day { display:inline; }
.variant-c .target strong { font-size:14px; }
.variant-c .progress-section { padding:14px 20px 10px; }
.variant-c .progress-scene { height:100px; }
.variant-c .channel { top:24px;height:48px;border-radius:12px;background:var(--we-subtle);border:1px solid var(--we-border); }
.variant-c .progress-fill { background:var(--we-accent-soft);border-right:2px solid var(--we-accent); }
.variant-c .mascot-cursor { top:5px;left:clamp(0px,calc(var(--progress) - 94px),calc(100% - 124px));width:124px;display:flex;align-items:center;gap:2px;z-index:2; }
.variant-c .cat { flex:none;width:60px;height:58px; }
.cursor-readout { flex:1;min-width:0;text-align:center;font-size:15px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--we-text);padding:3px 5px;background:var(--we-surface);border:1px solid var(--we-border);border-radius:6px; }
.rail-ticks { position:absolute;top:65px;left:20px;right:20px;display:flex;justify-content:space-between; }
.rail-ticks i { height:6px;width:1px;background:var(--we-control-border); }
.variant-c .endpoints { top:81px; }
.variant-c .summary-body { grid-template-columns:1fr auto;gap:8px;margin-top:12px; }
.variant-c .summary-value { grid-column:2;grid-row:1;align-items:baseline; }
.variant-c .summary-value strong { font-size:46px; }
.variant-c .summary-detail { grid-column:1;grid-row:1;text-align:left; }
.variant-c .summary-detail p { max-width:90px; }

@container (max-width:560px) {
  .digit,.variant-b .digit { font-size:72px; }
  .clock { gap:8px; }
  .separator { font-size:50px; }
  .variant-b .separator { font-size:56px; }
  .hero { padding:16px; }
  .motto { font-size:11px; }
  .summary { padding:12px; }
  .summary-body { display:flex;flex-direction:column;gap:6px;margin-top:10px; }
  .summary-value strong,.variant-c .summary-value strong { font-size:38px; }
  .summary-detail { text-align:center; }
  .variant-c .clock-group { padding:10px 4px; }
  .variant-c .digit { font-size:64px; }
  .variant-c .summary-body { display:flex;align-items:flex-end; }
  .variant-c .summary-detail { text-align:right; }
  .variant-c .summary-detail p { max-width:none; }
  .variant-b .summary { padding:12px 12px 0; }
  .variant-b .summary-detail { width:calc(100% + 24px); }
  .variant-b .summary:last-child .summary-detail > span { display:block; }
}
@container (max-width:420px) {
  .hero-foot { flex-direction:column;gap:8px; }
  .digit,.variant-b .digit { font-size:52px; }
  .separator,.variant-b .separator { font-size:40px; }
  .variant-c .digit { font-size:46px; }
  .variant-b .hero-heading { justify-content:space-between; }
  .variant-b .hero-heading :deep(.we-badge) { position:static; }
  .metrics { grid-template-columns:1fr; }
  .summary-body,.variant-b .summary-body,.variant-c .summary-body { flex-direction:row;justify-content:space-between;align-items:center; }
  .variant-b .summary { padding:12px; }
  .variant-b .summary-detail { width:auto;background:none;border:0;padding:0;text-align:right; }
  .variant-b .summary:last-child .summary-detail > span { display:block; }
}
</style>
