<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot } from '../../../shared/contracts'
import CountdownCard from '../components/CountdownCard.vue'
import MetricCard from '../components/MetricCard.vue'
import FishProgress from '../components/FishProgress.vue'
import reef from '../assets/dashboard/reef.svg'
import { fishCanAnimate } from '../ui/fish-progress'
import { durationText, wallLabel, qualityText, affectedWarnings } from '../ui/dashboard-display'
const props=withDefaults(defineProps<{snapshot:DashboardSnapshot|null;motionAllowed?:boolean}>(),{motionAllowed:false})
const animated=computed(()=>fishCanAnimate(props.snapshot?.state,props.snapshot?.progress?.percent,props.motionAllowed))
const target=computed(()=>{const s=props.snapshot;if(!s?.countdown)return null;const wall=wallLabel(s.countdown.targetAt,s.timeZoneId);return wall?{kind:s.countdown.target,...wall}:null})
const salaryDescription=computed(()=>{const salary=props.snapshot?.salary;if(!salary)return '';return `${salary.days===0?'今天计划发薪 · ':''}${salary.actualDate}`})
const salaryWarning=computed(()=>{const s=props.snapshot;if(!s)return '';return [s.salaryAmbiguity?'多个名义周期重合，未选择唯一归属；请检查发薪策略与日历':'',affectedWarnings(s,'salary')].filter(Boolean).join('；')})
const estimate=computed(()=>props.snapshot?.countdown?.quality.approximate?qualityText(props.snapshot.countdown.quality):'')
</script>
<template>
  <section class="dashboard" aria-label="工作日仪表盘">
    <div class="we-surface dashboard-primary">
      <div class="dashboard-atmosphere" aria-hidden="true"><img :src="reef" alt="" /></div>
      <CountdownCard hero :state="snapshot?.state || 'incomplete'" :text="durationText(snapshot?.countdown?.seconds)" :target="target" :estimate="estimate" :warning="snapshot ? affectedWarnings(snapshot,'countdown') : '暂时无法计算，请查看设置。'" hint="摸鱼一小步，下班一大步" />
      <section class="dashboard-progress" aria-label="今日工作进度">
        <FishProgress :percent="snapshot?.progress?.percent??null" :animate="animated" />
        <p v-if="!snapshot?.progress" class="we-muted">无有效班次或暂不可计算，不代表 0%</p>
        <p v-if="snapshot?.progress?.quality.approximate" class="dashboard-warning">{{ qualityText(snapshot.progress.quality) }}</p>
        <p v-if="snapshot && affectedWarnings(snapshot,'progress')" class="dashboard-warning">{{ affectedWarnings(snapshot,'progress') }}</p>
      </section>
    </div>
    <div class="dashboard-metrics">
      <MetricCard title="下个休息日" tone="rest" :value="snapshot?.nextRest?.days??null" unit="天" :description="snapshot?.nextRest ? (snapshot.nextRest.days===0?'今天休息 · ':'')+snapshot.nextRest.date : '未来查询范围内暂无可用结果'" :source="snapshot?.nextRest?.quality.approximate?qualityText(snapshot.nextRest.quality):''" :estimated="snapshot?.nextRest?.quality.approximate" :warning="snapshot ? affectedWarnings(snapshot,'nextRest'):''" />
      <MetricCard title="下次预计发薪" tone="salary" :value="snapshot?.salary?.days??null" unit="天" :empty-label="snapshot?.salaryAmbiguity?'发薪周期存在歧义':'暂无计划日期'" :description="salaryDescription" :source="snapshot?.salary?.quality.approximate?qualityText(snapshot.salary.quality):''" :estimated="snapshot?.salary?.quality.approximate" :warning="salaryWarning" />
      <MetricCard title="已工作" tone="employment" :value="snapshot?.employment.elapsedNaturalDays??null" unit="天" :description="snapshot?.employment.status==='notStarted'?'尚未入职':snapshot?.employment.status==='unset'?'尚未设置入职日期':''" />
    </div>
  </section>
</template>
<style scoped>
.dashboard { display:grid;gap:var(--we-space-3);container-type:inline-size; }
.dashboard .dashboard-primary { position:relative;isolation:isolate;min-width:0;background:radial-gradient(ellipse at 50% 25%,var(--we-surface) 15%,transparent 78%),linear-gradient(180deg,color-mix(in srgb,var(--we-water-top,var(--we-accent-soft)) 32%,var(--we-surface)),color-mix(in srgb,var(--we-water-top,var(--we-accent-soft)) 22%,var(--we-surface)));border-color:var(--we-card-border,var(--we-border)); }
.dashboard-atmosphere { position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:-1;background:radial-gradient(ellipse at 0 58%,color-mix(in srgb,var(--we-water-top,var(--we-accent)) 40%,transparent),transparent 45%),radial-gradient(ellipse at 100% 58%,color-mix(in srgb,var(--we-water-top,var(--we-accent)) 40%,transparent),transparent 45%); }
.dashboard-atmosphere img { position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:fill;opacity:.8; }
.dashboard-progress { position:relative;padding:8px var(--we-space-6); }
.dashboard-metrics { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch;gap:var(--we-space-3); }
.dashboard-warning { font-size:var(--we-text-small);color:var(--we-warning-text);overflow-wrap:anywhere; }
@media (max-width:520px) { .dashboard-metrics { gap:8px; }.dashboard-progress { padding-inline:16px; } }
[data-theme="dark"] .dashboard-atmosphere img { opacity:.22; }
@media (forced-colors:active) { .dashboard .dashboard-primary { background:Canvas;border-color:CanvasText; }.dashboard-atmosphere { display:none; } }
</style>
