<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { CalendarDatasetMetadata, DashboardSnapshot } from '../../shared/contracts'
import DashboardView from './views/DashboardView.vue'
import SettingsView from './views/SettingsView.vue'
import AppTitle from './components/AppTitle.vue'
import { createSettingsController } from './ui/settings-controller'
import { useTheme } from './composables/useTheme'
import { useWindowVisibility } from './composables/useWindowVisibility'
import { useSnapshotFeed } from './composables/useSnapshotFeed'
import type { EditorSettings } from './ui/settings-editor'

const api=window.workdayV2,host=ref<HTMLElement|null>(null),settingsOpen=ref(false),loading=ref(true),snapshot=shallowRef<DashboardSnapshot|null>(null),metadata=ref<CalendarDatasetMetadata[]>([])
const dataBusy=ref(false)
const composing=ref(false),quitting=ref(false)
const validationAttempt=ref(0)
const error=ref(''),confirmLeave=ref(false),quitAfterLeave=ref(false),dialogRef=ref<HTMLElement|null>(null),leaveOrigin=ref<HTMLElement|null>(null)
const controller=createSettingsController(api,()=>{state.value=structuredClone(controller.state)})
const state=shallowRef(structuredClone(controller.state))
function positionToast(element:Element){
  const toast=element as HTMLElement
  toast.style.removeProperty('top')
  const box=toast.getBoundingClientRect(),inset=parseFloat(getComputedStyle(toast).top)
  // Measure once after horizontal centering; keep the title, errors and visible
  // controls clear without adding timers/listeners or moving page content.
  const controls=[...host.value!.querySelectorAll<HTMLElement>('.app-title,.app-error,.settings input,.settings button,.app-header button,.app-modal button')]
    .map(control=>({rect:control.getBoundingClientRect(),gap:control.matches('.app-title')?2:8})).filter(({rect})=>rect.right>box.left-8&&rect.left<box.right+8&&rect.bottom>0&&rect.top<innerHeight).sort((a,b)=>a.rect.top-b.rect.top)
  let top=inset
  for(const {rect,gap} of controls){
    if(top+box.height+gap<=rect.top)break
    if(top<rect.bottom+gap)top=rect.bottom+gap
  }
  if(top+box.height<=innerHeight-inset)toast.style.top=`${top}px`
}
watch(settingsOpen,()=>{const toast=host.value?.querySelector('.app-toast');if(toast)positionToast(toast)},{flush:'post'})
const preferences=computed(()=>settingsOpen.value?state.value.editor.appearance:state.value.session?.saved?.appearance??state.value.editor.appearance)
const reduceMotion=useTheme(host,preferences),windowVisible=useWindowVisibility(api.window)
const syncing=computed(()=>state.value.pending>0||state.value.busy||dataBusy.value||loading.value||composing.value)
const pending=computed(()=>syncing.value||state.value.unsynced)
const defaultPending=computed(()=>state.value.session?.defaultPersistence?.status==='pending')
const canSave=computed(()=>!!state.value.session&&['missing','ready'].includes(state.value.session.configurationStatus??'unloaded'))
const errorText=computed(()=>{if(error.value)return error.value;const value=state.value.error;if(!value)return ''
  if(value.code==='IO_DENIED')return '无法保存，目录不可写或文件被占用。旧配置和输入保留；请检查权限、关闭占用程序后重试。'
  if(value.code==='IO_BUSY')return '操作仍在处理中或文件被占用，请稍后重试；保存不会被强行中断。'
  if(value.code==='VALIDATION')return '设置未保存，请检查下方标注的日期、时间区间和数值。'
  return value.code==='REVISION_CONFLICT'?'配置修订冲突（期望 '+value.expectedRevision+'，当前 '+value.actualRevision+'）。输入已保留，未覆盖；请比较来源后重新预览导入，或放弃并重开程序读取磁盘版本。':value.message
})
async function load(){const result=await controller.load();if(!result.ok){error.value='IPC 初始化失败，尚未读取 Main 草稿：'+result.error.message;return false}error.value='';const calendars=await api.calendar.readMetadata();if(calendars.ok)metadata.value=calendars.data;return true}
async function refreshSnapshot(){const result=await api.snapshot.read();snapshot.value=result.ok?result.data:null}
async function openSettings(){if(pending.value)return;error.value='';controller.clearNotice();const loaded=await controller.load();if(!loaded.ok)error.value='读取设置失败，输入保留：'+loaded.error.message;settingsOpen.value=true}
let traySettingsRequested=false
function openTraySettings(){
  if(!traySettingsRequested)return
  if(settingsOpen.value){traySettingsRequested=false;return}
  if(pending.value||confirmLeave.value)return
  traySettingsRequested=false;void openSettings()
}
const stopTraySettings=api.window.onOpenSettings?.(()=>{traySettingsRequested=true;openTraySettings()})
watch([pending,settingsOpen,confirmLeave],openTraySettings)
function edit(value:EditorSettings){error.value='';controller.edit(value)}
async function saved(){if(composing.value){error.value='请先完成输入法组合输入，再保存设置。';return}error.value='';if(await controller.save()){await refreshSnapshot();settingsOpen.value=false}else validationAttempt.value++}
async function leave(){controller.clearNotice();if(state.value.busy)return;if(composing.value){error.value='请先完成输入法组合输入，再离开设置。';return}error.value='';const synced=await controller.flush();if(!synced.ok){error.value='草稿同步失败，输入保留：'+synced.error.message;if(!state.value.dirty&&!state.value.unsynced)return}if(state.value.dirty||state.value.unsynced){quitAfterLeave.value=false;leaveOrigin.value=document.activeElement as HTMLElement;confirmLeave.value=true;await nextTick();dialogRef.value?.querySelector<HTMLButtonElement>('button')?.focus()}else settingsOpen.value=false}
async function chooseLeave(choice:'save'|'discard'|'continue'){if(state.value.busy)return;error.value='';if(choice==='save'){if(!await controller.save())return;await refreshSnapshot()}if(choice==='discard'&&!await controller.discard())return;confirmLeave.value=false;if(choice!=='continue'){if(quitAfterLeave.value){quitAfterLeave.value=false;await quit()}else settingsOpen.value=false}await nextTick();leaveOrigin.value?.focus()}
async function quit(){
  if(quitting.value)return;quitting.value=true;controller.clearNotice();error.value=''
  try{
    if(state.value.session){const synced=await controller.flush();if(!synced.ok){error.value='草稿同步失败，输入保留：'+synced.error.message;if(state.value.dirty||state.value.unsynced){quitAfterLeave.value=true;leaveOrigin.value=document.activeElement as HTMLElement;confirmLeave.value=true;await nextTick();dialogRef.value?.querySelector<HTMLButtonElement>('button')?.focus()}return}}
    if(pending.value){error.value='输入正在同步或保存，请稍后再退出程序。';return}
    const result=await api.app.quit();if(!result.ok&&result.error.code!=='CANCELLED')error.value='退出程序失败：'+result.error.message
  }catch{error.value='退出程序调用失败，应用与草稿保留。请重试；不会直接终止进程。'}finally{quitting.value=false}
}
async function imported(){await load();await refreshSnapshot();error.value='';}
function trap(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();void chooseLeave('continue');return}if(event.key!=='Tab')return;const buttons=[...dialogRef.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(!buttons.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
async function miniMode(){
  error.value=''
  if(composing.value||confirmLeave.value){error.value='请先完成输入或当前确认，再切换迷你模式。';return}
  if(!state.value.session?.saved?.desktop.miniEnabled){error.value='请在设置中启用迷你窗并保存。';return}
  const synced=await controller.flush();await nextTick()
  if(!synced.ok||pending.value){error.value='设置尚未同步，输入保留；请完成同步后再切换。';return}
  const result=await api.window.perform({action:'showMini'});if(!result.ok)error.value='迷你模式未打开，主窗口与设置保留；请完成同步后重试。'
}
let refreshingDefaults=false,defaultsAgain=false
const feed=useSnapshotFeed(api.snapshot,()=>windowVisible.value||defaultPending.value,result=>{if(!result.ok){snapshot.value=null;return}const value=result.data;if(value.configRevision<(state.value.session?.saved?.revision??0))return;if(snapshot.value&&value.sequence<snapshot.value.sequence)return;const boundary=snapshot.value&&(value.localDate!==snapshot.value.localDate||value.timeZoneId!==snapshot.value.timeZoneId||value.activeShift?.shiftDate!==snapshot.value.activeShift?.shiftDate);snapshot.value=value
      if((state.value.session?.defaultPersistence&&!state.value.dirty||settingsOpen.value&&boundary&&!state.value.notice)&&!composing.value&&state.value.pending===0&&!state.value.unsynced&&!state.value.busy){
        defaultsAgain=true
        if(!refreshingDefaults){refreshingDefaults=true;void(async()=>{do{defaultsAgain=false;await controller.load()}while(defaultsAgain)})().finally(()=>{refreshingDefaults=false})}
      }
})
async function initialize(){
  loading.value=true;error.value=''
  try{if(!await load()){settingsOpen.value=true;return}settingsOpen.value=state.value.dirty||(!state.value.session?.saved&&!state.value.session?.defaultPersistence)
    await feed.start()
  }catch{settingsOpen.value=true;error.value='IPC 初始化失败，请重新连接配置；尚未取得草稿时不能编辑或保存。'}finally{loading.value=false}
}
onMounted(initialize)
onBeforeUnmount(()=>{stopTraySettings?.();controller.dispose();void api.snapshot.unsubscribe()})
</script>
<template>
  <div ref="host" class="workday-ui app-shell" data-workday-root :data-pending="String(pending)" @compositionstart="composing=true" @compositionend="composing=false">
    <div class="app-content" :class="{'app-content--dashboard':!settingsOpen&&!loading}" :inert="confirmLeave">
      <header class="app-header"><AppTitle /><div class="app-header-actions"><button type="button" class="we-button app-mini" :disabled="loading||syncing||defaultPending" @click="miniMode">迷你模式</button><button type="button" class="we-button app-menu" :aria-label="settingsOpen?'返回倒计时':'设置'" :title="settingsOpen?'返回倒计时':'设置'" :aria-expanded="settingsOpen" aria-controls="settings-panel" :disabled="loading||defaultPending" @click="settingsOpen?leave():openSettings()"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 5h12M4 10h12M4 15h12" /></svg></button></div></header>
      <p v-if="errorText && (error || state.error?.code!=='VALIDATION' || !state.issues.length)" role="alert" class="app-error">{{ errorText }}</p>
      <button v-if="!loading&&!state.session" type="button" class="we-button" @click="initialize">重新连接配置</button>
      <button v-if="state.unsynced && state.pending===0" type="button" class="we-button" @click="error='';controller.retry()">重试同步草稿</button>
      <p v-if="loading" role="status">正在读取正式配置…</p>
      <p v-if="defaultPending" class="we-muted app-default-note" role="status">正在保存默认设置…</p>
      <p v-else-if="state.session?.defaultPersistence?.status==='failed'" class="app-error" role="alert">默认设置尚未保存，本次仍可查看倒计时。请在设置中重试保存。</p>
      <main v-if="!loading" :class="{'app-main--dashboard':!settingsOpen}">
        <section v-if="settingsOpen" id="settings-panel" class="we-surface app-settings">
          <SettingsView :expected-end="state.expectedEnd" :expected-end-input="state.expectedEndInput" :quit-disabled="syncing||quitting||defaultPending" :model="state.editor" :issues="state.issues" :busy="state.busy||dataBusy||defaultPending" :dirty="state.dirty||state.pending>0" :initialized="!!state.session?.saved" :default-unpersisted="!!state.session?.defaultPersistence" :session-ready="!!state.session" :validation-attempt="validationAttempt" :can-save="canSave" :metadata="metadata" :api="api" @expected-end="value=>{error='';controller.editExpectedEnd(value)}" @change="edit" @save="saved" @invalid="issue=>controller.invalidInput(issue)" @cancel="leave" @quit="quit" @imported="imported" @data-busy="value=>dataBusy=value" />
          <p v-if="state.session?.configurationStatus==='recoverable'" class="app-error">当前只读使用有效备份，请在安全恢复区预览并确认恢复；损坏源文件已保留。</p>
        </section>
        <DashboardView v-else :snapshot="snapshot" :motion-allowed="windowVisible&&!reduceMotion" />
      </main>
    </div>
    <Transition name="app-toast" @enter="positionToast">
      <div v-if="state.notice && state.noticeKind" class="app-toast" :class="{'app-toast--error':state.noticeKind==='error'}" :role="state.noticeKind==='error'?'alert':'status'" aria-atomic="true">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><path v-if="state.noticeKind==='success'" d="m8 12 2.5 2.5L16 9" /><path v-else d="m9 9 6 6m0-6-6 6" /></svg>
        <span>{{ state.notice }}</span>
      </div>
    </Transition>
    <div v-if="confirmLeave" class="app-modal-backdrop"><section ref="dialogRef" class="we-surface app-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title" @keydown="trap"><h2 id="leave-title">设置尚未保存</h2><p>{{ quitAfterLeave?'保存后退出，或明确放弃本次修改。':'保存后返回，或明确放弃本次修改。' }}</p><div class="app-actions"><button type="button" class="we-button we-button--primary" :disabled="state.busy" @click="chooseLeave('save')">保存</button><button type="button" class="we-button" :disabled="state.busy" @click="chooseLeave('discard')">放弃</button><button type="button" class="we-button" :disabled="state.busy" @click="chooseLeave('continue')">继续编辑</button></div><p v-if="errorText" role="alert">{{ errorText }}</p></section></div>
  </div>
</template>
