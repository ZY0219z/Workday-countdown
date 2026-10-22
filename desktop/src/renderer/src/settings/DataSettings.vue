<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { ImportField, ImportPreview, JsonValue, MainWindowApi, MigrationSource } from '../../../shared/contracts'
const props=withDefaults(defineProps<{api:MainWindowApi;blocked:boolean;recoveryOnly?:boolean}>(),{recoveryOnly:false})
const emit=defineEmits<{applied:[];busy:[value:boolean]}>()
const kind=ref<MigrationSource>(props.recoveryOnly?'v2':'python-v1'),preview=shallowRef<ImportPreview|null>(null),selected=ref<ImportField[]>([]),shiftDate=ref(''),reapply=ref(false),busy=ref(false),message=ref(''),failed=ref(false)
watch(busy,value=>emit('busy',value),{flush:'sync'})
const labels:Record<ImportField,string>={
  'employee.startDate':'入职日期','schedule.workWeek':'每周工作日','schedule.startTime':'上班时间','schedule.endTime':'下班时间','schedule.crossMidnight':'跨夜班次','schedule.breaks':'午休 / 休息区间','salary.day':'每月发薪日','salary.nonWorkingPolicy':'非工作日发薪策略','salary.missingDayPolicy':'短月处理','salary.showPaydayAsToday':'发薪当天提示','overtime.entries':'按班次日期的加班记录','calendar.region':'日历地区','calendar.enabledYears':'启用年度','calendar.overrides':'自定义日期覆盖','appearance.mode':'显示模式','appearance.accent':'主题配色','appearance.reduceMotion':'减少动画','desktop.closeAction':'关闭窗口偏好','desktop.miniEnabled':'迷你窗口偏好','desktop.alwaysOnTop':'迷你置顶偏好','desktop.displayMode':'窗口切换方式','desktop.bounds':'窗口位置','desktop.tray.firstHideNoticeAcknowledged':'首次托盘提示状态'
}
const scalar:Record<string,string>={system:'跟随系统',light:'亮色',dark:'深色',ocean:'海蓝',coral:'珊瑚',delay:'顺延',advance:'提前',none:'不调整',monthEnd:'当月最后一天',hideToTray:'隐藏到托盘',quit:'退出',exclusive:'互斥显示',CN:'中国大陆',work:'工作',rest:'休息'}
function valueText(field:ImportField,value:JsonValue):string{
  if(value===null)return '未设置'
  if(typeof value==='boolean')return value?'是':'否'
  if(typeof value==='string')return scalar[value]??value
  if(typeof value==='number')return String(value)
  if(Array.isArray(value)){
    if(field==='schedule.workWeek')return value.map(x=>`周${['','一','二','三','四','五','六','日'][Number(x)]??'?'}`).join('、')||'无'
    return value.map(x=>typeof x==='object'&&x!==null&&!Array.isArray(x)?field==='overtime.entries'?`${x.shiftDate}：${x.minutes}分钟`:field==='schedule.breaks'?`${x.startDayOffset===1?'次日 ':''}${x.startTime}–${x.endDayOffset===1?'次日 ':''}${x.endTime}`:JSON.stringify(x):String(x)).join('；')||'无'
  }
  if(field==='calendar.overrides')return Object.entries(value).map(([date,day])=>`${date}：${day==='work'?'工作':'休息'}`).join('；')||'无'
  return '已有窗口位置数据（只在选择后导入）'
}
const undatedSelected=computed(()=>preview.value?.undatedOvertimeMinutes!==null&&selected.value.includes('overtime.entries'))
async function cancel(){if(!preview.value)return;const token=preview.value.previewToken;preview.value=null;selected.value=[];const result=await props.api.data.cancelImport({previewToken:token});if(!result.ok){message.value='预览取消，未应用任何数据。';failed.value=false}}
async function open(recovery=false){if(props.blocked||busy.value)return;busy.value=true;message.value='';failed.value=false
  try{await cancel();const result=recovery?await props.api.data.previewRecovery():await props.api.data.previewImport({sourceKind:kind.value})
    if(!result.ok){message.value=result.error.code==='CANCELLED'?'已取消，原有数据未改变。':result.error.message;failed.value=result.error.code!=='CANCELLED';return}
    preview.value=result.data;selected.value=result.data.choices.filter(choice=>choice.issues.length===0&&!(choice.field==='overtime.entries'&&result.data.undatedOvertimeMinutes!==null)).map(choice=>choice.field);shiftDate.value='';reapply.value=false
  }catch{message.value='预览调用失败，未确认任何导入；请保留源文件后重试。';failed.value=true}finally{busy.value=false}
}
async function apply(){if(!preview.value||busy.value||props.blocked)return;busy.value=true;message.value='正在校验、备份并应用，请稍候。';failed.value=false
  try{const result=await props.api.data.applyImport({previewToken:preview.value.previewToken,expectedRevision:preview.value.expectedRevision,selectedFields:[...selected.value],undatedOvertimeShiftDate:undatedSelected.value?shiftDate.value||null:null,confirmPreviouslyImported:reapply.value})
    if(!result.ok){message.value=result.error.code==='REVISION_CONFLICT'?'配置修订已变化，请取消后重新预览。':result.error.message;failed.value=true;return}
    preview.value=null;message.value='导入 / 恢复成功，源文件保持不变。';emit('applied')
  }catch{message.value='无法确认导入结果。请先检查当前配置，再取消并重新预览，不自动重复应用。';failed.value=true}finally{busy.value=false}
}
async function exportSaved(){busy.value=true;failed.value=false;try{const result=await props.api.data.export({kind:'v2-config'});message.value=result.ok?'已导出保存的V2配置（含历史加班，不含缓存和私有路径）。':result.error.message;failed.value=!result.ok&&result.error.code!=='CANCELLED'}catch{message.value='无法确认导出结果，请检查选择的目标文件。';failed.value=true}finally{busy.value=false}}
onBeforeUnmount(()=>{if(preview.value)void props.api.data.cancelImport({previewToken:preview.value.previewToken}).catch(()=>{})})
</script>
<template>
  <section class="data-settings" aria-label="数据导入导出与恢复">
    <h3>{{ recoveryOnly?'安全恢复':'数据导入、导出与恢复' }}</h3><p v-if="recoveryOnly" class="we-muted">先只读预览，再确认要恢复的字段。只有校验通过后才可应用，不强制覆盖原文件。</p><p v-else class="we-muted">先只读预览，再明确选择字段确认。Python / POC来源分别选择，不自动合并、不修改源文件。首次未初始化时，完整V2可导入恢复；不完整旧配置需先完成首次设置。</p>
    <p v-if="blocked" class="data-warning">请先保存或明确放弃当前设置草稿，再进行数据操作。</p>
    <label v-if="!recoveryOnly">导入来源<select v-model="kind" class="we-control" :disabled="busy||!!preview"><option value="python-v1">Python V1</option><option value="electron-poc">Electron POC</option><option value="v2">正式 V2 配置</option></select></label>
    <div class="data-actions"><button type="button" class="we-button" :disabled="busy||blocked" @click="open(false)">{{ recoveryOnly?'预览完整 V2 配置':'选择配置并预览' }}</button><button type="button" class="we-button" :disabled="busy||blocked" @click="open(true)">预览最近有效备份</button><button v-if="!recoveryOnly" type="button" class="we-button" :disabled="busy||blocked" @click="exportSaved">导出已保存配置</button></div>
    <section v-if="preview" class="data-preview" aria-label="导入预览">
      <h4>请选择要应用的字段</h4><p class="we-muted">应用前将校验并备份，未选字段保留现有值。迷你窗需启用后主动进入，每次启动仍打开主窗口。</p>
      <div v-for="choice in preview.choices" :key="choice.field" class="data-choice">
        <label class="we-check"><input v-model="selected" type="checkbox" :value="choice.field" :disabled="busy||choice.issues.length>0" />{{ labels[choice.field] }}</label>
        <p>当前：{{ valueText(choice.field,choice.current) }}</p><p>导入：{{ valueText(choice.field,choice.incoming) }}</p>
        <p v-for="(issue,i) in choice.issues" :key="i" class="data-warning">{{ issue.message }}</p>
      </div>
      <p v-for="(note,i) in preview.notes" :key="i" class="data-warning">{{ note.message }}</p>
      <p v-if="preview.undatedOvertimeMinutes!==null" class="data-warning">旧加班 {{ preview.undatedOvertimeMinutes }} 分钟没有日期，默认跳过。选中加班字段后，必须明确指定有效班次；不会归属今天。</p>
      <label v-if="undatedSelected">旧加班所属班次日期<input v-model="shiftDate" type="date" class="we-control" :disabled="busy" /></label>
      <label v-if="preview.alreadyProcessed" class="we-check"><input v-model="reapply" type="checkbox" :disabled="busy" />来源已处理，明确允许再次应用</label>
      <div class="data-actions"><button type="button" class="we-button we-button--primary" :disabled="busy||!selected.length||(undatedSelected&&!shiftDate)||(preview.alreadyProcessed&&!reapply)" @click="apply">确认备份并应用所选字段</button><button type="button" class="we-button" :disabled="busy" @click="cancel">取消预览</button></div>
    </section>
    <p v-if="message" :role="failed?'alert':'status'">{{ message }}</p>
  </section>
</template>
<style scoped>
.data-settings { display:grid;gap:var(--we-space-3); }.data-settings label:not(.we-check) { display:grid;gap:var(--we-space-1); }
.data-actions { display:flex;flex-wrap:wrap;gap:var(--we-space-2); }.data-preview { display:grid;gap:var(--we-space-3);border-top:1px solid var(--we-border);padding-top:var(--we-space-4); }
.data-choice { border:1px solid var(--we-border);border-radius:var(--we-radius-control);padding:var(--we-space-2);overflow-wrap:anywhere; }.data-choice p { font-size:var(--we-text-small); }
.data-warning { color:var(--we-warning-text);font-size:var(--we-text-small); }[role=alert] { color:var(--we-danger-text); }
</style>
