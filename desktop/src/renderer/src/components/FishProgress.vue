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
    <div v-if="ratio!==null" ref="track" class="fish-track">
      <div class="fish-water" aria-hidden="true"><div class="fish-fill" :style="{width:`${ratio*100}%`}"><svg class="fish-surface" viewBox="0 0 600 20" preserveAspectRatio="none"><path class="fish-surface-back" d="M0 10 Q75 -1 150 10 T300 10 T450 10 T600 10 V20 H0Z" /><path d="M0 12 Q75 22 150 12 T300 12 T450 12 T600 12 V20 H0Z" /></svg><svg class="fish-bubbles" viewBox="0 0 600 52" preserveAspectRatio="none"><circle cx="30" cy="30" r="2.5" /><circle cx="108" cy="20" r="1.6" /><circle cx="164" cy="32" r="3" /><circle cx="240" cy="36" r="1.5" /><circle cx="314" cy="22" r="2" /><circle cx="405" cy="33" r="3" /><circle cx="520" cy="23" r="2" /></svg></div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}" aria-hidden="true"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
      <span class="fish-readout" :class="{'fish-readout--filled':ratio>=0.65}" aria-hidden="true">{{ percent?.toFixed(1).replace(/\.0$/,'') }}%</span>
    </div>
    <div v-if="ratio!==null" class="fish-endpoints" aria-hidden="true"><span>上班</span><span>下班</span></div>
    <div v-else class="fish-idle"><span class="fish-idle-mascot"><MoyuIllustration :playing="false" /></span><span>无工作进度</span></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:112px;width:100%;container-type:inline-size;--fish-water-color:var(--we-water-bottom,var(--we-accent));}
.fish-water{position:absolute;top:48px;height:62px;left:0;right:0;border-radius:18px;border:1px solid var(--we-card-border,var(--we-border));background:var(--we-track);box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--we-surface) 70%,transparent);overflow:hidden;}
.fish-fill{height:calc(100% - 8px);top:8px;background:linear-gradient(var(--we-water-top,var(--we-accent-soft)),var(--fish-water-color) 65%);position:relative;clip-path:inset(-16px 0 0);}
.fish-surface{position:absolute;top:-14px;left:0;width:100cqw;height:20px;fill:var(--we-water-top,var(--we-accent));}
.fish-surface-back{fill:var(--we-water-top,var(--we-accent));opacity:.45;}
.fish-bubbles{position:absolute;inset:0;width:100cqw;height:100%;fill:color-mix(in srgb,var(--we-surface) 18%,transparent);stroke:color-mix(in srgb,var(--we-surface) 35%,transparent);stroke-width:1;}
.fish-marker{position:absolute;top:0;left:0;display:block;width:84px;max-width:100%;aspect-ratio:226/217;}
.fish-readout{position:absolute;top:82px;left:50%;transform:translateX(-50%);padding:0 8px;border-radius:7px;background:color-mix(in srgb,var(--we-surface) 90%,transparent);color:var(--we-text);font:700 20px/24px var(--we-font-numeric);font-variant-numeric:tabular-nums;white-space:nowrap;}
.fish-readout--filled{color:#fff;background:transparent;}
.fish-endpoints{display:flex;justify-content:space-between;color:var(--we-muted);font-size:var(--we-text-small);line-height:16px;}
.fish-marker--moving{transition:transform 250ms cubic-bezier(.23,1,.32,1);}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle-mascot :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{min-height:108px;display:flex;align-items:center;justify-content:center;gap:var(--we-space-3);color:var(--we-muted);font-size:var(--we-text-small);}
.fish-idle-mascot{width:40px;flex:none;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot{animation:none!important;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;}.fish-track{--fish-water-color:Highlight;}.fish-fill{background:Highlight;}.fish-surface{fill:Highlight;}.fish-fill,.fish-surface{forced-color-adjust:none;}.fish-readout{color:CanvasText;background:Canvas;}.fish-bubbles{display:none;}}
</style>
