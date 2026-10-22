<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
import MoyuIllustration from './MoyuIllustration.vue'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null),trackWidth=ref(0),fishWidth=ref(84),transition=ref(false)
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined,skipNextMove=true
watch(()=>props.animate,()=>{transition.value=false;skipNextMove=true},{flush:'sync'})
watch(()=>props.percent,()=>{transition.value=props.animate&&!skipNextMove;skipNextMove=false},{flush:'sync'})
onMounted(()=>{
  const measure=()=>{transition.value=false;trackWidth.value=track.value?.clientWidth??0;fishWidth.value=fish.value?.offsetWidth??84}
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish],()=>{observer!.disconnect();if(track.value)observer!.observe(track.value);if(fish.value)observer!.observe(fish.value);measure()},{immediate:true,flush:'post'})
})
onBeforeUnmount(()=>{stopObserving?.();observer?.disconnect()})
</script>
<template>
  <div class="fish-progress">
    <progress v-if="ratio!==null" class="fish-progress-native" :value="ratio*100" max="100" aria-label="有效工作进度"></progress>
    <div v-if="ratio!==null" ref="track" class="fish-track" :class="{'fish-track--flowing':animate}">
      <div class="fish-water" aria-hidden="true"><div class="fish-fill" :style="{width:`${ratio*100}%`}"><svg class="fish-surface" viewBox="0 0 1200 14" preserveAspectRatio="none"><path d="M0 6 Q75 1 150 6 T300 6 T450 6 T600 6 T750 6 T900 6 T1050 6 T1200 6 V14 H0Z" /></svg></div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}" aria-hidden="true"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
      <span class="fish-readout" aria-hidden="true">{{ percent?.toFixed(1).replace(/\.0$/,'') }}%</span>
    </div>
    <div v-if="ratio!==null" class="fish-endpoints" aria-hidden="true"><span>上班</span><span>下班</span></div>
    <div v-else class="fish-idle"><span class="fish-idle-mascot"><MoyuIllustration :playing="false" /></span><span>无工作进度</span></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:108px;width:100%;container-type:inline-size;--fish-water-color:var(--we-water);}
.fish-water{position:absolute;top:52px;height:52px;left:0;right:0;border-radius:4px 4px var(--we-radius-card) var(--we-radius-card);box-shadow:inset 0 -1px 0 var(--we-border);background:var(--we-subtle);overflow:hidden;}
.fish-fill{height:calc(100% - 6px);top:6px;background:linear-gradient(180deg,var(--we-water),var(--we-water-deep));position:relative;clip-path:inset(-12px 0 0);}
/* Two identical track-wide periods translate right by one period. Pause keeps phase. */
.fish-surface{position:absolute;top:-12px;left:0;width:200cqw;height:14px;fill:var(--fish-water-color);animation:water-drift 12s linear infinite;animation-play-state:paused;}
.fish-track--flowing .fish-surface{animation-play-state:running;will-change:transform;}
.fish-marker{position:absolute;top:0;left:0;display:block;width:84px;max-width:100%;aspect-ratio:226/217;}
.fish-readout{position:absolute;top:82px;left:50%;transform:translateX(-50%);color:var(--we-text);font:650 20px/22px var(--we-font-numeric);font-variant-numeric:tabular-nums;white-space:nowrap;}
.fish-endpoints{display:flex;justify-content:space-between;color:var(--we-muted);font-size:var(--we-text-small);}
.fish-marker--moving{transition:transform 250ms cubic-bezier(.23,1,.32,1);}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle-mascot :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{min-height:108px;display:flex;align-items:center;justify-content:center;gap:var(--we-space-3);color:var(--we-muted);font-size:var(--we-text-small);}
.fish-idle-mascot{width:40px;flex:none;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes water-drift{from{transform:translateX(-50%)}to{transform:translateX(0)}}
.workday-ui[data-reduced-motion="true"] .fish-track .fish-surface{animation:water-drift 12s linear infinite!important;animation-play-state:paused!important;will-change:auto;}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot{animation:none!important;}}
@media(prefers-reduced-motion:reduce){.fish-track .fish-surface{animation:water-drift 12s linear infinite!important;animation-play-state:paused!important;will-change:auto;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;box-shadow:none;}.fish-track{--fish-water-color:Highlight;}.fish-fill{background:Highlight;}.fish-fill,.fish-surface{forced-color-adjust:none;}.fish-readout{color:CanvasText;background:Canvas;}}
</style>
