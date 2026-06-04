<script setup lang="ts">
import { ref } from 'vue'
import type { DateItem } from '~/composables/useDateMention'

const props = defineProps<{
  items: DateItem[]
  command: (item: DateItem) => void
}>()

const selectedIndex = ref(0)

function select(item: DateItem) {
  props.command(item)
}

function onKeyDown(event: KeyboardEvent): boolean {
  if (event.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value - 1 + props.items.length) % props.items.length
    return true
  }
  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }
  if (event.key === 'Enter') {
    const item = props.items[selectedIndex.value]
    if (item) select(item)
    return true
  }
  return false
}

defineExpose({ onKeyDown })
</script>

<template>
  <div class="bg-default border border-default rounded-lg shadow-lg overflow-hidden min-w-48 py-1">
    <div class="px-3 py-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
      Insert date
    </div>
    <button
      v-for="(item, i) in items"
      :key="item.id"
      class="flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors gap-6"
      :class="i === selectedIndex ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300' : 'text-default hover:bg-elevated'"
      @click="select(item)"
      @mouseenter="selectedIndex = i"
    >
      <span class="flex items-center gap-2">
        <UIcon name="i-lucide-calendar" class="size-3.5 text-muted shrink-0" />
        {{ item.label }}
      </span>
      <span class="text-xs text-muted shrink-0">{{ item.hint }}</span>
    </button>
  </div>
</template>
