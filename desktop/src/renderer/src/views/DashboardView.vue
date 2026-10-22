<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot } from '../../../shared/contracts'
import CountdownCard from '../components/CountdownCard.vue'
import MetricCard from '../components/MetricCard.vue'
import FishProgress from '../components/FishProgress.vue'
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
      <CountdownCard hero :state="snapshot?.state || 'incomplete'" :text="durationText(snapshot?.countdown?.seconds)" :target="target" :estimate="estimate" :warning="snapshot ? affectedWarnings(snapshot,'countdown') : '暂时无法计算，请查看设置。'" hint="摸鱼一小步，下班一大步" />
      <section class="dashboard-progress" aria-label="今日工作进度">
        <FishProgress :percent="snapshot?.progress?.percent??null" :animate="animated" />
        <p v-if="!snapshot?.progress" class="we-muted">无有效班次或暂不可计算，不代表 0%</p>
        <p v-if="snapshot?.progress?.quality.approximate" class="dashboard-warning">{{ qualityText(snapshot.progress.quality) }}</p>
        <p v-if="snapshot && affectedWarnings(snapshot,'progress')" class="dashboard-warning">{{ affectedWarnings(snapshot,'progress') }}</p>
        <p v-if="snapshot?.activeShift && (snapshot.activeShift.overtimeMinutes>0 || snapshot.activeShift.shiftDate!==snapshot.localDate)" class="we-muted">班次 {{ snapshot.activeShift.shiftDate }} · 加班 {{ snapshot.activeShift.overtimeMinutes }} 分钟</p>
      </section>
    </div>
    <div class="dashboard-metrics">
      <MetricCard title="下个休息日" description-label="休息日期" :value="snapshot?.nextRest?.days??null" unit="天" :description="snapshot?.nextRest ? (snapshot.nextRest.days===0?'今天休息 · ':'')+snapshot.nextRest.date : '未来查询范围内暂无可用结果'" :source="snapshot?.nextRest?.quality.approximate?qualityText(snapshot.nextRest.quality):''" :estimated="snapshot?.nextRest?.quality.approximate" :warning="snapshot ? affectedWarnings(snapshot,'nextRest'):''" />
      <MetricCard title="下次预计发薪" description-label="预计日期" :value="snapshot?.salary?.days??null" unit="天" :empty-label="snapshot?.salaryAmbiguity?'发薪周期存在歧义':'暂无计划日期'" :description="salaryDescription" :source="snapshot?.salary?.quality.approximate?qualityText(snapshot.salary.quality):''" :estimated="snapshot?.salary?.quality.approximate" :warning="salaryWarning" />
      <MetricCard title="已工作" accessible-description="按自然日统计，不含今天，入职当天为 0；不代表实际出勤天数。" :value="snapshot?.employment.elapsedNaturalDays??null" unit="天" :description="snapshot?.employment.status==='notStarted'?'尚未入职':snapshot?.employment.status==='unset'?'尚未设置入职日期':''" />
    </div>
  </section>
</template>
<style scoped>
.dashboard { display:grid;gap:var(--we-space-3);container-type:inline-size; }
.dashboard-primary.we-surface { min-width:0;border-color:transparent;background:linear-gradient(145deg,var(--we-surface) 35%,var(--we-subtle)); }
.dashboard-progress { padding:0 var(--we-space-6) var(--we-space-3); }
.dashboard-metrics { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:var(--we-space-3); }
.dashboard-warning { font-size:var(--we-text-small);color:var(--we-warning-text);overflow-wrap:anywhere; }
@media (max-width:439px) { .dashboard-metrics { grid-template-columns:minmax(0,1fr); } }
@media (forced-colors:active) { .dashboard-primary.we-surface { border-color:CanvasText;background:Canvas;box-shadow:none; } }
</style>
