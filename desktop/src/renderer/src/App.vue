<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { CalendarDatasetMetadata, DashboardSnapshot } from '../../shared/contracts'
import DashboardView from './views/DashboardView.vue'
import SettingsView from './views/SettingsView.vue'
import { createSettingsController } from './ui/settings-controller'
import { useTheme } from './composables/useTheme'

const api=window.workdayV2,host=ref<HTMLElement|null>(null),settingsOpen=ref(false),loading=ref(true),snapshot=shallowRef<DashboardSnapshot|null>(null),metadata=ref<CalendarDatasetMetadata[]>([])
const dataBusy=ref(false)
const error=ref(''),confirmLeave=ref(false),dialogRef=ref<HTMLElement|null>(null),leaveOrigin=ref<HTMLElement|null>(null)
const controller=createSettingsController(api,()=>{state.value=structuredClone(controller.state)})
const state=shallowRef(structuredClone(controller.state))
const preferences=computed(()=>settingsOpen.value?state.value.editor.appearance:state.value.session?.saved?.appearance??{mode:'system' as const,accent:'ocean' as const,reduceMotion:false})
useTheme(host,preferences)
const pending=computed(()=>state.value.pending>0||state.value.unsynced||state.value.busy||dataBusy.value||loading.value)
const canSave=computed(()=>['missing','ready'].includes(state.value.session?.configurationStatus??'ready'))
const errorText=computed(()=>{const value=state.value.error;if(!value)return error.value
  if(value.code==='IO_DENIED')return '无法保存，目录不可写或文件被占用。旧配置和输入保留；请检查权限、关闭占用程序后重试。'
  if(value.code==='IO_BUSY')return '操作仍在处理中或文件被占用，请稍后重试；保存不会被强行中断。'
  if(value.code==='VALIDATION')return '设置未保存，请检查下方标注的日期、时间区间和数值。'
  return value.code==='REVISION_CONFLICT'?'配置修订冲突（期望 '+value.expectedRevision+'，当前 '+value.actualRevision+'）。输入已保留，未覆盖；请比较来源后重新预览导入，或放弃并重开程序读取磁盘版本。':value.message
})
async function load(){const result=await controller.load();if(!result.ok)error.value=result.error.message;const calendars=await api.calendar.readMetadata();if(calendars.ok)metadata.value=calendars.data}
async function refreshSnapshot(){const result=await api.snapshot.read();snapshot.value=result.ok?result.data:null}
async function saved(){if(await controller.save()){error.value='';await refreshSnapshot()}}
async function leave(){if(state.value.busy)return;const synced=await controller.flush();if(!synced.ok){error.value=synced.error.message;return}if(state.value.dirty){leaveOrigin.value=document.activeElement as HTMLElement;confirmLeave.value=true;await nextTick();dialogRef.value?.querySelector<HTMLButtonElement>('button')?.focus()}else settingsOpen.value=false}
async function chooseLeave(choice:'save'|'discard'|'continue'){if(state.value.busy)return;if(choice==='save'&&!await controller.save())return;if(choice==='discard'&&!await controller.discard())return;confirmLeave.value=false;if(choice!=='continue')settingsOpen.value=false;await nextTick();leaveOrigin.value?.focus()}
async function quit(){const synced=await controller.flush();if(!synced.ok){error.value=synced.error.message;return}if(pending.value)return;const result=await api.app.quit();if(!result.ok&&result.error.code!=='CANCELLED')error.value=result.error.message}
async function imported(){await load();await refreshSnapshot();error.value='';}
function trap(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();void chooseLeave('continue');return}if(event.key!=='Tab')return;const buttons=[...dialogRef.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(!buttons.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
onMounted(async()=>{
  try{await load();settingsOpen.value=!state.value.session?.saved||state.value.dirty
    const subscribed=await api.snapshot.subscribe(result=>{if(!result.ok){snapshot.value=null;return}const value=result.data;if(value.configRevision<(state.value.session?.saved?.revision??0))return;if(snapshot.value&&value.sequence<snapshot.value.sequence)return;snapshot.value=value})
    if(!subscribed.ok)error.value=subscribed.error.message
  }catch{error.value='正式界面初始化失败，请保留配置后重开。'}finally{loading.value=false}
})
onBeforeUnmount(()=>{controller.dispose();void api.snapshot.unsubscribe()})
</script>
<template>
  <div ref="host" class="workday-ui app-shell" data-workday-root :data-pending="String(pending)">
    <div class="app-content" :inert="confirmLeave">
      <header class="app-header"><div><h1>Workday Escape</h1><p class="we-muted">上班摸一会，下班更近一步</p></div><div class="app-actions"><button v-if="!settingsOpen" type="button" class="we-button" :disabled="loading" @click="settingsOpen=true">设置</button><button type="button" class="we-button" :disabled="pending" @click="quit">退出</button></div></header>
      <p v-if="errorText" role="alert" class="app-error">{{ errorText }}</p>
      <button v-if="state.unsynced && state.pending===0" type="button" class="we-button" @click="controller.edit(state.editor)">重试同步草稿</button>
      <p v-if="state.notice" role="status" class="app-notice">{{ state.notice }}</p>
      <p v-if="loading" role="status">正在读取正式配置…</p>
      <main v-else>
        <section v-if="settingsOpen" class="we-surface app-settings">
          <SettingsView :model="state.editor" :issues="state.issues" :busy="state.busy||dataBusy" :dirty="state.dirty||state.pending>0" :initialized="!!state.session?.saved" :can-save="canSave" :metadata="metadata" :api="api" @change="controller.edit" @save="saved" @cancel="leave" @imported="imported" @data-busy="value=>dataBusy=value" />
          <p v-if="state.session?.configurationStatus==='recoverable'" class="app-error">当前只读使用有效备份，请到数据页预览并确认恢复；损坏源文件已保留。</p>
        </section>
        <DashboardView v-else :snapshot="snapshot" />
      </main>
    </div>
    <div v-if="confirmLeave" class="app-modal-backdrop"><section ref="dialogRef" class="we-surface app-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title" @keydown="trap"><h2 id="leave-title">设置尚未保存</h2><p>保存后返回，或明确放弃本次修改。</p><div class="app-actions"><button type="button" class="we-button we-button--primary" :disabled="state.busy" @click="chooseLeave('save')">保存</button><button type="button" class="we-button" :disabled="state.busy" @click="chooseLeave('discard')">放弃</button><button type="button" class="we-button" :disabled="state.busy" @click="chooseLeave('continue')">继续编辑</button></div><p v-if="errorText" role="alert">{{ errorText }}</p></section></div>
  </div>
</template>
