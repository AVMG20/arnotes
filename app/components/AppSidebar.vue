<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()
const { activeNoteId, createNote } = useNotes()
const searchOpen = useSearchModal()
const { session, signOut } = useAuth()
const colorMode = useColorMode()
const route = useRoute()

const isTasksView = computed(() => route.path.startsWith('/tasks'))

const userInitials = computed(() => {
  const name = session.value?.user?.name
  if (!name) return '?'
  return name.split(' ').map((part: string) => part[0]).join('').slice(0, 2).toUpperCase()
})

const isDark = computed(() => colorMode.value === 'dark')

function toggleColorMode() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

const accountItems = computed(() => [[
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    onSelect: () => navigateTo('/settings')
  },
  {
    label: isDark.value ? 'Light mode' : 'Dark mode',
    icon: isDark.value ? 'i-lucide-sun' : 'i-lucide-moon',
    onSelect: toggleColorMode
  }
], [
  {
    label: 'Sign out',
    icon: 'i-lucide-log-out',
    color: 'error' as const,
    onSelect: signOut
  }
]])

watch(activeNoteId, () => emit('close'))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-default">
    <div class="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
      <AppLogo class="min-w-0 flex-1 text-xl" />
      <UButton
        icon="i-lucide-square-pen"
        size="sm"
        color="primary"
        variant="soft"
        aria-label="New note"
        class="shrink-0 rounded-lg"
        @click="createNote(undefined)"
      />
    </div>

    <div class="shrink-0 space-y-2 px-3 pb-2">
      <!-- Tasks nav -->
      <button
        class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer"
        :class="isTasksView ? 'bg-elevated text-default font-medium' : 'text-muted hover:bg-elevated hover:text-default'"
        @click="navigateTo('/tasks')"
      >
        <UIcon
          name="i-lucide-square-check-big"
          class="size-4 shrink-0"
        />
        <span class="min-w-0 flex-1 truncate text-left">Tasks</span>
      </button>

      <button
        class="flex w-full items-center gap-2.5 rounded-lg border border-default bg-elevated/40 px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-default"
        @click="searchOpen = true"
      >
        <UIcon
          name="i-lucide-search"
          class="size-4 shrink-0"
        />
        <span class="min-w-0 flex-1 truncate text-left">Search notes...</span>
        <UKbd
          value="meta"
          size="sm"
        />
        <UKbd
          value="K"
          size="sm"
        />
      </button>

      <NotesTagsPanel />
    </div>

    <NotesListPanel class="min-h-0 flex-1" />

    <div class="shrink-0 space-y-1.5 border-t border-default p-2">
      <TeamSwitcher />
      <UDropdownMenu
        :items="accountItems"
        :content="{ align: 'start', collisionPadding: 12 }"
        :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width) min-w-48' }"
      >
        <button class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-default">
          <UAvatar
            :alt="userInitials"
            size="xs"
            class="shrink-0"
          />
          <span class="min-w-0 flex-1 truncate text-left text-xs">
            {{ session?.user?.name ?? session?.user?.email }}
          </span>
          <UIcon
            name="i-lucide-chevrons-up-down"
            class="size-3.5 shrink-0 opacity-50"
          />
        </button>
      </UDropdownMenu>
    </div>
  </div>
</template>
