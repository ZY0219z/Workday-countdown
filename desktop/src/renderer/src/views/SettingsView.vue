<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { CalendarDatasetMetadata, ValidationIssue, ExpectedEndContext, MainWindowApi } from '../../../shared/contracts'
import type { EditorSettings } from '../ui/settings-editor'
import { fieldIssues } from '../ui/settings-editor'
import FieldErrors from '../components/FieldErrors.vue'
import TimeInput from '../components/TimeInput.vue'
import DataSettings from '../settings/DataSettings.vue'
const props=withDefaults(defineProps<{model:EditorSettings;expectedEnd?:ExpectedEndContext|null;expectedEndInput?:string;issues:ValidationIssue[];busy:boolean;dirty:boolean;initialized:boolean;canSave:boolean;sessionReady?:boolean;quitDisabled?:boolean;defaultUnpersisted?:boolean;validationAttempt?:number;metadata:CalendarDatasetMetadata[];api:MainWindowApi}>(),{sessionReady:true,defaultUnpersisted:false,validationAttempt:0})
const emit=defineEmits<{change:[value:EditorSettings];save:[];cancel:[];quit:[];imported:[];dataBusy:[value:boolean];expectedEnd:[value:string|null]}>()
// Keep the complete acknowledged draft, including fields absent from this form.
const form=ref<EditorSettings>(JSON.parse(JSON.stringify(props.model)))
watch(()=>props.model,value=>{if(JSON.stringify(value)!==JSON.stringify(form.value))form.value=JSON.parse(JSON.stringify(value))})
const errorPrefix=useId()
const errorId=(path:string)=>`${errorPrefix}-${path.replace(/[^a-zA-Z0-9-]/g,'-')}-errors`
const hasErrors=(path:string)=>fieldIssues(props.issues,path).length>0
const errorDescription=(path:string)=>hasErrors(path)?errorId(path):undefined
const days=['周一','周二','周三','周四','周五','周六','周日']
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
        <section class="settings-panel" aria-label="时间与日程">
          <h3>时间与日程</h3>
          <div class="settings-pair">
            <div><TimeInput v-model="form.schedule.startTime" label="上班时间" :invalid="hasErrors('$.schedule.startTime')" :described-by="errorDescription('$.schedule.startTime')" @update:model-value="update" /><FieldErrors :id="errorId('$.schedule.startTime')" :issues="issues" path="$.schedule.startTime" /></div>
            <div><TimeInput v-model="form.schedule.endTime" label="下班时间" :invalid="hasErrors('$.schedule.endTime')" :described-by="errorDescription('$.schedule.endTime')" @update:model-value="update" /><FieldErrors :id="errorId('$.schedule.endTime')" :issues="issues" path="$.schedule.endTime" /></div>
          </div>
          <div class="settings-expected">
            <fieldset :disabled="!expectedEnd?.available" class="settings-expected-fields">
              <TimeInput :model-value="expectedEndInput||''" label="今天预计下班时间" :invalid="hasErrors('$.expectedEndTime')" :described-by="errorDescription('$.expectedEndTime')" @update:model-value="value=>emit('expectedEnd',value)" />
              <button type="button" class="we-button" @click="emit('expectedEnd',null)">取消今天加班</button>
            </fieldset>
            <p class="we-muted">仅本班次有效，下一个工作日恢复正常下班时间。较早时刻按正常下班的次日解释。</p>
            <p v-if="expectedEnd?.available" class="we-muted">本班次 {{ expectedEnd.shiftDate }} · 正常结束 {{ expectedEnd.normalEnd.date }} {{ expectedEnd.normalEnd.time }}<template v-if="expectedEnd.minutes>0"> · 现有预计结束 {{ expectedEnd.finalEnd.date }} {{ expectedEnd.finalEnd.time }}</template></p>
            <p v-else class="we-muted">{{ expectedEnd&&!expectedEnd.available?expectedEnd.message:'正在确认当前班次…' }}</p>
            <p v-if="expectedEnd?.available&&expectedEnd.previewEnd" class="we-muted">本次预计结束：{{ expectedEnd.previewEnd.date }} {{ expectedEnd.previewEnd.time }}（保存后生效）</p>
            <FieldErrors :id="errorId('$.expectedEndTime')" :issues="issues" path="$.expectedEndTime" />
          </div>
          <p v-if="form.schedule.crossMidnight" class="we-muted">保留历史跨夜班次，下班在次日。</p>
          <p v-if="customWorkWeek" class="we-muted">保留历史工作周：{{ workWeekLabel }}；仍按原规则计算。</p>
          <p v-if="form.schedule.breaks.length" class="we-muted">保留了历史午休配置，仍按原规则计算；修改其他设置不会清除它。</p>
          <FieldErrors :issues="issues" path="$.schedule" :exclude-paths="['$.schedule.startTime','$.schedule.endTime']" />
        </section>
        <div class="settings-pair settings-personal">
          <section class="settings-panel"><label>入职日期<input :value="form.employee.startDate||''" type="date" class="we-control" :aria-invalid="hasErrors('$.employee.startDate')||undefined" :aria-describedby="errorDescription('$.employee.startDate')" @input="form.employee.startDate=($event.target as HTMLInputElement).value||null;update()" /></label>
            <FieldErrors :id="errorId('$.employee.startDate')" :issues="issues" path="$.employee.startDate" /><p class="we-muted">可留空。按自然日计算，不含今天；入职当天为 0。</p><FieldErrors :issues="issues" path="$.employee" :exclude-paths="['$.employee.startDate']" />
          </section>
          <section class="settings-panel"><label>每月发薪日<input :value="form.salary.day??''" type="number" min="1" max="31" step="1" class="we-control" :aria-invalid="hasErrors('$.salary.day')||undefined" :aria-describedby="errorDescription('$.salary.day')" @input="form.salary.day=numeric($event);update()" /></label>
            <FieldErrors :id="errorId('$.salary.day')" :issues="issues" path="$.salary.day" />
            <p v-if="form.salary.nonWorkingPolicy!=='delay'" class="we-muted">保留历史发薪策略：{{ form.salary.nonWorkingPolicy==='advance'?'提前至上一个工作日':'休息日不调整' }}。</p><p v-else class="we-muted">每月发上月工资，遇休息日按工作日历顺延。</p><FieldErrors :issues="issues" path="$.salary" :exclude-paths="['$.salary.day']" />
          </section>
        </div>
        <section class="settings-panel settings-mini">
          <label class="settings-mini-label"><span><strong>启用迷你模式</strong><small :id="errorPrefix+'-mini-hint'">保存后，点击主窗口右上角“迷你模式”进入。</small></span><input v-model="form.desktop.miniEnabled" type="checkbox" role="switch" aria-label="启用迷你模式" class="settings-switch" :aria-invalid="hasErrors('$.desktop.miniEnabled')||undefined" :aria-describedby="[errorPrefix+'-mini-hint',errorDescription('$.desktop.miniEnabled')].filter(Boolean).join(' ')" @change="update" /></label>
          <FieldErrors :id="errorId('$.desktop.miniEnabled')" :issues="issues" path="$.desktop.miniEnabled" />
        </section>
      </fieldset>
      <FieldErrors :issues="issues" path="$.calendar" /><FieldErrors :issues="issues" path="$.appearance" /><FieldErrors :issues="issues" path="$.desktop" :exclude-paths="['$.desktop.miniEnabled']" />
      <div class="settings-actions"><button type="submit" class="we-button we-button--primary" :disabled="busy||!canSave||!sessionReady">{{ busy?'正在保存…':'保存设置' }}</button><button type="button" class="we-button" :disabled="busy||!sessionReady" @click="emit('cancel')">取消 / 返回仪表盘</button><button type="button" class="we-button" :disabled="busy||quitDisabled" @click="emit('quit')">退出程序</button><span class="we-muted">{{ !sessionReady?'草稿状态未知，尚未读取':dirty?'有未保存修改':defaultUnpersisted?'默认设置尚未保存':'没有未保存修改' }}</span></div>
    </form>
    <section v-if="sessionReady&&!canSave" class="settings-recovery" aria-label="配置安全恢复">
      <p class="settings-deferred">当前配置只读，不能直接保存覆盖。可先预览有效备份或完整 V2 配置，再按校验结果确认恢复；损坏或较新版本源文件仍受保护。</p>
      <DataSettings recovery-only :api="api" :blocked="dirty||busy" @applied="emit('imported')" @busy="value=>emit('dataBusy',value)" />
    </section>
  </section>
</template>
<style scoped>
.settings { display:grid;gap:var(--we-space-5); }
h2 { font-size:22px;letter-spacing:-.02em; } h3 { font-size:15px; }
.settings-fields { border:0;padding:0;margin:0;min-width:0;display:grid;gap:var(--we-space-5); }
.settings-pair { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-4);align-items:start; }
.settings-panel { display:grid;gap:var(--we-space-2);min-width:0; }
.settings-panel > label:not(.settings-mini-label) { display:grid;gap:var(--we-space-1);font-weight:600; }
.settings-panel .we-control { width:100%;max-width:100%;font-weight:400; }
.settings-expected { padding:var(--we-space-3);border-radius:var(--we-radius-card);background:var(--we-subtle);display:grid;gap:var(--we-space-1); }
.settings-expected-fields { border:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--we-space-2);align-items:end; }
.settings-expected-fields > button { align-self:center; }
.settings-mini { padding:var(--we-space-4) 0;border-top:1px solid var(--we-border);border-bottom:1px solid var(--we-border); }
.settings-mini-label { display:flex;align-items:center;justify-content:space-between;gap:var(--we-space-4);cursor:pointer; }
.settings-mini-label small { display:block;color:var(--we-muted);font-size:var(--we-text-small);margin-top:4px; }
.settings-switch { appearance:none;flex:none;width:42px;height:24px;margin:0;border:1px solid var(--we-control-border);border-radius:20px;background:var(--we-track);position:relative;cursor:pointer; }
.settings-switch::before { content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--we-surface);box-shadow:0 1px 3px rgb(0 0 0 / 16%); }
.settings-switch:checked { background:var(--we-button);border-color:var(--we-button); }.settings-switch:checked::before { transform:translateX(18px); }
.settings-actions { display:flex;gap:var(--we-space-2);flex-wrap:wrap;align-items:center;margin-top:var(--we-space-4); }
.settings-actions .we-button--primary:disabled { background:var(--we-subtle);color:var(--we-muted);border-color:var(--we-border); }
.settings-deferred { color:var(--we-warning-text);font-size:var(--we-text-small); }.settings-recovery { display:grid;gap:var(--we-space-3);border-top:1px solid var(--we-border);padding-top:var(--we-space-4); }
@media(max-width:520px){.settings-pair,.settings-expected-fields{grid-template-columns:minmax(0,1fr)}}
@media(forced-colors:active){.settings-switch:checked{background:Highlight}.settings-switch::before{background:CanvasText}.settings-switch:checked::before{background:HighlightText}}
</style>
