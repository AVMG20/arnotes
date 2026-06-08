<script setup lang="ts">
import { computed } from 'vue'

const { activeNotes, trashedNotes, allTags, activeTag, showTrash, searchQuery, trackTagClick } = useNotes()
const { session, signOut } = useAuth()
const colorMode = useColorMode()

const userInitials = computed(() => {
  const name = session.value?.user?.name
  if (!name) return '?'
  return name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
})

const isDark = computed(() => colorMode.value === 'dark')

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

const dropdownItems = computed(() => [[
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    onSelect: () => navigateTo('/settings'),
  },
  {
    label: isDark.value ? 'Light mode' : 'Dark mode',
    icon: isDark.value ? 'i-lucide-sun' : 'i-lucide-moon',
    onSelect: toggleColorMode,
  },
], [
  {
    label: 'Sign out',
    icon: 'i-lucide-log-out',
    color: 'error' as const,
    onSelect: signOut,
  },
]])

const totalCount = computed(() => activeNotes.value.length)

function selectTag(tag: string | null) {
  showTrash.value = false
  activeTag.value = tag
  searchQuery.value = ''
  if (tag) trackTagClick(tag)
}

function selectTrash() {
  showTrash.value = true
  activeTag.value = null
  searchQuery.value = ''
}
</script>

<template>
  <div class="flex flex-col h-full border-r border-default bg-default">
    <nav class="flex-1 p-2 space-y-0.5 overflow-y-auto">
      <!-- All Notes -->
      <button
        class="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors"
        :class="!activeTag && !showTrash
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

      <!-- Deleted / Trash -->
      <button
        class="flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-sm transition-colors"
        :class="showTrash
          ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300 font-medium'
          : 'text-muted hover:bg-elevated hover:text-default'"
        @click="selectTrash"
      >
        <span class="flex items-center gap-2 min-w-0">
          <UIcon name="i-lucide-trash-2" class="size-3.5 shrink-0" />
          <span class="truncate">Deleted</span>
        </span>
        <span v-if="trashedNotes.length > 0" class="text-xs tabular-nums opacity-50 ml-1 shrink-0">{{ trashedNotes.length }}</span>
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
          :class="activeTag === tag && !showTrash
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

    <div class="shrink-0 p-2 border-t border-default">
      <UDropdownMenu :items="dropdownItems" :ui="{ content: 'w-48' }">
        <button class="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-sm text-muted hover:bg-elevated hover:text-default transition-colors">
          <UAvatar
            :alt="userInitials"
            size="xs"
            class="shrink-0"
          />
          <span class="truncate flex-1 text-left text-xs">{{ session?.user?.name ?? session?.user?.email }}</span>
          <UIcon name="i-lucide-chevrons-up-down" class="size-3.5 shrink-0 opacity-50" />
        </button>
      </UDropdownMenu>
    </div>
  </div>
</template>
