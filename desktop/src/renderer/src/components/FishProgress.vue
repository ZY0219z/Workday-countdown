<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
import MoyuIllustration from './MoyuIllustration.vue'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null),readout=ref<HTMLElement|null>(null)
const trackWidth=ref(0),fishWidth=ref(52),readoutWidth=ref(100),side=ref<'left'|'right'>('right')
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
const labels=computed(()=>{
  const room=Math.max(0,trackWidth.value-readoutWidth.value),centre=room/2,gap=8
  if(x.value+fishWidth.value+gap<=centre||x.value-gap>=centre+readoutWidth.value)return {left:centre,right:centre,bothFit:true,chosen:side.value}
  const left=x.value-readoutWidth.value-gap,right=x.value+fishWidth.value+gap
  const leftFits=left>=gap,rightFits=right<=room-gap
  return {left:Math.max(gap,left),right:Math.min(room-gap,right),bothFit:leftFits&&rightFits,chosen:!leftFits?'right':!rightFits?'left':side.value}
})
// Hysteresis prevents a noisy progress value from repeatedly switching the reading side.
watch([x,trackWidth,fishWidth],()=>{
  const distance=x.value+fishWidth.value/2-trackWidth.value/2
  if(distance < -8)side.value='right'
  else if(distance > 8)side.value='left'
},{flush:'sync'})
// Two identical 600-unit tiles: moving a full tile right makes the loop endpoints identical.
const wave='M0 12 C50 6 100 6 150 12 S250 18 300 12 S400 6 450 12 S550 18 600 12 S700 6 750 12 S850 18 900 12 S1000 6 1050 12 S1150 18 1200 12'
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined
onMounted(()=>{
  const measure=()=>{
    trackWidth.value=track.value?.clientWidth??0
    fishWidth.value=fish.value?.offsetWidth??52
    // Measure the drops together with the glass so the existing avoidance also protects them.
    readoutWidth.value=readout.value?.offsetWidth??100
  }
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish,readout],()=>{observer!.disconnect();for(const element of [track.value,fish.value,readout.value])if(element)observer!.observe(element);measure()},{immediate:true,flush:'post'})
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
      <span ref="fish" class="fish-marker" :style="{transform:`translateX(${x}px)`}" aria-hidden="true"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
      <span class="fish-readout" :class="{'fish-readout--settled':!labels.bothFit}" aria-hidden="true">
        <span ref="readout" class="fish-readout-pill" :data-active="labels.chosen==='left'" :style="{transform:`translateX(${labels.left}px)`,opacity:labels.chosen==='left'?1:0}">
          <span class="fish-bubble-face"></span>
          <svg class="fish-bubble-glass" viewBox="0 0 100 68" aria-hidden="true">
            <circle class="fish-bubble-rim" cx="50" cy="34" r="32.5" />
            <circle class="fish-bubble-inner" cx="50" cy="34" r="30.5" />
            <path class="fish-bubble-shade" d="M26 53 A30.5 30.5 0 0 0 78 45" />
            <path class="fish-bubble-highlight" d="M27 18 A27.5 27.5 0 0 1 39 9 M45 7 A27.5 27.5 0 0 1 54 7" />
            <path class="fish-bubble-reflection" d="M69 51 A25 25 0 0 1 48 60 M75 40 A25 25 0 0 1 73 47" />
            <path class="fish-bubble-drops fish-bubble-drops--left" d="M15 37 C14 29 9 22 6 25 C2 30 10 34 15 37Z M13 48 C8 41 2 42 3 46 C4 49 9 47 13 48Z" />
            <path class="fish-bubble-drops fish-bubble-drops--right" d="M85 37 C86 29 91 22 94 25 C98 30 90 34 85 37Z M87 48 C92 41 98 42 97 46 C96 49 91 47 87 48Z" />
          </svg>
          <span class="fish-readout-value">{{ percent?.toFixed(1).replace(/\.0$/,'') }}%</span>
        </span>
        <span class="fish-readout-pill" :data-active="labels.chosen==='right'" :style="{transform:`translateX(${labels.right}px)`,opacity:labels.chosen==='right'?1:0}">
          <span class="fish-bubble-face"></span>
          <svg class="fish-bubble-glass" viewBox="0 0 100 68" aria-hidden="true">
            <circle class="fish-bubble-rim" cx="50" cy="34" r="32.5" />
            <circle class="fish-bubble-inner" cx="50" cy="34" r="30.5" />
            <path class="fish-bubble-shade" d="M26 53 A30.5 30.5 0 0 0 78 45" />
            <path class="fish-bubble-highlight" d="M27 18 A27.5 27.5 0 0 1 39 9 M45 7 A27.5 27.5 0 0 1 54 7" />
            <path class="fish-bubble-reflection" d="M69 51 A25 25 0 0 1 48 60 M75 40 A25 25 0 0 1 73 47" />
            <path class="fish-bubble-drops fish-bubble-drops--left" d="M15 37 C14 29 9 22 6 25 C2 30 10 34 15 37Z M13 48 C8 41 2 42 3 46 C4 49 9 47 13 48Z" />
            <path class="fish-bubble-drops fish-bubble-drops--right" d="M85 37 C86 29 91 22 94 25 C98 30 90 34 85 37Z M87 48 C92 41 98 42 97 46 C96 49 91 47 87 48Z" />
          </svg>
          <span class="fish-readout-value">{{ percent?.toFixed(1).replace(/\.0$/,'') }}%</span>
        </span>
      </span>
    </div>
    <div v-else class="fish-idle"><span class="fish-idle-mascot"><MoyuIllustration :playing="false" /></span><span>无工作进度</span></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:60px;width:100%;container-type:inline-size;--fish-water-color:var(--we-water-bottom,var(--we-accent));}
.fish-water{position:absolute;inset:0;border-radius:30px;border:1px solid color-mix(in srgb,var(--we-surface) 80%,var(--fish-water-color));background:color-mix(in srgb,var(--we-water-top,var(--we-track)) 18%,var(--we-surface));box-shadow:0 0 0 2px color-mix(in srgb,var(--we-surface) 65%,transparent);overflow:hidden;}
.fish-water::after{content:"";position:absolute;inset:3px;border:1px solid color-mix(in srgb,var(--we-surface) 65%,transparent);border-radius:inherit;pointer-events:none;}
.fish-fill{position:absolute;top:0;left:0;height:100%;overflow:hidden;}
.fish-fill::before{content:"";position:absolute;inset:14px 0 0;background:linear-gradient(var(--we-water-top,var(--we-accent-soft)),var(--fish-water-color));}
.fish-fill::after{content:"";position:absolute;inset:10px 0 0 auto;width:1px;background:color-mix(in srgb,var(--we-surface) 50%,transparent);}
.fish-surface{position:absolute;top:0;left:0;width:200cqw;height:18px;fill:color-mix(in srgb,var(--we-water-top,var(--we-accent)) 65%,var(--we-surface));transform:translateX(-50%);animation:fish-water-flow 14s linear -7s infinite paused;}
.fish-surface--front{top:3px;fill:var(--we-water-top,var(--we-accent));animation-duration:16s;animation-delay:-4s;}
.fish-surface-line{fill:none;stroke:color-mix(in srgb,var(--we-surface) 65%,transparent);stroke-width:1;}
.fish-track--flowing .fish-surface{animation-play-state:running;}
.fish-bubbles{position:absolute;top:18px;left:0;width:100cqw;height:32px;fill:color-mix(in srgb,var(--we-surface) 12%,transparent);stroke:color-mix(in srgb,var(--we-surface) 45%,transparent);stroke-width:1;}
.fish-marker{position:absolute;top:50%;left:0;translate:0 -50%;display:block;width:52px;max-width:100%;aspect-ratio:226/217;z-index:2;}
.fish-readout{position:absolute;inset:0;pointer-events:none;z-index:3;}
.fish-readout-pill{position:absolute;top:50%;left:0;translate:0 -50%;width:100px;height:68px;color:var(--we-clock,var(--we-text));font:700 16px/1 var(--we-font-numeric);font-variant-numeric:tabular-nums;white-space:nowrap;--bubble-edge:color-mix(in srgb,var(--we-water-top,var(--we-accent)) 78%,var(--fish-water-color));--bubble-light:color-mix(in srgb,var(--we-surface) 92%,white);}
.fish-bubble-face{position:absolute;inset:0 16px;border-radius:50%;background:radial-gradient(ellipse at 33% 24%,color-mix(in srgb,var(--bubble-light) 92%,transparent),transparent 58%),linear-gradient(145deg,color-mix(in srgb,var(--we-water-top,var(--we-accent-soft)) 32%,var(--we-surface)),color-mix(in srgb,var(--we-water-top,var(--we-accent-soft)) 70%,transparent));box-shadow:inset -4px -5px 9px color-mix(in srgb,var(--bubble-edge) 30%,transparent),0 2px 5px color-mix(in srgb,var(--fish-water-color) 20%,transparent);}
.fish-bubble-glass{position:absolute;inset:0;display:block;width:100%;height:100%;fill:none;stroke-linecap:round;stroke-linejoin:round;}
.fish-bubble-rim{stroke:var(--bubble-edge);stroke-width:2;}
.fish-bubble-inner{stroke:var(--bubble-light);stroke-width:1.3;opacity:.9;}
.fish-bubble-shade{stroke:var(--fish-water-color);stroke-width:1.4;opacity:.5;}
.fish-bubble-highlight{stroke:white;stroke-width:3.4;opacity:.95;}
.fish-bubble-reflection{stroke:white;stroke-width:2.4;opacity:.9;}
.fish-bubble-drops{fill:color-mix(in srgb,var(--we-water-top,var(--we-accent)) 75%,var(--we-surface));stroke:color-mix(in srgb,var(--bubble-light) 75%,transparent);stroke-width:.7;}
[data-accent="ocean"] .fish-readout-pill{--bubble-edge:#39b8ed;}
[data-accent="ocean"] .fish-bubble-drops{fill:#84d8f6;}
[data-theme="dark"] .fish-readout-pill{--bubble-edge:var(--we-water-top);}
[data-theme="dark"] .fish-bubble-drops{fill:color-mix(in srgb,var(--we-water-top) 75%,var(--we-surface));}
.fish-readout-value{position:absolute;inset:0 16px;display:grid;place-items:center;}
.fish-track--flowing .fish-readout-pill{transition:opacity 160ms cubic-bezier(.23,1,.32,1);}
.fish-readout--settled .fish-readout-pill{transition:none;}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle-mascot :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{min-height:60px;display:flex;align-items:center;justify-content:center;gap:var(--we-space-3);color:var(--we-muted);font-size:var(--we-text-small);}
.fish-idle-mascot{width:40px;flex:none;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes fish-water-flow{from{transform:translateX(-50%)}to{transform:translateX(0)}}
@media(prefers-reduced-motion:reduce){.fish-readout-pill{transition:none!important;}.fish-mascot,.fish-surface{animation:none!important;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;box-shadow:none;}.fish-water::after,.fish-fill::after,.fish-bubble-glass{display:none;}.fish-fill,.fish-fill::before{background:Highlight;forced-color-adjust:none;}.fish-readout-pill{color:CanvasText;}.fish-bubble-face{background:Canvas;border:1px solid CanvasText;box-shadow:none;}.fish-bubbles,.fish-surface{display:none;animation:none;}}
</style>
