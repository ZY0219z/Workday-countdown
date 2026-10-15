<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardSnapshot } from '../../../shared/contracts'
import CountdownCard from '../components/CountdownCard.vue'
import MetricCard from '../components/MetricCard.vue'
import MoyuStill from '../components/MoyuStill.vue'
import { durationText, wallLabel, qualityText, affectedWarnings } from '../ui/dashboard-display'
const props=defineProps<{snapshot:DashboardSnapshot|null}>()
const target=computed(()=>{const s=props.snapshot;if(!s?.countdown)return null;const wall=wallLabel(s.countdown.targetAt,s.timeZoneId);return wall?{kind:s.countdown.target,...wall}:null})
const percentage=computed(()=>props.snapshot?.progress?.percent.toFixed(1).replace(/\.0$/,'')??null)
const estimate=computed(()=>props.snapshot?.countdown?.quality.approximate?qualityText(props.snapshot.countdown.quality):'')
</script>
<template>
  <section class="dashboard" aria-label="工作日仪表盘">
    <p v-if="snapshot" class="we-muted dashboard-date">{{ snapshot.localDate }} · {{ snapshot.timeZoneId }}</p>
    <CountdownCard :state="snapshot?.state || 'incomplete'" :text="durationText(snapshot?.countdown?.seconds)" :target="target" :estimate="estimate" :warning="snapshot ? affectedWarnings(snapshot,'countdown') : '请先完成设置；没有生成虚假的倒计时。'" hint="摸一会鱼，下班就更近啦！">
      <template #illustration><MoyuStill /></template>
    </CountdownCard>
    <section class="we-surface dashboard-progress" aria-label="今日工作进度">
      <div class="dashboard-progress-heading"><h2>今日工作进度</h2><strong>{{ percentage===null?'无工作进度':percentage+'%' }}</strong></div>
      <progress v-if="snapshot?.progress" :value="snapshot.progress.percent" max="100" aria-label="有效工作进度"></progress>
      <p class="we-muted">{{ snapshot?.progress?'按有效工作时长，排除午休，包含已确认加班':'无有效班次或暂不可计算，不代表 0%' }}</p>
      <p v-if="snapshot?.progress" class="we-muted">{{ qualityText(snapshot.progress.quality) }}</p>
      <p v-if="snapshot && affectedWarnings(snapshot,'progress')" class="dashboard-warning">{{ affectedWarnings(snapshot,'progress') }}</p>
      <p v-if="snapshot?.activeShift" class="we-muted">班次归属 {{ snapshot.activeShift.shiftDate }} · 加班 {{ snapshot.activeShift.overtimeMinutes }} 分钟</p>
    </section>
    <div class="dashboard-metrics">
      <MetricCard title="下个休息日" :value="snapshot?.nextRest?.days??null" unit="天" :description="snapshot?.nextRest ? (snapshot.nextRest.days===0?'今天休息 · ':'')+snapshot.nextRest.date : '未来查询范围内暂无可用结果'" :source="qualityText(snapshot?.nextRest?.quality)" :estimated="snapshot?.nextRest?.quality.approximate" :warning="snapshot ? affectedWarnings(snapshot,'nextRest'):''" />
      <MetricCard title="下次计划发薪" :value="snapshot?.salary?.days??null" unit="天" kind="salary" :empty-label="snapshot?.salaryAmbiguity?'发薪周期存在歧义':'暂无计划日期'" :description="snapshot?.salary ? `${snapshot.salary.days===0?'今天计划发薪 · ':''}${snapshot.salary.actualDate}（名义 ${snapshot.salary.nominalDate}）` : ''" :source="qualityText(snapshot?.salary?.quality)" :estimated="snapshot?.salary?.quality.approximate" :warning="snapshot?.salaryAmbiguity?'多个名义周期重合，未选择唯一归属；请检查发薪策略与日历':snapshot?affectedWarnings(snapshot,'salary'):''" />
      <MetricCard title="在职自然日" :value="snapshot?.employment.elapsedNaturalDays??null" unit="天" :description="snapshot?.employment.status==='notStarted'?'尚未入职 · 不显示负数':snapshot?.employment.status==='unset'?'尚未设置入职日期':'不包含今天；入职当天为 0'" :source="qualityText(snapshot?.employment.naturalQuality)" />
      <MetricCard title="累计计划工作日" :value="snapshot?.employment.plannedWorkDays??null" unit="天" description="不包含今天；按当前工作制推算，非实际出勤" :source="qualityText(snapshot?.employment.quality)||'按当前工作制推算'" estimated :warning="snapshot?affectedWarnings(snapshot,'employment'):''" />
    </div>
  </section>
</template>
<style scoped>
.dashboard { display:grid;gap:var(--we-space-4);container-type:inline-size; }
.dashboard-date { margin-bottom:calc(-1 * var(--we-space-2)); }
.dashboard-progress { padding:var(--we-space-4); }
.dashboard-progress-heading { display:flex;justify-content:space-between;gap:var(--we-space-3);align-items:center; }
h2 { font-size:var(--we-text-body); }
strong { color:var(--we-accent);font-variant-numeric:tabular-nums; }
progress { display:block;width:100%;height:8px;appearance:none;border:0;border-radius:8px;overflow:hidden;background:var(--we-track);margin:var(--we-space-2) 0;accent-color:var(--we-accent); }
progress::-webkit-progress-bar { background:var(--we-track);border-radius:var(--we-radius-control); }
progress::-webkit-progress-value { background:var(--we-accent);border-radius:var(--we-radius-control); }
.dashboard-metrics { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-3); }
.dashboard-warning { font-size:var(--we-text-small);color:var(--we-warning-text);overflow-wrap:anywhere; }
@media (max-width:639px) { .dashboard-metrics { grid-template-columns:minmax(0,1fr); } }
</style>
