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
      <div class="fish-water" aria-hidden="true"><div class="fish-fill" :style="{width:`${ratio*100}%`}"><span class="fish-waves" :class="{'fish-waves--flowing':animate}"></span></div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}"><span class="fish-mascot" :class="{'fish-mascot--floating':animate}"><MoyuIllustration :playing="animate" /></span></span>
    </div>
    <div v-else class="fish-idle"><MoyuIllustration :playing="false" /></div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:64px;width:100%;}
.fish-water{position:absolute;top:29px;height:24px;left:0;right:0;border-radius:12px;background:var(--we-track);overflow:hidden;}
.fish-fill{height:100%;background:var(--we-accent);overflow:hidden;position:relative;}
/* One extra tile on each side keeps the clipped strip seamless at the wrap. */
.fish-waves{position:absolute;inset:-2px -88px;background:rgb(255 255 255 / 96%);
  mask-image:url('../../../../../assets/image/wave-fin.png');
  mask-size:88px 24px;mask-position:0 center;mask-repeat:repeat-x;}
.fish-waves--flowing{animation:wave-flow 4.4s linear infinite;}
.fish-marker{position:absolute;top:4px;left:0;display:block;width:56px;max-width:100%;aspect-ratio:226/217;}
.fish-marker--moving{transition:transform 250ms ease-out;}
.fish-mascot{display:block;width:100%;}
.fish-mascot :deep(img),.fish-mascot :deep(canvas),.fish-idle :deep(canvas){display:block;width:100%;height:auto;}
.fish-mascot--floating{animation:fish-bob 3s ease-in-out infinite;}
.fish-idle{width:56px;margin:4px 0;}
@keyframes fish-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes wave-flow{0%{transform:translate(0,0)}25%{transform:translate(22px,-1px)}50%{transform:translate(44px,0)}75%{transform:translate(66px,1px)}100%{transform:translate(88px,0)}}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}.fish-mascot,.fish-waves{animation:none;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;}.fish-fill{background:Highlight;forced-color-adjust:none;}.fish-waves{display:none;}}
</style>
