<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,shallowRef} from 'vue'
import type {DashboardSnapshot,MiniWindowApi,WindowPresentation,MiniWindowCommand} from '../../shared/contracts'
import {useTheme} from './composables/useTheme'
import {useWindowVisibility} from './composables/useWindowVisibility'
import {useSnapshotFeed} from './composables/useSnapshotFeed'
import {badgePresentation,countdownPresentation} from './ui/presentation'
import {durationText,wallLabel,qualityText} from './ui/dashboard-display'

const {api}=defineProps<{api:MiniWindowApi}>()
const host=ref<HTMLElement|null>(null),snapshot=shallowRef<DashboardSnapshot|null>(null),preferences=shallowRef<WindowPresentation|null>(null),error=ref(''),busy=ref(false)
const visible=useWindowVisibility(api.window)
useTheme(host,()=>preferences.value?.appearance??{mode:'system',accent:'ocean',reduceMotion:true})
const feed=useSnapshotFeed(api.snapshot,visible,result=>{const old=snapshot.value;if(result.ok&&(!old||result.data.sequence>=old.sequence))snapshot.value=result.data;else if(!result.ok)snapshot.value=null})
const badge=computed(()=>badgePresentation(snapshot.value?.state??'incomplete'))
const display=computed(()=>countdownPresentation(snapshot.value?.state??'incomplete',durationText(snapshot.value?.countdown?.seconds),snapshot.value?.countdown?.target))
const percent=computed(()=>snapshot.value?.progress?.percent??null)
const target=computed(()=>{const s=snapshot.value;if(!s?.countdown)return '';const wall=wallLabel(s.countdown.targetAt,s.timeZoneId);if(!wall)return '';return `${s.countdown.target==='workStart'?'上班':'下班'} ${wall.date!==s.localDate||s.activeShift?.shiftDate!==wall.date?wall.date+' ':''}${wall.time}`})
const warningDetail=computed(()=>{const s=snapshot.value;if(!s)return '数据暂不可用，请打开主窗口查看';const fields=['countdown','activeShift','progress'] as const;const relevant=s.warnings.filter(w=>w.affects.some(field=>fields.includes(field as typeof fields[number]))&&w.code!=='CURRENT_RULE_ESTIMATE');if(relevant.length)return relevant.map(w=>w.message).join('；');return s.countdown?.quality.approximate?qualityText(s.countdown.quality):s.progress?.quality.approximate?qualityText(s.progress.quality):''})
const warning=computed(()=>{const s=snapshot.value;if(!s)return '数据暂不可用，请查看主窗口';if(!warningDetail.value)return '';const q=s.countdown?.quality??s.progress?.quality;const years=[...new Set([...(q?.incompleteYears??[]),...s.warnings.filter(w=>w.affects.some(f=>['countdown','activeShift','progress'].includes(f))).flatMap(w=>w.years)])];return q?.approximate||years.length?`估算 · ${years.length?years.join('、')+'年日历不完整':'数据不完整'}`:'计算异常，请查看主窗口'})
async function command(value:MiniWindowCommand){if(busy.value)return;busy.value=true;error.value='';try{const result=await api.window.perform(value);if(!result.ok)error.value=value.action==='hideMini'?'暂时不能隐藏，请打开主窗口。':'操作未完成，请重试或从托盘打开主窗口。';else if(value.action==='setMiniTop'){const read=await api.window.readPresentation();if(read.ok&&(!preferences.value||read.data.sequence>=preferences.value.sequence))preferences.value=read.data}}catch{error.value='窗口操作失败，请从托盘打开主窗口。'}finally{busy.value=false}}
onMounted(async()=>{await api.window.subscribePresentation(result=>{if(result.ok&&(!preferences.value||result.data.sequence>preferences.value.sequence))preferences.value=result.data});await feed.start()})
onBeforeUnmount(()=>{void api.window.unsubscribePresentation()})
</script>
<template>
  <section ref="host" class="workday-ui mini-shell" aria-label="迷你倒计时" :data-visible="visible">
    <header class="mini-header">
      <span class="mini-state" :data-tone="badge.tone" role="status">{{ badge.label }}</span>
      <nav aria-label="迷你窗口操作"><button type="button" :aria-pressed="preferences?.alwaysOnTop??false" :disabled="busy||!preferences" @click="command({action:'setMiniTop',enabled:!preferences?.alwaysOnTop})">置顶</button><button type="button" aria-label="隐藏迷你窗" title="隐藏到托盘" :disabled="busy" @click="command({action:'hideMini'})">×</button></nav>
    </header>
    <div class="mini-countdown"><span class="mini-label">{{ display.heading }}</span><strong v-if="display.text" role="timer" aria-live="off">{{ display.text }}</strong><strong v-else class="mini-empty">{{ display.emptyLabel }}</strong></div>
    <div class="mini-bottom"><div class="mini-progress"><progress v-if="percent!==null" :value="percent" max="100" aria-label="工作进度" /><span>{{ percent===null?'无工作进度':percent.toFixed(1).replace(/\.0$/,'')+'%' }}</span></div><button type="button" class="mini-open" :disabled="busy" @click="command({action:'showMain'})">打开主窗口</button></div>
    <p v-if="error||warning||target" class="mini-note" :class="{'mini-warning':error||warning}" :title="[error,warningDetail,target].filter(Boolean).join('；')" :role="error?'alert':undefined">{{ [error,warning,target].filter(Boolean).join('；') }}</p>
  </section>
</template>
<style>
html,body,#app { margin:0;width:100%;height:100%;min-width:0; }
.mini-shell { min-height:100%;padding:6px 9px;border:1px solid var(--we-border);border-radius:var(--we-radius-card);display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere; }
.mini-header { display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:20px;app-region:drag;-webkit-app-region:drag;user-select:none; }
.mini-state { color:var(--we-positive-text);background:var(--we-positive-bg);font-size:11px;font-weight:650;border-radius:20px;padding:0 6px;white-space:nowrap; }
.mini-state[data-tone="neutral"] { color:var(--we-neutral-text);background:var(--we-neutral-bg); }
.mini-state[data-tone="warning"] { color:var(--we-warning-text);background:var(--we-warning-bg); }
.mini-state[data-tone="danger"] { color:var(--we-danger-text);background:var(--we-danger-bg); }
.mini-header nav { display:flex;gap:6px; }
.mini-shell button { font:inherit;font-size:11px;line-height:18px;min-height:20px;padding:0 5px;background:var(--we-surface);color:var(--we-text);border:1px solid var(--we-control-border);border-radius:5px;cursor:pointer;app-region:no-drag;-webkit-app-region:no-drag; }
.mini-shell button[aria-pressed="true"] { color:var(--we-button-text);background:var(--we-button);border-color:var(--we-button); }
.mini-shell button:focus-visible { outline:2px solid var(--we-accent);outline-offset:1px; }
.mini-countdown { display:flex;align-items:baseline;justify-content:space-between;gap:6px; }
.mini-label { font-size:10px;flex:none;color:var(--we-muted); }
.mini-countdown strong { font:650 clamp(24px,10vw,30px)/1.15 var(--we-font-numeric);font-variant-numeric:tabular-nums;letter-spacing:-.5px;white-space:nowrap; }
.mini-shell:has(.mini-warning) .mini-countdown strong:not(.mini-empty) { font-size:26px;line-height:1.05; }
.mini-countdown .mini-empty { font-size:14px;white-space:normal; }
.mini-bottom { display:flex;justify-content:space-between;align-items:center;gap:8px; }
.mini-progress { display:flex;align-items:center;gap:5px;min-width:0;flex:1;font-size:10px;color:var(--we-muted); }
.mini-progress progress { width:100%;min-width:20px;flex:1;height:5px;appearance:none;border:0;border-radius:5px;overflow:hidden;background:var(--we-track); }
.mini-progress progress::-webkit-progress-bar { background:var(--we-track); }.mini-progress progress::-webkit-progress-value { background:var(--we-accent); }
.mini-note { font-size:10px;line-height:1.3;color:var(--we-muted); }.mini-warning { color:var(--we-warning-text); }
@media (max-width:255px) { .mini-shell { padding:5px 7px; }.mini-countdown { flex-wrap:wrap;gap:0; }.mini-label{line-height:12px}.mini-countdown strong { line-height:1.1; }.mini-progress { font-size:10px; } }
@media (forced-colors:active) { .mini-shell,.mini-state { border:1px solid CanvasText; }.mini-state { color:CanvasText;background:Canvas; }.mini-progress progress { appearance:auto; } }
</style>
