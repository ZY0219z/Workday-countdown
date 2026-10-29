<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { CalendarDatasetMetadata, ValidationIssue, ExpectedEndContext } from '../../../shared/contracts'
import type { EditorSettings } from '../ui/settings-editor'
import { fieldIssues } from '../ui/settings-editor'
import FieldErrors from '../components/FieldErrors.vue'
import TimeInput from '../components/TimeInput.vue'
import UiIcon from '../components/UiIcon.vue'
import DataSettings from '../settings/DataSettings.vue'
import type { MainWindowApi } from '../../../shared/contracts'
const props=withDefaults(defineProps<{model:EditorSettings;expectedEnd?:ExpectedEndContext|null;expectedEndInput?:string;issues:ValidationIssue[];busy:boolean;dirty:boolean;initialized:boolean;canSave:boolean;sessionReady?:boolean;quitDisabled?:boolean;defaultUnpersisted?:boolean;validationAttempt?:number;metadata:CalendarDatasetMetadata[];api:MainWindowApi}>(),{sessionReady:true,defaultUnpersisted:false,validationAttempt:0})
const emit=defineEmits<{change:[value:EditorSettings];save:[];cancel:[];quit:[];imported:[];dataBusy:[value:boolean];expectedEnd:[value:string|null]}>()
const form=ref<EditorSettings>(JSON.parse(JSON.stringify(props.model)))
// Main acknowledgements must not replace equal local input on every keystroke.
watch(()=>props.model,value=>{if(JSON.stringify(value)!==JSON.stringify(form.value))form.value=JSON.parse(JSON.stringify(value))})
const errorPrefix=useId()
const errorId=(path:string)=>`${errorPrefix}-${path.replace(/[^a-zA-Z0-9-]/g,'-')}-errors`
const hasErrors=(path:string)=>fieldIssues(props.issues,path).length>0
const errorDescription=(path:string)=>hasErrors(path)?errorId(path):undefined
const days=['周一','周二','周三','周四','周五','周六','周日']
// Hidden legacy fields remain in the full draft; these labels never normalize it.
const customWorkWeek=computed(()=>form.value.schedule.workWeek.length!==5||([1,2,3,4,5] as const).some(day=>!form.value.schedule.workWeek.includes(day)))
const workWeekLabel=computed(()=>form.value.schedule.workWeek.map(day=>days[day-1]).join('、')||'无固定工作日')
const endComparison=computed(()=>{
  const end=props.expectedEnd
  if(!end?.available||!end.previewEnd||hasErrors('$.expectedEndTime')||props.expectedEndInput!==end.previewEnd.time)return null
  return end.previewEnd.date!==end.finalEnd.date||end.previewEnd.time!==end.finalEnd.time?end.previewEnd:null
})
// Dates come from Main; only abbreviate an end that belongs to the same shift date.
function endLabel(end:{date:string;time:string}){return props.expectedEnd?.available&&end.date===props.expectedEnd.shiftDate?end.time:`${end.date} ${end.time}`}
function update(){emit('change',JSON.parse(JSON.stringify(form.value)))}
function numeric(event:Event):number|null{const value=(event.target as HTMLInputElement).value;return value===''?null:Number(value)}
</script>
<template>
  <section class="settings" aria-label="设置中心">
    <h2 v-if="!sessionReady||!canSave" class="settings-title"><UiIcon name="settings" tile />{{ !sessionReady?'设置暂不可用':'配置恢复' }}</h2>
    <p v-if="!sessionReady" role="alert">尚未读取 Main 草稿，请先重新连接配置；当前不能编辑或保存。</p>
    <form @submit.prevent="emit('save')">
      <fieldset :disabled="busy||!sessionReady||!canSave" class="settings-fields">
        <section class="settings-time-group" aria-label="时间与日程">
          <div class="settings-work-times settings-card">
          <div class="settings-field"><TimeInput row icon-tile v-model="form.schedule.startTime" label="上班时间" :invalid="hasErrors('$.schedule.startTime')" :described-by="errorDescription('$.schedule.startTime')" @update:model-value="update" />
            <FieldErrors :id="errorId('$.schedule.startTime')" :issues="issues" path="$.schedule.startTime" /></div>
          <div class="settings-field"><TimeInput row icon-tile v-model="form.schedule.endTime" label="下班时间" :invalid="hasErrors('$.schedule.endTime')" :described-by="errorDescription('$.schedule.endTime')" @update:model-value="update" />
            <FieldErrors :id="errorId('$.schedule.endTime')" :issues="issues" path="$.schedule.endTime" /></div>
          </div>
          <div class="settings-field settings-expected settings-card">
            <fieldset :disabled="!expectedEnd?.available" class="settings-expected-fields">
              <TimeInput row icon-tile icon="coffee" :model-value="expectedEndInput||''" label="今天预计下班时间" :invalid="hasErrors('$.expectedEndTime')" :described-by="errorDescription('$.expectedEndTime')" @update:model-value="value=>emit('expectedEnd',value)" />
              <div class="settings-expected-context"><p class="we-muted">仅本班次有效；较早时刻按次日解释，下个工作日恢复正常下班时间。</p><button type="button" class="we-button" @click="emit('expectedEnd',null)">取消今天加班</button></div>
            </fieldset>
            <template v-if="expectedEnd?.available">
              <div v-if="endComparison" class="settings-end-comparison">
                <p class="we-muted settings-note">当前生效：{{ endLabel(expectedEnd.finalEnd) }}<template v-if="expectedEnd.minutes>0">（已设置加班 {{ expectedEnd.minutes }} 分钟）</template></p>
                <p class="settings-note">保存后：{{ endLabel(endComparison) }}</p>
              </div>
              <p v-else-if="expectedEnd.finalEnd.date!==expectedEnd.shiftDate" class="we-muted settings-note">当前生效：{{ endLabel(expectedEnd.finalEnd) }}<template v-if="expectedEnd.minutes>0">（已设置加班 {{ expectedEnd.minutes }} 分钟）</template></p>
              <p v-else-if="expectedEnd.minutes>0" class="we-muted settings-note">已设置加班 {{ expectedEnd.minutes }} 分钟</p>
            </template>
            <p v-else class="we-muted settings-note">{{ expectedEnd&&!expectedEnd.available?expectedEnd.message:'正在确认当前班次…' }}</p>
            <FieldErrors :id="errorId('$.expectedEndTime')" :issues="issues" path="$.expectedEndTime" />
          </div>
          <div v-if="form.schedule.crossMidnight||customWorkWeek||form.schedule.breaks.length" class="settings-history">
            <p v-if="form.schedule.crossMidnight" class="we-muted">保留历史跨夜班次，下班在次日。</p>
            <p v-if="customWorkWeek" class="we-muted">保留历史工作周：{{ workWeekLabel }}；仍按原规则计算。</p>
            <p v-if="form.schedule.breaks.length" class="we-muted">保留了历史午休配置，仍按原规则计算；修改其他设置不会清除它。</p>
          </div>
          <FieldErrors :issues="issues" path="$.schedule" :exclude-paths="['$.schedule.startTime','$.schedule.endTime']" />
        </section>
        <div class="settings-personal-fields">
        <div class="settings-field settings-card">
          <label class="settings-row settings-personal-row"><span class="settings-label"><UiIcon name="calendar" tile />入职日期</span><input :value="form.employee.startDate||''" type="date" class="we-control" :aria-invalid="hasErrors('$.employee.startDate')||undefined" :aria-describedby="errorDescription('$.employee.startDate')" @input="form.employee.startDate=($event.target as HTMLInputElement).value||null;update()" /></label>
          <FieldErrors :id="errorId('$.employee.startDate')" :issues="issues" path="$.employee.startDate" />
          <p class="we-muted settings-note">可留空。不含今天，入职当天为 0；计划工作日并非实际出勤。</p><FieldErrors :issues="issues" path="$.employee" :exclude-paths="['$.employee.startDate']" />
        </div>
        <div class="settings-field settings-card">
          <label class="settings-row settings-personal-row"><span class="settings-label"><UiIcon name="wallet" tile />每月发薪日</span><input :value="form.salary.day??''" type="number" min="1" max="31" step="1" class="we-control" :aria-invalid="hasErrors('$.salary.day')||undefined" :aria-describedby="errorDescription('$.salary.day')" @input="form.salary.day=numeric($event);update()" /></label>
          <FieldErrors :id="errorId('$.salary.day')" :issues="issues" path="$.salary.day" />
          <p v-if="form.salary.nonWorkingPolicy!=='delay'" class="we-muted settings-note">保留历史发薪策略：{{ form.salary.nonWorkingPolicy==='advance'?'提前至上一个工作日':'休息日不调整' }}。</p>
          <p v-else class="we-muted settings-note">每月发上月工资，遇休息日按工作日历顺延。</p><FieldErrors :issues="issues" path="$.salary" :exclude-paths="['$.salary.day']" />
        </div>
        </div>
        <div class="settings-field settings-mini settings-card">
          <label class="settings-row"><span class="settings-label"><UiIcon name="monitor" tile />启用迷你窗</span><input v-model="form.desktop.miniEnabled" class="settings-switch" type="checkbox" role="switch" :aria-invalid="hasErrors('$.desktop.miniEnabled')||undefined" :aria-describedby="errorDescription('$.desktop.miniEnabled')" @change="update" /></label>
          <FieldErrors :id="errorId('$.desktop.miniEnabled')" :issues="issues" path="$.desktop.miniEnabled" />
          <p class="we-muted settings-note">启用并保存后，可从主窗口或托盘进入；每次启动仍打开主窗口。</p>
        </div>
        <FieldErrors v-for="path in ['$.calendar','$.appearance','$.desktop','$.overtime']" :key="path" :issues="issues" :path="path" :exclude-paths="['$.desktop.miniEnabled']" />
      </fieldset>
      <div class="settings-actions">
        <button type="button" class="we-button settings-cancel" aria-label="取消 / 返回仪表盘" :disabled="busy||!sessionReady" @click="emit('cancel')">取消</button>
        <button type="submit" class="we-button we-button--primary" :disabled="busy||!canSave">{{ busy?'正在保存…':'保存设置' }}</button>
        <button type="button" class="we-button settings-exit" :disabled="busy||quitDisabled" @click="emit('quit')">退出程序</button>
        <span class="we-muted settings-save-state">{{ !sessionReady?'草稿状态未知，尚未读取':dirty?'有未保存修改':defaultUnpersisted?'默认设置尚未保存':'没有未保存修改' }}</span>
      </div>
    </form>
    <section v-if="sessionReady&&!canSave" class="settings-recovery" aria-label="安全恢复">
      <h3>安全恢复</h3><p class="settings-deferred">当前正式配置不可写。可预览完整 V2 配置或有效备份，确认后再恢复；较新版本配置仍受保护。</p>
      <DataSettings recovery-only :api="api" :blocked="dirty||busy" @applied="emit('imported')" @busy="value=>emit('dataBusy',value)" />
    </section>
  </section>
</template>
<style scoped>
.settings { display:grid;gap:14px;--we-settings-icon:var(--we-accent); }
.settings-title { display:flex;align-items:center;gap:12px;font-size:22px; }

.settings-fields,.settings-expected-fields { border:0;padding:0;margin:0;min-width:0; }
.settings-fields,.settings-time-group { display:grid;gap:10px; }
.settings :deep(.time-input-label) { color:var(--we-text);font-weight:600; }
.settings-card { padding:10px;border:1px solid color-mix(in srgb,var(--we-accent) 9%,var(--we-surface));border-radius:12px;background:color-mix(in srgb,var(--we-accent) 3%,var(--we-surface)); }
.settings-field { min-width:0; }
.settings-work-times { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }
.settings-work-times :deep(.time-input--row) { grid-template-columns:auto minmax(120px,1fr);gap:8px; }
.settings-work-times :deep(.time-input-label) { gap:6px; }
.settings-personal-fields { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px; }
@media(max-width:600px) { .settings-work-times,.settings-personal-fields { grid-template-columns:minmax(0,1fr); } }
.settings-row { display:grid;grid-template-columns:minmax(0,1fr) minmax(120px,180px);gap:12px;align-items:center;min-height:40px; }
.settings-label { display:flex;align-items:center;gap:12px;font-size:15px;font-weight:600;color:var(--we-text); }
.settings-label svg { flex:none; }
.settings-row .we-control { width:100%;min-width:0;min-height:40px;font-size:15px;font-variant-numeric:tabular-nums; }
.settings .settings-personal-row { grid-template-columns:minmax(0,1fr);gap:8px; }
.settings-note { margin-top:4px; }
.settings-end-comparison { margin-top:6px; }
.settings-expected-context { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:6px; }
.settings-expected-context .we-button { flex:none;font-size:12px;min-height:28px;padding:2px 8px; }
.settings-history { display:grid;gap:3px; }

.settings-switch { appearance:none;position:relative;justify-self:end;cursor:pointer;width:44px;height:26px;margin:0;border:1px solid var(--we-control-border);border-radius:20px;background:var(--we-track); }
.settings-switch::before { content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:var(--we-surface);box-shadow:0 1px 3px rgb(20 40 60 / 20%); }
.settings-switch:checked { background:var(--we-button);border-color:var(--we-button); }.settings-switch:checked::before { transform:translateX(18px);background:#fff; }
.settings-switch:disabled { opacity:.6; }
.settings-actions { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;align-items:center; }
.settings-actions > .we-button:not(.settings-exit) { min-height:42px;font-weight:600; }
.settings-exit { justify-self:start;font-size:12px;border-color:transparent;background:transparent; }
.settings-save-state { text-align:right; }
@media(hover:hover) and (pointer:fine) { .settings-actions .we-button--primary:hover:not(:disabled) { background:color-mix(in srgb,var(--we-button) 90%,#16375f); }.settings-switch:hover:not(:disabled) { border-color:var(--we-accent); } }
.settings-actions .we-button--primary:active:not(:disabled) { background:color-mix(in srgb,var(--we-button) 82%,#16375f); }
.settings-recovery { display:grid;gap:12px;border-top:1px solid var(--we-border);padding-top:16px; }
.settings-deferred { color:var(--we-warning-text);font-size:var(--we-text-small); }
@media(max-width:400px) { .settings-row { grid-template-columns:minmax(0,1fr) 132px;gap:8px; }.settings-label { gap:8px;font-size:13px; }.settings-expected-context { flex-wrap:wrap; } }
@media(forced-colors:active) { .settings-card { background:Canvas;border-color:CanvasText; }.settings-switch { background:Canvas;border-color:ButtonText; }.settings-switch::before { background:ButtonText; }.settings-switch:checked { background:Highlight; }.settings-switch:checked::before { background:HighlightText; } }
</style>
