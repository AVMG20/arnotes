<script setup lang="ts">
import { computed } from 'vue'
import { renderInlineMarkdown } from '#shared/utils/inlineMarkdown'

// Renders a task update: the narrow inline Markdown it is stored as, and
// nothing else. The HTML is built from escaped text by the shared renderer, so
// a body posted by an agent over MCP is as safe to draw as one typed here.
const props = defineProps<{ text: string }>()

const html = computed(() => renderInlineMarkdown(props.text))
</script>

<template>
  <div
    class="inline-md w-full min-w-0 break-words"
    v-html="html"
  />
</template>
