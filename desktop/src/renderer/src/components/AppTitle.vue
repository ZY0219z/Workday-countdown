<script setup lang="ts">
import artwork from '../assets/dashboard/title-approved.svg?raw'
</script>
<template>
  <h1 class="app-title">
    <span class="app-title-text">今天你摸鱼了吗</span>
    <!-- Trusted local SVG: approved lettering contours, never user-supplied HTML. -->
    <span class="app-title-art" aria-hidden="true" v-html="artwork"></span>
  </h1>
</template>
<style scoped>
.app-title { flex:none;width:clamp(190px,45.2vw,360px);color:var(--we-clock);font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",sans-serif;font-size:clamp(20px,4.4vw,32px);font-weight:900;line-height:1.25; }
.app-title-text { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
.app-title-art,.app-title-art :deep(svg) { display:block;width:100%;height:auto; }
:global([data-accent="coral"]) .app-title { --title-ink:var(--we-clock);--title-mid:var(--we-clock-seconds);--title-blue:var(--we-accent);--title-fish:var(--we-water-bottom);--title-water:var(--we-water-top); }
:global([data-theme="dark"]) .app-title { --title-ink:var(--we-clock);--title-mid:var(--we-clock-seconds);--title-blue:var(--we-accent);--title-fish:var(--we-accent);--title-water:var(--we-clock-seconds); }
@media(forced-colors:active) {
  .app-title { width:auto;color:CanvasText; }
  .app-title-text { position:static;width:auto;height:auto;overflow:visible;clip-path:none; }
  .app-title-art { display:none; }
}
</style>
