<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
import MoyuIllustration from './MoyuIllustration.vue'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null),trackWidth=ref(0),fishWidth=ref(56),transition=ref(false)
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined,skipNextMove=true
watch(()=>props.animate,()=>{transition.value=false;skipNextMove=true},{flush:'sync'})
watch(()=>props.percent,()=>{transition.value=props.animate&&!skipNextMove;skipNextMove=false},{flush:'sync'})
onMounted(()=>{
  const measure=()=>{transition.value=false;trackWidth.value=track.value?.clientWidth??0;fishWidth.value=fish.value?.offsetWidth??56}
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish],()=>{observer!.disconnect();if(track.value)observer!.observe(track.value);if(fish.value)observer!.observe(fish.value);measure()},{immediate:true,flush:'post'})
})
onBeforeUnmount(()=>{stopObserving?.();observer?.disconnect()})
</script>
<template>
  <div class="fish-progress">
    <progress v-if="ratio!==null" class="fish-progress-native" :value="ratio*100" max="100" aria-label="有效工作进度"></progress>
    <div v-if="ratio!==null" ref="track" class="fish-track">
      <div class="fish-water" aria-hidden="true"><div class="fish-fill" :style="{width:`${ratio*100}%`}">
        <span class="fish-waves" :class="{'fish-waves--flowing':animate}" :style="{clipPath:`inset(0 ${ratio*fishWidth}px 0 0)`}">
          <span v-for="wave in 3" :key="wave" class="fish-wave-path"><span class="fish-wave"></span></span>
        </span>
      </div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
    </div>
    <div v-else class="fish-idle"><MoyuIllustration :playing="false" /></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:64px;width:100%;}
.fish-water{position:absolute;top:29px;height:32px;left:0;right:0;border-radius:12px;background:var(--we-track);overflow:hidden;}
.fish-fill{height:100%;background:var(--we-accent);overflow:hidden;position:relative;}
/* Python: three 32px sprites, centres at (flow + i * 20) / 60 of the fill. */
.fish-waves{position:absolute;inset:0;overflow:hidden;}
.fish-wave-path{position:absolute;inset:0;transform:translateX(16.6667%);}
.fish-wave-path:nth-child(2){transform:translateX(50%);}
.fish-wave-path:nth-child(3){transform:translateX(83.3333%);}
.fish-wave{position:absolute;left:-16px;top:calc(50% - 16px);width:32px;height:32px;background:white;
  mask:url('../../../../../assets/image/wave-fin.png') center / 32px 32px no-repeat;}
.fish-waves--flowing .fish-wave-path{animation:wave-travel 3s linear infinite;}
.fish-waves--flowing .fish-wave-path:nth-child(2){animation-delay:-1s;}
.fish-waves--flowing .fish-wave-path:nth-child(3){animation-delay:-2s;}
.fish-waves--flowing .fish-wave{animation:wave-sway 2.2s ease-in-out infinite;}
.fish-waves--flowing .fish-wave-path:nth-child(2) .fish-wave{animation-duration:2.6s;animation-delay:-.7s;animation-direction:reverse;}
.fish-waves--flowing .fish-wave-path:nth-child(3) .fish-wave{animation-duration:2.9s;animation-delay:-1.4s;}
.fish-marker{position:absolute;top:4px;left:0;display:block;width:56px;max-width:100%;aspect-ratio:226/217;}
.fish-marker--moving{transition:transform 250ms ease-out;}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{width:56px;margin:4px 0;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes wave-travel{0%{transform:translateX(0);opacity:0}5%{opacity:1}90%{opacity:1}100%{transform:translateX(100%);opacity:0}}
@keyframes wave-sway{0%,100%{transform:translate(-1px,0)}25%{transform:translate(1px,-4px)}75%{transform:translate(-2px,4px)}}
/* Even a short positive fill keeps the original sprites: its bounds and the
   cat exclusion clip, rather than a progress threshold, limit visible pixels. */
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot,.fish-wave-path,.fish-wave{animation:none!important;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;}.fish-fill{background:Highlight;forced-color-adjust:none;}.fish-waves{visibility:hidden;}.fish-wave-path,.fish-wave{animation:none!important;}}
</style>
