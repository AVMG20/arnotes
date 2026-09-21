<script setup lang="ts">
import { ref, watch } from 'vue'
import type { DateItem } from '~/utils/editor/date-parser'

// The list under an `@`: what the typed text could mean as a date.
const props = defineProps<{
  items: DateItem[]
  query: string
  command: (item: DateItem) => void
}>()

const selectedIndex = ref(0)

watch(() => props.items, () => {
  selectedIndex.value = 0
})

function onKeyDown(event: KeyboardEvent): boolean {
  if (!props.items.length) return false
  if (event.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value - 1 + props.items.length) % props.items.length
    return true
  }
  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    const item = props.items[selectedIndex.value]
    if (item) props.command(item)
    return true
  }
  return false
}

defineExpose({ onKeyDown })
</script>

<template>
  <div class="w-64 overflow-hidden rounded-lg border border-default bg-default p-1 shadow-lg">
    <template v-if="items.length">
      <button
        v-for="(item, i) in items"
        :key="item.id"
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
        :class="i === selectedIndex ? 'bg-elevated text-highlighted' : 'text-default'"
        @click="command(item)"
        @mouseenter="selectedIndex = i"
      >
        <UIcon
          :name="item.id === 'now' ? 'i-lucide-clock' : 'i-lucide-calendar'"
          class="size-4 shrink-0"
          :class="i === selectedIndex ? 'text-primary' : 'text-dimmed'"
        />
        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
        <span class="shrink-0 text-xs text-muted tabular-nums">{{ item.hint }}</span>
      </button>
    </template>

    <p
      v-else
      class="px-2 py-1.5 text-xs text-muted"
    >
      No date in “{{ query }}”. Try <span class="text-default">fri</span>,
      <span class="text-default">in 3 days</span>,
      <span class="text-default">25 dec</span> or
      <span class="text-default">tomorrow 15:00</span>.
    </p>

    <div class="mt-1 flex items-center gap-2 border-t border-default px-2 pt-1.5 pb-0.5 text-[11px] text-dimmed">
      <span><UKbd
        value="↵"
        size="sm"
      /> insert</span>
      <span class="ml-auto truncate">today · fri · 3d · 25 dec · 15:00</span>
    </div>
  </div>
</template>
