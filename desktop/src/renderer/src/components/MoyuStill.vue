<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import original from '../../../../../docs/version/V2.0.0/design-reference/moyu_original.gif'

// Draw once, then release the GIF source. No hidden animated image or repaint loop.
const canvas = ref<HTMLCanvasElement | null>(null)
let image:HTMLImageElement|null=null
function release(){if(image){image.onload=null;image.removeAttribute('src');image=null}}
onMounted(() => {
  image = new Image()
  image.onload = () => {
    const target = canvas.value
    if (!target||!image) return
    target.width = image.naturalWidth; target.height = image.naturalHeight
    target.getContext('2d')?.drawImage(image, 0, 0)
    target.dataset.ready = 'true'
    release()
  }
  image.src = original
})
onBeforeUnmount(release)
</script>
<template><canvas ref="canvas" role="img" aria-label="原始蓝色摸鱼猫抱灰鱼（静态）"></canvas></template>
