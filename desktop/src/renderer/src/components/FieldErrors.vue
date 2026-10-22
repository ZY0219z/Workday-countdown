<script setup lang="ts">
import { computed } from 'vue'
import type { ValidationIssue } from '../../../shared/contracts'
import { fieldIssues, fieldMessage } from '../ui/settings-editor'
const props=defineProps<{issues:ValidationIssue[];path:string;id?:string;excludePaths?:string[]}>()
const matching=computed(()=>fieldIssues(props.issues,props.path,props.excludePaths))
</script>
<template><div v-if="matching.length" :id="id" role="alert"><p v-for="(issue,i) in matching" :key="i" class="field-error">{{ fieldMessage(issue) }}</p></div></template>
<style scoped>.field-error { color:var(--we-danger-text);font-size:var(--we-text-small);margin-top:var(--we-space-1); }</style>
