<script setup lang="ts">
import type { ValidationIssue } from '../../../shared/contracts'
import { fieldMessage } from '../ui/settings-editor'
defineProps<{issues:ValidationIssue[];path:string}>()
</script>
<template><p v-for="(issue,i) in issues.filter(item=>item.field===path||item.field.startsWith(path+'.')||item.field.startsWith(path+'['))" :key="i" class="field-error" role="alert">{{ fieldMessage(issue) }}</p></template>
<style scoped>.field-error { color:var(--we-danger-text);font-size:var(--we-text-small);margin-top:var(--we-space-1); }</style>
