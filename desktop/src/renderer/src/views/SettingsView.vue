<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { CalendarDatasetMetadata, ValidationIssue, ExpectedEndContext } from '../../../shared/contracts'
import type { EditorSettings } from '../ui/settings-editor'
import { fieldIssues } from '../ui/settings-editor'
import FieldErrors from '../components/FieldErrors.vue'
import TimeInput from '../components/TimeInput.vue'
import DataSettings from '../settings/DataSettings.vue'
import type { MainWindowApi } from '../../../shared/contracts'
const props=withDefaults(defineProps<{model:EditorSettings;expectedEnd?:ExpectedEndContext|null;expectedEndInput?:string;issues:ValidationIssue[];busy:boolean;dirty:boolean;initialized:boolean;canSave:boolean;sessionReady?:boolean;quitDisabled?:boolean;defaultUnpersisted?:boolean;validationAttempt?:number;metadata:CalendarDatasetMetadata[];api:MainWindowApi}>(),{sessionReady:true,defaultUnpersisted:false,validationAttempt:0})
const emit=defineEmits<{change:[value:EditorSettings];save:[];cancel:[];quit:[];imported:[];dataBusy:[value:boolean];expectedEnd:[value:string|null]}>()
const form=ref<EditorSettings>(JSON.parse(JSON.stringify(props.model)))
// Main acknowledgements must not replace equal local input on every keystroke.
watch(()=>props.model,value=>{if(JSON.stringify(value)!==JSON.stringify(form.value))form.value=JSON.parse(JSON.stringify(value))})
const moreOpen=ref(false)
const errorPrefix=useId()
const errorId=(path:string)=>`${errorPrefix}-${path.replace(/[^a-zA-Z0-9-]/g,'-')}-errors`
const hasErrors=(path:string)=>fieldIssues(props.issues,path).length>0
const errorDescription=(path:string)=>hasErrors(path)?errorId(path):undefined
// Reveal Mini errors only after an explicit failed Save; never take focus.
watch(()=>props.validationAttempt,()=>{if(hasErrors('$.desktop.miniEnabled'))moreOpen.value=true})
const days=['周一','周二','周三','周四','周五','周六','周日']
// Hidden legacy fields remain in the full draft; these labels never normalize it.
const customWorkWeek=computed(()=>form.value.schedule.workWeek.length!==5||([1,2,3,4,5] as const).some(day=>!form.value.schedule.workWeek.includes(day)))
const workWeekLabel=computed(()=>form.value.schedule.workWeek.map(day=>days[day-1]).join('、')||'无固定工作日')
function update(){emit('change',JSON.parse(JSON.stringify(form.value)))}
function numeric(event:Event):number|null{const value=(event.target as HTMLInputElement).value;return value===''?null:Number(value)}
</script>
<template>
  <section class="settings" aria-label="设置中心">
    <h2>{{ !sessionReady?'设置暂不可用':canSave?'设置中心':'配置恢复' }}</h2>
    <p v-if="!sessionReady" role="alert">尚未读取 Main 草稿，请先重新连接配置；当前不能编辑或保存。</p>
    <form @submit.prevent="emit('save')">
      <fieldset :disabled="busy||!sessionReady||!canSave" class="settings-fields">
        <div class="settings-common">
        <section class="settings-panel settings-schedule" aria-label="时间与日程">
          <h3>时间与日程</h3>
          <div class="settings-time-pair"><div><TimeInput v-model="form.schedule.startTime" label="上班时间" :invalid="hasErrors('$.schedule.startTime')" :described-by="errorDescription('$.schedule.startTime')" @update:model-value="update" />
          <FieldErrors :id="errorId('$.schedule.startTime')" :issues="issues" path="$.schedule.startTime" /></div><div>
          <TimeInput v-model="form.schedule.endTime" label="下班时间" :invalid="hasErrors('$.schedule.endTime')" :described-by="errorDescription('$.schedule.endTime')" @update:model-value="update" />
          <FieldErrors :id="errorId('$.schedule.endTime')" :issues="issues" path="$.schedule.endTime" /></div></div>
          <div class="settings-expected"><fieldset :disabled="!expectedEnd?.available" class="settings-expected-fields">
            <TimeInput :model-value="expectedEndInput||''" label="今天预计下班时间" :invalid="hasErrors('$.expectedEndTime')" :described-by="errorDescription('$.expectedEndTime')" @update:model-value="value=>emit('expectedEnd',value)" />
            <button type="button" class="we-button" @click="emit('expectedEnd',null)">取消今天加班</button>
          </fieldset>
          <p class="we-muted">仅本班次有效，下一个工作日恢复正常下班时间。较早时刻按正常下班的次日解释。</p>
          <p v-if="expectedEnd?.available" class="we-muted">本班次 {{ expectedEnd.shiftDate }} · 正常结束 {{ expectedEnd.normalEnd.date }} {{ expectedEnd.normalEnd.time }}<template v-if="expectedEnd.minutes>0"> · 现有预计结束 {{ expectedEnd.finalEnd.date }} {{ expectedEnd.finalEnd.time }}</template></p>
          <p v-else class="we-muted">{{ expectedEnd&&!expectedEnd.available?expectedEnd.message:'正在确认当前班次…' }}</p>
          <p v-if="expectedEnd?.available&&expectedEnd.previewEnd" class="we-muted">本次预计结束：{{ expectedEnd.previewEnd.date }} {{ expectedEnd.previewEnd.time }}（保存后生效）</p>
          <FieldErrors :id="errorId('$.expectedEndTime')" :issues="issues" path="$.expectedEndTime" /></div>
          <p v-if="form.schedule.crossMidnight" class="we-muted">保留历史跨夜班次，下班在次日。</p>
          <p v-if="customWorkWeek" class="we-muted">保留历史工作周：{{ workWeekLabel }}；仍按原规则计算。</p>
          <p v-if="form.schedule.breaks.length" class="we-muted">保留了历史午休配置，仍按原规则计算；修改其他设置不会清除它。</p>
          <FieldErrors :issues="issues" path="$.schedule" :exclude-paths="['$.schedule.startTime','$.schedule.endTime']" />
        </section>
        <section class="settings-panel">
          <h3>入职日期</h3><label>入职日期<input :value="form.employee.startDate||''" type="date" class="we-control" :aria-invalid="hasErrors('$.employee.startDate')||undefined" :aria-describedby="errorDescription('$.employee.startDate')" @input="form.employee.startDate=($event.target as HTMLInputElement).value||null;update()" /></label>
          <FieldErrors :id="errorId('$.employee.startDate')" :issues="issues" path="$.employee.startDate" />
          <p class="we-muted">可留空。不含今天，入职当天为 0；计划工作日并非实际出勤。</p><FieldErrors :issues="issues" path="$.employee" :exclude-paths="['$.employee.startDate']" />
        </section>
        <section class="settings-panel">
          <h3>计划发薪</h3><label>每月发薪日<input :value="form.salary.day??''" type="number" min="1" max="31" step="1" class="we-control" :aria-invalid="hasErrors('$.salary.day')||undefined" :aria-describedby="errorDescription('$.salary.day')" @input="form.salary.day=numeric($event);update()" /></label>
          <FieldErrors :id="errorId('$.salary.day')" :issues="issues" path="$.salary.day" />
          <p v-if="form.salary.nonWorkingPolicy!=='delay'" class="we-muted">保留历史发薪策略：{{ form.salary.nonWorkingPolicy==='advance'?'提前至上一个工作日':'休息日不调整' }}。</p>
          <p v-else class="we-muted">每月发上月工资，遇休息日按工作日历顺延。</p><FieldErrors :issues="issues" path="$.salary" :exclude-paths="['$.salary.day']" />
        </section>
        </div>
        <details class="settings-more" :open="moreOpen" @toggle="moreOpen=($event.target as HTMLDetailsElement).open"><summary>更多设置</summary>
        <section class="settings-panel" aria-label="迷你窗设置">
          <label class="we-check"><input v-model="form.desktop.miniEnabled" type="checkbox" :aria-invalid="hasErrors('$.desktop.miniEnabled')||undefined" :aria-describedby="errorDescription('$.desktop.miniEnabled')" @change="update" />启用迷你窗</label>
          <FieldErrors :id="errorId('$.desktop.miniEnabled')" :issues="issues" path="$.desktop.miniEnabled" />
          <p class="we-muted">启用并保存后，可从主窗口或托盘进入迷你窗；每次启动仍打开主窗口。</p>
        </section>
        </details>
        <FieldErrors v-for="path in ['$.calendar','$.appearance','$.desktop','$.overtime']" :key="path" :issues="issues" :path="path" :exclude-paths="['$.desktop.miniEnabled']" />
      </fieldset>
      <div class="settings-actions"><button type="submit" class="we-button we-button--primary" :disabled="busy||!canSave">{{ busy?'正在保存…':'保存设置' }}</button><button type="button" class="we-button" :disabled="busy||!sessionReady" @click="emit('cancel')">取消 / 返回仪表盘</button><button type="button" class="we-button" :disabled="busy||quitDisabled" @click="emit('quit')">退出程序</button><span class="we-muted">{{ !sessionReady?'草稿状态未知，尚未读取':dirty?'有未保存修改':defaultUnpersisted?'默认设置尚未保存':'没有未保存修改' }}</span></div>
    </form>
    <section v-if="sessionReady&&!canSave" class="settings-panel" aria-label="安全恢复">
      <h3>安全恢复</h3><p class="settings-deferred">当前正式配置不可写。可预览完整 V2 配置或有效备份，确认后再恢复；较新版本配置仍受保护。</p>
      <DataSettings recovery-only :api="api" :blocked="dirty||busy" @applied="emit('imported')" @busy="value=>emit('dataBusy',value)" />
    </section>
  </section>
</template>
<style scoped>
.settings { display:grid;gap:var(--we-space-4); }
h2 { font-size:22px; } h3 { font-size:var(--we-text-title); }
.settings-fields { border:0;padding:0;margin:0;min-width:0;display:grid;gap:var(--we-space-4); }
.settings-common { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-4);align-items:start; }.settings-schedule { grid-column:1 / -1; }.settings-time-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-2);}.settings-more{border-top:1px solid var(--we-border);padding-top:var(--we-space-3)}summary{cursor:pointer;min-height:36px;line-height:36px;font-weight:600}.settings-more[open]{display:grid;gap:var(--we-space-3)}
.settings-expected-fields { border:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--we-space-2);align-items:end; }.settings-expected-fields > .we-button { align-self:center; }.settings-expected .we-muted{margin-top:var(--we-space-1)}
.settings-panel { display:grid;gap:var(--we-space-3); }
.settings-panel > label:not(.we-check) { display:grid;gap:var(--we-space-1); }
.settings-panel .we-control { max-width:100%;width:100%; }
fieldset { border:1px solid var(--we-border);border-radius:var(--we-radius-control);min-width:0; }
.settings-actions { display:flex;gap:var(--we-space-2);flex-wrap:wrap;align-items:center;margin-top:var(--we-space-5);padding-top:var(--we-space-3);border-top:1px solid var(--we-border); }
.settings-deferred { color:var(--we-warning-text);font-size:var(--we-text-small); }
@media(max-width:520px){.settings-common,.settings-time-pair,.settings-expected-fields{grid-template-columns:minmax(0,1fr)}}
</style>
