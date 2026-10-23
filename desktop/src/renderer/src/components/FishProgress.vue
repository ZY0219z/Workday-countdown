<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
import MoyuIllustration from './MoyuIllustration.vue'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null),readout=ref<HTMLElement|null>(null)
const trackWidth=ref(0),fishWidth=ref(68),readoutWidth=ref(90),transition=ref(false),movingFrom=ref<number|null>(null)
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
// Keep both the real progress marker and the central label visible, including a move across the centre.
const liftReadout=computed(()=>{
  const left=Math.min(movingFrom.value??x.value,x.value),right=Math.max(movingFrom.value??x.value,x.value)+fishWidth.value
  return left<trackWidth.value/2+readoutWidth.value/2+8&&right>trackWidth.value/2-readoutWidth.value/2-8
})
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined,skipNextMove=true
watch(()=>props.animate,()=>{transition.value=false;movingFrom.value=null;skipNextMove=true},{flush:'sync'})
watch(()=>props.percent,()=>{
  transition.value=props.animate&&!skipNextMove
  movingFrom.value=transition.value&&fish.value&&track.value?fish.value.getBoundingClientRect().left-track.value.getBoundingClientRect().left:null
  skipNextMove=false
},{flush:'sync'})
onMounted(()=>{
  const measure=()=>{
    const width=track.value?.clientWidth??0,marker=fish.value?.offsetWidth??68
    if(width!==trackWidth.value||marker!==fishWidth.value){transition.value=false;movingFrom.value=null;skipNextMove=true;trackWidth.value=width;fishWidth.value=marker}
    readoutWidth.value=readout.value?.offsetWidth??90
  }
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish,readout],()=>{observer!.disconnect();for(const element of [track.value,fish.value,readout.value])if(element)observer!.observe(element);measure()},{immediate:true,flush:'post'})
})
onBeforeUnmount(()=>{stopObserving?.();observer?.disconnect()})
</script>
<template>
  <div class="fish-progress">
    <progress v-if="ratio!==null" class="fish-progress-native" :value="ratio*100" max="100" aria-label="有效工作进度"></progress>
    <div v-if="ratio!==null" ref="track" class="fish-track">
      <div class="fish-water" aria-hidden="true"><div class="fish-fill" :style="{width:`${ratio*100}%`}"><svg class="fish-surface" viewBox="0 0 600 20" preserveAspectRatio="none"><path class="fish-surface-back" d="M0 10 Q75 -1 150 10 T300 10 T450 10 T600 10 V20 H0Z" /><path d="M0 12 Q75 22 150 12 T300 12 T450 12 T600 12 V20 H0Z" /></svg><svg class="fish-bubbles" viewBox="0 0 600 52" preserveAspectRatio="none"><circle cx="30" cy="30" r="2.5" /><circle cx="108" cy="20" r="1.6" /><circle cx="164" cy="32" r="3" /><circle cx="240" cy="36" r="1.5" /><circle cx="314" cy="22" r="2" /><circle cx="405" cy="33" r="3" /><circle cx="520" cy="23" r="2" /></svg></div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}" aria-hidden="true" @transitionend.self="movingFrom=null"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
      <span ref="readout" class="fish-readout" :class="{'fish-readout--lifted':liftReadout}" aria-hidden="true">{{ percent?.toFixed(1).replace(/\.0$/,'') }}%</span>
    </div>
    <div v-if="ratio!==null" class="fish-endpoints" aria-hidden="true"><span>上班</span><span>下班</span></div>
    <div v-else class="fish-idle"><span class="fish-idle-mascot"><MoyuIllustration :playing="false" /></span><span>无工作进度</span></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:108px;width:100%;container-type:inline-size;--fish-water-color:var(--we-water-bottom,var(--we-accent));}
.fish-water{position:absolute;top:28px;height:80px;left:0;right:0;border-radius:40px;border:2px solid color-mix(in srgb,var(--we-surface) 92%,var(--we-card-border,var(--we-border)));background:linear-gradient(175deg,color-mix(in srgb,var(--we-surface) 75%,transparent),transparent 48%),var(--we-track);box-shadow:0 0 0 3px color-mix(in srgb,var(--we-accent) 18%,transparent),inset 0 0 0 4px color-mix(in srgb,var(--we-surface) 65%,transparent),inset 0 -6px 10px color-mix(in srgb,var(--we-accent) 12%,transparent);overflow:hidden;}
.fish-water::after{content:"";position:absolute;inset:5px;border:1px solid color-mix(in srgb,var(--we-surface) 80%,transparent);border-radius:inherit;pointer-events:none;box-shadow:inset 0 4px 6px color-mix(in srgb,var(--we-surface) 55%,transparent);}
.fish-fill{height:calc(100% - 8px);top:8px;background:linear-gradient(var(--we-water-top,var(--we-accent-soft)),var(--fish-water-color) 65%);position:relative;clip-path:inset(-16px 0 0);}
.fish-surface{position:absolute;top:-14px;left:0;width:100cqw;height:20px;fill:var(--we-water-top,var(--we-accent));}
.fish-surface-back{fill:var(--we-water-top,var(--we-accent));opacity:.45;}
.fish-surface path:last-child{stroke:color-mix(in srgb,var(--we-surface) 70%,transparent);stroke-width:1;}
.fish-bubbles{position:absolute;inset:0;width:100cqw;height:100%;fill:color-mix(in srgb,var(--we-surface) 18%,transparent);stroke:color-mix(in srgb,var(--we-surface) 35%,transparent);stroke-width:1;}
.fish-marker{position:absolute;top:68px;left:0;translate:0 -50%;display:block;width:68px;max-width:100%;aspect-ratio:226/217;z-index:2;}
.fish-readout{position:absolute;top:68px;left:50%;transform:translate(-50%,-50%);padding:0 14px;border:1px solid color-mix(in srgb,var(--we-surface) 85%,var(--we-border));border-radius:999px;background:color-mix(in srgb,var(--we-surface) 94%,transparent);color:var(--we-clock,var(--we-text));font:700 20px/24px var(--we-font-numeric);font-variant-numeric:tabular-nums;white-space:nowrap;z-index:3;box-shadow:0 2px 6px color-mix(in srgb,var(--we-accent) 12%,transparent);}
.fish-readout--lifted{top:0;transform:translateX(-50%);}
.fish-endpoints{display:flex;justify-content:space-between;color:var(--we-muted);font-size:var(--we-text-small);line-height:16px;}
.fish-marker--moving{transition:transform 250ms cubic-bezier(.23,1,.32,1);}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle-mascot :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{min-height:108px;display:flex;align-items:center;justify-content:center;gap:var(--we-space-3);color:var(--we-muted);font-size:var(--we-text-small);}
.fish-idle-mascot{width:40px;flex:none;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot{animation:none!important;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:2px solid CanvasText;box-shadow:none;}.fish-water::after{display:none;}.fish-track{--fish-water-color:Highlight;}.fish-fill{background:Highlight;}.fish-surface{fill:Highlight;}.fish-fill,.fish-surface{forced-color-adjust:none;}.fish-readout{color:CanvasText;background:Canvas;border-color:CanvasText;box-shadow:none;}.fish-bubbles{display:none;}}
</style>
