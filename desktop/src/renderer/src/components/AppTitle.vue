<template>
  <h1 class="app-title">
    <span class="app-title-text">今天你摸鱼了吗</span>
    <svg class="app-title-fish" viewBox="0 0 56 48" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M7 34c12-1 18-7 20-14-7 2-13-1-13-6 0-4 5-5 8-3l7 6c-1-8 1-15 7-15 7 0 10 9 5 16-3 4-6 5-9 5-3 11-13 17-25 11Z" />
      <path fill="currentColor" opacity=".55" d="M45 36c3-6 9-8 10-4 2 5-6 7-10 7l-5 3Z" />
      <path fill="currentColor" opacity=".65" d="M7 5c3 4 4 7 1 8-4 1-3-4-1-8Z" />
    </svg>
    <svg class="app-title-wave" viewBox="0 0 320 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M2 8C59-3 112 5 168 9s105 5 148-6" />
    </svg>
  </h1>
</template>
<style scoped>
.app-title { position:relative;display:inline-flex;align-items:center;flex:none;gap:4px;padding:0 2px 8px;font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",sans-serif;font-size:clamp(20px,4.4vw,32px);font-weight:900;line-height:1.25;letter-spacing:-.025em;white-space:nowrap;color:var(--we-clock); }
.app-title-text { display:block;font-style:italic;background:linear-gradient(110deg,var(--we-clock) 25%,var(--we-accent));background-clip:text;-webkit-text-fill-color:transparent; }
.app-title-fish { flex:none;width:1.5em;height:1.3em;color:var(--we-accent); }
.app-title-wave { position:absolute;left:0;bottom:0;width:100%;height:10px;fill:none;stroke:var(--we-water-top);stroke-width:3;stroke-linecap:round;pointer-events:none; }
@media(forced-colors:active) { .app-title { color:CanvasText; }.app-title-text { background:none;-webkit-text-fill-color:currentColor; }.app-title-fish,.app-title-wave { display:none; } }
</style>
