<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { fishPosition, progressRatio } from '../ui/fish-progress'
const props=defineProps<{percent:number|null;animate:boolean}>()
const track=ref<HTMLElement|null>(null),fish=ref<HTMLElement|null>(null),trackWidth=ref(0),fishWidth=ref(32),transition=ref(false)
const ratio=computed(()=>progressRatio(props.percent))
const x=computed(()=>fishPosition(props.percent,trackWidth.value,fishWidth.value)??0)
let observer:ResizeObserver|undefined,stopObserving:(()=>void)|undefined,skipNextMove=true
watch(()=>props.animate,()=>{transition.value=false;skipNextMove=true},{flush:'sync'})
watch(()=>props.percent,()=>{transition.value=props.animate&&!skipNextMove;skipNextMove=false},{flush:'sync'})
onMounted(()=>{
  const measure=()=>{transition.value=false;trackWidth.value=track.value?.clientWidth??0;fishWidth.value=fish.value?.offsetWidth??32}
  observer=new ResizeObserver(measure)
  stopObserving=watch([track,fish],()=>{observer!.disconnect();if(track.value)observer!.observe(track.value);if(fish.value)observer!.observe(fish.value);measure()},{immediate:true,flush:'post'})
})
onBeforeUnmount(()=>{stopObserving?.();observer?.disconnect()})
</script>
<template>
  <div class="fish-progress">
    <progress v-if="ratio!==null" class="fish-progress-native" :value="ratio*100" max="100" aria-label="有效工作进度"></progress>
    <div v-if="ratio!==null" ref="track" class="fish-track" aria-hidden="true">
      <div class="fish-water"><div class="fish-fill" :style="{transform:`scaleX(${ratio})`}"></div></div>
      <span ref="fish" class="fish-marker" :class="{'fish-marker--moving':transition}" :style="{transform:`translateX(${x}px)`}"><span class="fish-tail"></span><span class="fish-body"></span></span>
    </div>
  </div>
</template>
<style scoped>
.fish-progress{min-width:0;}
.fish-progress-native{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.fish-track{position:relative;height:44px;width:100%;}
.fish-water{position:absolute;top:18px;height:8px;left:0;right:0;border-radius:8px;background:var(--we-track);overflow:hidden;}
.fish-fill{height:100%;width:100%;background:var(--we-accent);transform-origin:left;}
.fish-marker{position:absolute;top:6px;left:0;display:block;width:32px;max-width:100%;height:32px;color:var(--we-neutral-text);}
.fish-marker--moving{transition:transform 250ms ease-out;}
.fish-body{position:absolute;top:8px;left:25%;width:72%;height:16px;box-sizing:border-box;border:2px solid currentColor;border-radius:55% 65% 65% 55%;background:var(--we-neutral-bg);}
.fish-body::after{content:'';position:absolute;right:3px;top:3px;width:3px;height:3px;border-radius:50%;background:currentColor;}
.fish-tail{position:absolute;left:0;top:8px;width:34%;height:16px;background:currentColor;clip-path:polygon(0 0,100% 50%,0 100%);}
[data-reduced-motion="true"] .fish-marker{transition:none;}
@media(prefers-reduced-motion:reduce){.fish-marker{transition:none;}}
@media(forced-colors:active){.fish-water{background:Canvas;border:1px solid CanvasText;}.fish-fill{background:Highlight;forced-color-adjust:none;}.fish-marker{color:CanvasText;}.fish-body{background:Canvas;}.fish-tail,.fish-body::after{background:CanvasText;}}
</style>
