<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'

const {
  activeNotes,
  trashedNotes,
  sharedNotes,
  allTags,
  activeTag,
  showTrash,
  showShared,
  searchQuery,
  trackTagClick
} = useNotes()

const open = ref(false)
const filterSearch = ref('')

const activeFilter = computed(() => {
  if (showTrash.value) {
    return { label: 'Deleted', icon: 'i-lucide-trash-2', count: trashedNotes.value.length }
  }
  if (showShared.value) {
    return { label: 'Shared', icon: 'i-lucide-globe-2', count: sharedNotes.value.length }
  }
  if (activeTag.value) {
    const count = allTags.value.find(item => item.tag === activeTag.value)?.count ?? 0
    return { label: `#${activeTag.value}`, icon: 'i-lucide-hash', count }
  }
  return { label: 'All notes', icon: 'i-lucide-inbox', count: activeNotes.value.length }
})

function selectView(view: 'all' | 'shared' | 'deleted', tag?: string) {
  showTrash.value = view === 'deleted'
  showShared.value = view === 'shared'
  activeTag.value = tag ?? null
  searchQuery.value = ''
  if (tag) trackTagClick(tag)
  open.value = false
  filterSearch.value = ''
}

function item(
  label: string,
  icon: string,
  count: number,
  active: boolean,
  onSelect: () => void
): CommandPaletteItem {
  return {
    label,
    icon,
    suffix: String(count),
    active,
    onSelect
  }
}

const groups = computed<CommandPaletteGroup[]>(() => [{
  id: 'views',
  label: 'Views',
  items: [
    item('All notes', 'i-lucide-inbox', activeNotes.value.length, !activeTag.value && !showTrash.value && !showShared.value, () => selectView('all')),
    item('Shared', 'i-lucide-globe-2', sharedNotes.value.length, showShared.value, () => selectView('shared')),
    item('Deleted', 'i-lucide-trash-2', trashedNotes.value.length, showTrash.value, () => selectView('deleted'))
  ]
}, {
  id: 'tags',
  label: 'Tags',
  items: allTags.value.map(({ tag, count }) => item(
    `#${tag}`,
    'i-lucide-hash',
    count,
    activeTag.value === tag && !showTrash.value && !showShared.value,
    () => selectView('all', tag)
  ))
}])

watch(open, (isOpen) => {
  if (!isOpen) filterSearch.value = ''
})
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', side: 'bottom', collisionPadding: 12 }"
    :ui="{ content: 'w-(--reka-popover-trigger-width) min-w-64 overflow-hidden p-0' }"
  >
    <button
      class="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-elevated data-[state=open]:bg-elevated"
      aria-label="Choose note filter"
    >
      <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <UIcon
          :name="activeFilter.icon"
          class="size-4"
        />
      </span>
      <span class="min-w-0 flex-1 truncate text-left font-medium text-default">
        {{ activeFilter.label }}
      </span>
      <span class="text-xs tabular-nums text-dimmed">{{ activeFilter.count }}</span>
      <UIcon
        name="i-lucide-chevrons-up-down"
        class="size-3.5 shrink-0 text-dimmed transition-colors group-hover:text-muted"
      />
    </button>

    <template #content>
      <UCommandPalette
        v-model:search-term="filterSearch"
        :groups="groups"
        placeholder="Search views or tags..."
        class="max-h-80"
        :fuse="{ resultLimit: 50 }"
        :ui="{
          input: '[&>input]:h-10 [&>input]:text-sm',
          group: 'p-1.5',
          item: 'rounded-md',
          itemLabelSuffix: 'ml-auto tabular-nums text-dimmed'
        }"
      />
    </template>
  </UPopover>
</template>
