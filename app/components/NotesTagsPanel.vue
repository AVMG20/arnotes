<script setup lang="ts">
import { computed } from 'vue'

const { notes, allTags, activeTag, searchQuery, trackTagClick } = useNotes()

const totalCount = computed(() => notes.value.length)

function selectTag(tag: string | null) {
  activeTag.value = tag
  searchQuery.value = ''
  if (tag) trackTagClick(tag)
}
</script>

<template>
  <div class="flex flex-col h-full border-r border-default bg-default overflow-y-auto">
    <nav class="flex-1 p-2 space-y-0.5">
      <!-- All Notes -->
      <button
        class="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors"
        :class="!activeTag
          ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-medium'
          : 'text-muted hover:bg-elevated hover:text-default'"
        @click="selectTag(null)"
      >
        <span class="flex items-center gap-2 min-w-0">
          <UIcon name="i-lucide-inbox" class="size-3.5 shrink-0" />
          <span class="truncate">All Notes</span>
        </span>
        <span class="text-xs tabular-nums opacity-50 ml-1 shrink-0">{{ totalCount }}</span>
      </button>

      <!-- Tags -->
      <template v-if="allTags.length > 0">
        <div class="pt-3 pb-1 px-2.5">
          <span class="text-xs font-semibold text-muted uppercase tracking-wider">Tags</span>
        </div>

        <button
          v-for="{ tag, count } in allTags"
          :key="tag"
          class="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors"
          :class="activeTag === tag
            ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-medium'
            : 'text-muted hover:bg-elevated hover:text-default'"
          @click="selectTag(tag)"
        >
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="text-primary-400 font-bold text-xs shrink-0 leading-none">#</span>
            <span class="truncate">{{ tag }}</span>
          </span>
          <span class="text-xs tabular-nums opacity-50 ml-1 shrink-0">{{ count }}</span>
        </button>
      </template>

      <div v-else class="px-2.5 pt-4 text-xs text-muted text-center leading-relaxed">
        Use <span class="text-primary-500">#tag</span> in a note
      </div>
    </nav>
  </div>
</template>
