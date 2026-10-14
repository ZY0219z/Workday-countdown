<script setup lang="ts">
import { onMounted, ref } from 'vue'
import original from '../../../../../docs/version/V2.0.0/design-reference/moyu_original.gif'

// Preview only. Freeze a loaded original GIF frame; D12 still owns animation.
const canvas = ref<HTMLCanvasElement | null>(null)
onMounted(() => {
  const image = new Image()
  image.onload = () => {
    const target = canvas.value
    if (!target) return
    target.width = image.naturalWidth; target.height = image.naturalHeight
    target.getContext('2d')?.drawImage(image, 0, 0)
    target.dataset.ready = 'true'
  }
  image.src = original
})
</script>
<template><canvas ref="canvas" role="img" aria-label="原始蓝色摸鱼猫抱灰鱼（静态组件示例）"></canvas></template>
