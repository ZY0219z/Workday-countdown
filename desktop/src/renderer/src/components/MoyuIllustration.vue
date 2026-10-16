<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import original from '../../../../../docs/version/V2.0.0/design-reference/moyu_original.gif'
import MoyuStill from './MoyuStill.vue'
const props=defineProps<{playing:boolean}>()
const image=ref<HTMLImageElement|null>(null)
const stop=()=>image.value?.removeAttribute('src')
watch(()=>props.playing,playing=>{if(!playing)stop()},{flush:'sync'})
onBeforeUnmount(stop)
</script>
<template><img v-if="playing" ref="image" class="moyu-animated" :src="original" alt="原始蓝色摸鱼猫抱灰鱼（动画）" /><MoyuStill v-else /></template>
