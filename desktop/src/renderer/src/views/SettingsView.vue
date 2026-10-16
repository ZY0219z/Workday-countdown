<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CalendarDatasetMetadata, ValidationIssue, ExpectedEndContext } from '../../../shared/contracts'
import type { EditorSettings } from '../ui/settings-editor'
import FieldErrors from '../components/FieldErrors.vue'
import TimeInput from '../components/TimeInput.vue'
import DataSettings from '../settings/DataSettings.vue'
import type { MainWindowApi } from '../../../shared/contracts'
import { normalizeLocalDate } from '../../../domain/local-date'
const props=withDefaults(defineProps<{model:EditorSettings;expectedEnd?:ExpectedEndContext|null;expectedEndInput?:string;issues:ValidationIssue[];busy:boolean;dirty:boolean;initialized:boolean;canSave:boolean;sessionReady?:boolean;quitDisabled?:boolean;defaultUnpersisted?:boolean;validationAttempt?:number;metadata:CalendarDatasetMetadata[];api:MainWindowApi}>(),{sessionReady:true,defaultUnpersisted:false,validationAttempt:0})
const emit=defineEmits<{change:[value:EditorSettings];save:[];cancel:[];quit:[];imported:[];dataBusy:[value:boolean];expectedEnd:[value:string|null]}>()
const form=ref<EditorSettings>(JSON.parse(JSON.stringify(props.model)))
// Main acknowledgements must not replace equal local input on every keystroke.
watch(()=>props.model,value=>{if(JSON.stringify(value)!==JSON.stringify(form.value))form.value=JSON.parse(JSON.stringify(value))})
const moreOpen=ref(false),active=ref('calendar'), date=ref(''),kind=ref<'work'|'rest'>('rest'),dateError=ref('')
const groups=[['calendar','工作日历'],['appearance','外观主题'],['desktop','窗口与托盘'],['data','数据与恢复']]
// Jump only on explicit failed Save, never during typing/group navigation.
watch(()=>props.validationAttempt,()=>{const field=props.issues[0]?.field.split('.')[1];if(groups.some(group=>group[0]===field)){active.value=field;moreOpen.value=true}})
const days=['周一','周二','周三','周四','周五','周六','周日']
function update(){emit('change',JSON.parse(JSON.stringify(form.value)))}
function addOverride(){const valid=normalizeLocalDate(date.value);if(!valid.ok){dateError.value='请选择真实有效的日期。';return}form.value.calendar.overrides[valid.data]=kind.value;dateError.value='';update()}
function numeric(event:Event):number|null{const value=(event.target as HTMLInputElement).value;return value===''?null:Number(value)}
</script>
<template>
  <section class="settings" aria-label="设置中心">
    <h2>{{ !sessionReady?'设置暂不可用':canSave?'设置中心':'配置恢复' }}</h2>
    <p v-if="!sessionReady" role="alert">尚未读取 Main 草稿，请先重新连接配置；当前不能编辑或保存。</p>
    <form @submit.prevent="emit('save')">
      <fieldset :disabled="busy||!sessionReady" class="settings-fields">
        <div class="settings-common">
        <section class="settings-panel settings-schedule" aria-label="时间与日程">
          <h3>时间与日程</h3>
          <div class="settings-time-pair"><div><TimeInput v-model="form.schedule.startTime" label="上班时间" @update:model-value="update" />
          <FieldErrors :issues="issues" path="$.schedule.startTime" /></div><div>
          <TimeInput v-model="form.schedule.endTime" label="下班时间" @update:model-value="update" />
          <FieldErrors :issues="issues" path="$.schedule.endTime" /></div></div>
          <div class="settings-expected"><fieldset :disabled="!expectedEnd?.available" class="settings-expected-fields">
            <TimeInput :model-value="expectedEndInput||''" label="今天预计下班时间" @update:model-value="value=>emit('expectedEnd',value)" />
            <button type="button" class="we-button" @click="emit('expectedEnd',null)">取消今天加班</button>
          </fieldset>
          <p class="we-muted">仅本班次有效，下一个工作日恢复正常下班时间。较早时刻按正常下班的次日解释。</p>
          <p v-if="expectedEnd?.available" class="we-muted">本班次 {{ expectedEnd.shiftDate }} · 正常结束 {{ expectedEnd.normalEnd.date }} {{ expectedEnd.normalEnd.time }}<template v-if="expectedEnd.minutes>0"> · 现有预计结束 {{ expectedEnd.finalEnd.date }} {{ expectedEnd.finalEnd.time }}</template></p>
          <p v-else class="we-muted">{{ expectedEnd&&!expectedEnd.available?expectedEnd.message:'正在确认当前班次…' }}</p>
          <p v-if="expectedEnd?.available&&expectedEnd.previewEnd" class="we-muted">本次预计结束：{{ expectedEnd.previewEnd.date }} {{ expectedEnd.previewEnd.time }}（保存后生效）</p>
          <FieldErrors :issues="issues" path="$.expectedEndTime" /></div>
          <label class="we-check"><input v-model="form.schedule.crossMidnight" type="checkbox" @change="update" /> 跨夜班次（下班在次日）</label>
          <fieldset><legend>每周工作日</legend><div class="settings-checks"><label v-for="(day,i) in days" :key="day" class="we-check"><input v-model="form.schedule.workWeek" type="checkbox" :value="i+1" @change="update" />{{ day }}</label></div></fieldset>
          <p v-if="form.schedule.breaks.length" class="we-muted">保留了历史午休配置，仍按原规则计算；修改其他设置不会清除它。</p>
          <FieldErrors :issues="issues" path="$.schedule" />
        </section>
        <section class="settings-panel">
          <h3>入职日期</h3><label>入职日期<input :value="form.employee.startDate||''" type="date" class="we-control" @input="form.employee.startDate=($event.target as HTMLInputElement).value||null;update()" /></label>
          <p class="we-muted">可留空。不含今天，入职当天为 0；计划工作日并非实际出勤。</p><FieldErrors :issues="issues" path="$.employee" />
        </section>
        <section class="settings-panel">
          <h3>计划发薪</h3><label>每月发薪日<input :value="form.salary.day??''" type="number" min="1" max="31" step="1" class="we-control" @input="form.salary.day=numeric($event);update()" /></label>
          <label>遇休息日<select v-model="form.salary.nonWorkingPolicy" class="we-control" @change="update"><option value="delay">顺延下一个工作日</option><option value="advance">提前上一个工作日</option><option value="none">不调整</option></select></label>
          <p class="we-muted">每月发上月工资，按所选休息日规则调整。仅为计划日期。</p><FieldErrors :issues="issues" path="$.salary" />
        </section>
        </div>
        <details class="settings-more" :open="moreOpen" @toggle="moreOpen=($event.target as HTMLDetailsElement).open"><summary>更多设置</summary>
    <label class="settings-group-label">设置分组 <select v-model="active" :disabled="busy||!sessionReady" class="we-control"><option v-for="group in groups" :key="group[0]" :value="group[0]">{{ group[1] }}</option></select></label>
        <section v-if="active==='calendar'" class="settings-panel">
          <h3>离线工作日历</h3><p class="we-muted">优先级：自定义日期 > 已核验年度安排 > 每周规则。缺少年份按周规则估算，不冒充官方数据。</p>
          <label v-for="item in metadata" :key="item.year" class="we-check calendar-year"><input v-model="form.calendar.enabledYears" type="checkbox" :value="item.year" @change="update" /><span>{{ item.year }} · {{ item.version }} · {{ item.verification==='verified'?'已核验':'未核验' }}<small>{{ item.source }} · 发布 {{ item.publishedOn }}</small></span></label>
          <div class="settings-record"><label>覆盖日期<input v-model="date" type="date" class="we-control" /></label><label>此日安排<select v-model="kind" class="we-control"><option value="work">工作</option><option value="rest">休息</option></select></label><button type="button" class="we-button" @click="addOverride">{{ form.calendar.overrides[date]?'更新此日覆盖':'添加日期覆盖' }}</button><p v-if="dateError" role="alert">{{ dateError }}</p></div>
          <div v-for="(value,key) in form.calendar.overrides" :key="key" class="settings-override"><span>{{ key }} · 自定义{{ value==='work'?'工作':'休息' }}</span><button type="button" class="we-button" @click="delete form.calendar.overrides[key];update()">删除 {{ key }} 覆盖</button></div>
          <p class="we-muted">删除覆盖后恢复年度安排 / 每周规则。</p><FieldErrors :issues="issues" path="$.calendar" />
          <p class="settings-deferred">外部年度包导入暂未开放，待后续单独授权；内置日历和手动覆盖可正常使用。</p>
        </section>
        <section v-if="active==='appearance'" class="settings-panel">
          <h3>外观主题</h3><label>显示模式<select v-model="form.appearance.mode" aria-label="显示模式" class="we-control" @change="update"><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">深色</option></select></label><label>配色<select v-model="form.appearance.accent" aria-label="配色" class="we-control" @change="update"><option value="ocean">海蓝</option><option value="coral">珊瑚</option></select></label><label class="we-check"><input v-model="form.appearance.reduceMotion" type="checkbox" @change="update" />减少动画</label>
          <p class="we-muted">即时预览；取消或放弃恢复已保存主题。系统或应用任一减少动画设置生效。当前形象为静态，原 GIF 动画后续接入。</p><FieldErrors :issues="issues" path="$.appearance" />
        </section>
        <section v-if="active==='desktop'" class="settings-panel">
          <h3>窗口与托盘偏好</h3><label>关闭主窗口<select v-model="form.desktop.closeAction" class="we-control" @change="update"><option value="hideToTray">隐藏到托盘</option><option value="quit">退出程序</option></select></label><label class="we-check"><input v-model="form.desktop.miniEnabled" type="checkbox" @change="update" />迷你窗偏好</label><label class="we-check"><input v-model="form.desktop.alwaysOnTop" type="checkbox" @change="update" />迷你窗置顶偏好</label>
          <p class="settings-deferred">当前仅保存偏好，尚未创建托盘或迷你窗。此阶段点击关闭仍真正退出并保护草稿，不隐藏成无法恢复的进程；首次启动仍打开主窗口。</p><FieldErrors :issues="issues" path="$.desktop" />
        </section>
        <section v-if="active==='data'" class="settings-panel"><DataSettings :api="api" :blocked="dirty||busy" @applied="emit('imported')" @busy="value=>emit('dataBusy',value)" /></section>
        </details>
      </fieldset>
      <div class="settings-actions"><button type="submit" class="we-button we-button--primary" :disabled="busy||!canSave">{{ busy?'正在保存…':'保存设置' }}</button><button type="button" class="we-button" :disabled="busy||!sessionReady" @click="emit('cancel')">取消 / 返回仪表盘</button><button type="button" class="we-button" :disabled="busy||quitDisabled" @click="emit('quit')">退出程序</button><span class="we-muted">{{ !sessionReady?'草稿状态未知，尚未读取':dirty?'有未保存修改':defaultUnpersisted?'默认设置尚未保存':'没有未保存修改' }}</span></div>
      <p v-if="sessionReady&&!canSave" class="settings-deferred">当前正式配置不可写，请到“数据与恢复”预览完整V2配置或有效备份；不会覆盖损坏或较新版本。</p>
    </form>
  </section>
</template>
<style scoped>
.settings { display:grid;gap:var(--we-space-4); }
h2 { font-size:22px; } h3 { font-size:var(--we-text-title); }
.settings-group-label { display:flex;align-items:center;gap:var(--we-space-2);flex-wrap:wrap; }
.settings-fields { border:0;padding:0;margin:0;min-width:0;display:grid;gap:var(--we-space-4); }
.settings-common { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-4);align-items:start; }.settings-schedule { grid-column:1 / -1; }.settings-time-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-2);}.settings-more{border-top:1px solid var(--we-border);padding-top:var(--we-space-3)}summary{cursor:pointer;min-height:36px;line-height:36px;font-weight:600}.settings-more[open]{display:grid;gap:var(--we-space-3)}
.settings-expected-fields { border:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--we-space-2);align-items:end; }.settings-expected-fields > .we-button { align-self:center; }.settings-expected .we-muted{margin-top:var(--we-space-1)}
.settings-panel { display:grid;gap:var(--we-space-3); }
.settings-panel > label:not(.we-check), .settings-record > label { display:grid;gap:var(--we-space-1); }
.settings-panel .we-control { max-width:100%;width:100%; }
.settings-checks { display:flex;flex-wrap:wrap;gap:var(--we-space-2); }
fieldset { border:1px solid var(--we-border);border-radius:var(--we-radius-control);min-width:0; }
.settings-record { border:1px solid var(--we-border);border-radius:var(--we-radius-control);padding:var(--we-space-3);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--we-space-2); }
.settings-actions { display:flex;gap:var(--we-space-2);flex-wrap:wrap;align-items:center;margin-top:var(--we-space-5);padding-top:var(--we-space-3);border-top:1px solid var(--we-border); }
.settings-deferred { color:var(--we-warning-text);font-size:var(--we-text-small); }
.settings-override { display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--we-space-2); }
.calendar-year { align-items:flex-start; }.calendar-year small { display:block;font-size:var(--we-text-small);color:var(--we-muted);overflow-wrap:anywhere; }
@media(max-width:520px){.settings-record,.settings-common,.settings-time-pair,.settings-expected-fields{grid-template-columns:minmax(0,1fr)}}
</style>
