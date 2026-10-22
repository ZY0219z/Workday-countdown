<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
import MoyuIllustration from './MoyuIllustration.vue'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null),trackWidth=ref(0),fishWidth=ref(40),transition=ref(false)
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined,skipNextMove=true
watch(()=>props.animate,()=>{transition.value=false;skipNextMove=true},{flush:'sync'})
watch(()=>props.percent,()=>{transition.value=props.animate&&!skipNextMove;skipNextMove=false},{flush:'sync'})
onMounted(()=>{
  const measure=()=>{transition.value=false;trackWidth.value=track.value?.clientWidth??0;fishWidth.value=fish.value?.offsetWidth??40}
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish],()=>{observer!.disconnect();if(track.value)observer!.observe(track.value);if(fish.value)observer!.observe(fish.value);measure()},{immediate:true,flush:'post'})
})
onBeforeUnmount(()=>{stopObserving?.();observer?.disconnect()})
</script>
<template>
  <div class="fish-progress">
    <progress v-if="ratio!==null" class="fish-progress-native" :value="ratio*100" max="100" aria-label="有效工作进度"></progress>
    <div v-if="ratio!==null" ref="track" class="fish-track">
      <div class="fish-water" aria-hidden="true"><div class="fish-fill" :style="{width:`${ratio*100}%`}"></div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
      <span class="fish-readout" aria-hidden="true">{{ percent?.toFixed(1).replace(/\.0$/,'') }}%</span>
    </div>
    <div v-else class="fish-idle"><span class="fish-idle-mascot"><MoyuIllustration :playing="false" /></span><span>无工作进度</span></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:68px;width:100%;}
.fish-water{position:absolute;top:49px;height:10px;left:0;right:0;border-radius:8px;background:var(--we-track);overflow:hidden;}
.fish-fill{height:100%;background:var(--we-accent);overflow:hidden;position:relative;}
.fish-marker{position:absolute;top:0;left:0;display:block;width:40px;max-width:100%;aspect-ratio:226/217;}
.fish-readout{position:absolute;top:42px;left:50%;transform:translateX(-50%);padding:0 var(--we-space-2);border:1px solid var(--we-border);border-radius:8px;background:var(--we-surface);color:var(--we-text);font:650 var(--we-text-body)/22px var(--we-font-numeric);font-variant-numeric:tabular-nums;white-space:nowrap;}
.fish-marker--moving{transition:transform 250ms ease-out;}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle-mascot :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{min-height:68px;display:flex;align-items:center;justify-content:center;gap:var(--we-space-3);color:var(--we-muted);font-size:var(--we-text-small);}
.fish-idle-mascot{width:40px;flex:none;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot{animation:none!important;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;}.fish-fill{background:Highlight;forced-color-adjust:none;}}
</style>
