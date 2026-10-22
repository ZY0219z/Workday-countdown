<script setup lang="ts">
defineProps<{ name: 'clock' | 'coffee' | 'briefcase' | 'wallet' | 'monitor' | 'calendar' | 'settings' | 'palm' }>()
const paths = {
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 7v5l3 2'],
  coffee: ['M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z', 'M16 10h2a3 3 0 0 1 0 6h-2', 'M7 6c-2-2 2-2 0-4M12 6c-2-2 2-2 0-4'],
  briefcase: ['M9 7V4h6v3', 'M3 7h18v13H3Z', 'M3 11l9 3 9-3M10 13v3h4v-3'],
  wallet: ['M4 7V5l13-2v4', 'M3 7h18v14H3Z', 'M16 12h5v5h-5Z'],
  monitor: ['M3 3h18v13H3Z', 'M12 16v5M7 21h10'],
  calendar: ['M4 5h16v16H4Z', 'M8 3v4M16 3v4M4 10h16'],
  settings: ['m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h4l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'],
  palm: ['M12 9c-1 4-1 8 1 11M5 21h15', 'M12 9C8 3 4 5 3 9c4-2 6-1 9 0ZM12 9c4-6 8-4 9 0-4-2-6-1-9 0Z', 'M12 9C9 8 5 12 5 16c2-4 4-5 7-7ZM12 9c3-1 7 3 7 7-2-4-4-5-7-7Z']
}
</script>
<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path v-for="(path,index) in paths[name]" :key="index" :d="path" /></svg></template>
