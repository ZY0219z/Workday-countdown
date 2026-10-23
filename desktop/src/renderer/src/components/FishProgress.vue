<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
import MoyuIllustration from './MoyuIllustration.vue'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null)
const trackWidth=ref(0),fishWidth=ref(68),transition=ref(false)
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
// Two identical 600-unit tiles: moving a full tile right makes the loop endpoints identical.
const wave='M0 12 C50 6 100 6 150 12 S250 18 300 12 S400 6 450 12 S550 18 600 12 S700 6 750 12 S850 18 900 12 S1000 6 1050 12 S1150 18 1200 12'
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined,skipNextMove=true
watch(()=>props.animate,()=>{transition.value=false;skipNextMove=true},{flush:'sync'})
watch(()=>props.percent,()=>{
  transition.value=props.animate&&!skipNextMove
  skipNextMove=false
},{flush:'sync'})
onMounted(()=>{
  const measure=()=>{
    const width=track.value?.clientWidth??0,marker=fish.value?.offsetWidth??68
    if(width!==trackWidth.value||marker!==fishWidth.value){transition.value=false;skipNextMove=true;trackWidth.value=width;fishWidth.value=marker}
  }
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish],()=>{observer!.disconnect();for(const element of [track.value,fish.value])if(element)observer!.observe(element);measure()},{immediate:true,flush:'post'})
})
onBeforeUnmount(()=>{stopObserving?.();observer?.disconnect()})
</script>
<template>
  <div class="fish-progress">
    <progress v-if="ratio!==null" class="fish-progress-native" :value="ratio*100" max="100" aria-label="有效工作进度"></progress>
    <div v-if="ratio!==null" ref="track" class="fish-track" :class="{'fish-track--flowing':animate}">
      <div class="fish-water" aria-hidden="true">
        <div class="fish-fill" :style="{width:`${ratio*100}%`}">
          <svg v-for="layer in ['back','front']" :key="layer" class="fish-surface" :class="'fish-surface--'+layer" viewBox="0 0 1200 24" preserveAspectRatio="none"><path :d="wave+' V24 H0Z'" /><path class="fish-surface-line" :d="wave" /></svg>
          <svg class="fish-bubbles" viewBox="0 0 600 52" preserveAspectRatio="none"><circle cx="42" cy="30" r="2.5" /><circle cx="154" cy="20" r="1.6" /><circle cx="278" cy="32" r="3" /><circle cx="405" cy="33" r="2" /><circle cx="520" cy="23" r="2" /></svg>
        </div>
      </div>
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
.fish-track{position:relative;height:108px;width:100%;container-type:inline-size;--fish-water-color:var(--we-water-bottom,var(--we-accent));}
.fish-water{position:absolute;top:28px;height:80px;left:0;right:0;border-radius:40px;border:1px solid color-mix(in srgb,var(--we-surface) 80%,var(--fish-water-color));background:color-mix(in srgb,var(--we-water-top,var(--we-track)) 18%,var(--we-surface));box-shadow:0 0 0 3px color-mix(in srgb,var(--we-surface) 65%,transparent);overflow:hidden;}
.fish-water::after{content:"";position:absolute;inset:4px;border:1px solid color-mix(in srgb,var(--we-surface) 65%,transparent);border-radius:inherit;pointer-events:none;}
.fish-fill{position:absolute;top:0;left:0;height:100%;overflow:hidden;}
.fish-fill::before{content:"";position:absolute;inset:18px 0 0;background:linear-gradient(var(--we-water-top,var(--we-accent-soft)),var(--fish-water-color));}
.fish-fill::after{content:"";position:absolute;inset:14px 0 0 auto;width:1px;background:color-mix(in srgb,var(--we-surface) 50%,transparent);}
.fish-surface{position:absolute;top:0;left:0;width:200cqw;height:24px;fill:color-mix(in srgb,var(--we-water-top,var(--we-accent)) 65%,var(--we-surface));transform:translateX(-50%);animation:fish-water-flow 14s linear -7s infinite paused;}
.fish-surface--front{top:4px;fill:var(--we-water-top,var(--we-accent));animation-duration:16s;animation-delay:-4s;}
.fish-surface-line{fill:none;stroke:color-mix(in srgb,var(--we-surface) 65%,transparent);stroke-width:1;}
.fish-track--flowing .fish-surface{animation-play-state:running;}
.fish-bubbles{position:absolute;top:24px;left:0;width:100cqw;height:44px;fill:color-mix(in srgb,var(--we-surface) 12%,transparent);stroke:color-mix(in srgb,var(--we-surface) 45%,transparent);stroke-width:1;}
.fish-marker{position:absolute;top:68px;left:0;translate:0 -50%;display:block;width:68px;max-width:100%;aspect-ratio:226/217;z-index:2;}
.fish-readout{position:absolute;top:0;left:50%;transform:translateX(-50%);padding:0 12px;border:1px solid color-mix(in srgb,var(--we-surface) 80%,var(--we-water-top,var(--we-border)));border-radius:999px;background:color-mix(in srgb,var(--we-surface) 90%,transparent);color:var(--we-clock,var(--we-text));font:700 18px/24px var(--we-font-numeric);font-variant-numeric:tabular-nums;white-space:nowrap;z-index:3;}
.fish-endpoints{display:flex;justify-content:space-between;color:var(--we-muted);font-size:var(--we-text-small);line-height:16px;}
.fish-marker--moving{transition:transform 250ms cubic-bezier(.23,1,.32,1);}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle-mascot :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{min-height:108px;display:flex;align-items:center;justify-content:center;gap:var(--we-space-3);color:var(--we-muted);font-size:var(--we-text-small);}
.fish-idle-mascot{width:40px;flex:none;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes fish-water-flow{from{transform:translateX(-50%)}to{transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot,.fish-surface{animation:none!important;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;box-shadow:none;}.fish-water::after,.fish-fill::after{display:none;}.fish-fill,.fish-fill::before{background:Highlight;forced-color-adjust:none;}.fish-readout{color:CanvasText;background:Canvas;border-color:CanvasText;}.fish-bubbles,.fish-surface{display:none;animation:none;}}
</style>
