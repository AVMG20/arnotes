<script setup lang="ts">
import type { AppMode } from '~/composables/useSidebar'

const emit = defineEmits<{ close: [] }>()
const { activeNoteId, createNote } = useNotes()
const { openMemoryId } = useArchive()
const searchOpen = useSearchModal()
const { session, signOut } = useAuth()
const { appMode } = useSidebar()
const colorMode = useColorMode()
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
// Opening a memory from the list on a phone: the viewer slides in over the
// page, so the sidebar it was picked from gets out of the way.
watch(openMemoryId, (id) => {
  if (id) emit('close')
})

async function newNote() {
  const note = await createNote()
  navigateTo(`/note/${note.id}`)
}

async function newProject() {
  appMode.value = 'projects'
  navigateTo('/projects?new=1')
}

// Archive has nothing to create — you talk to it instead, so it gets no button.
const createAction = computed(() => {
  if (appMode.value === 'projects') {
    return { icon: 'i-lucide-kanban', label: 'New project', run: newProject }
  }
  if (appMode.value === 'notes') {
    return { icon: 'i-lucide-square-pen', label: 'New note', run: newNote }
  }
  return null
})

const route = useRoute()

// Direct navigation (search result, URL) syncs the toggle with the real view.
watch(() => route.path, (path) => {
  if (path.startsWith('/projects')) appMode.value = 'projects'
  else if (path.startsWith('/archive')) appMode.value = 'archive'
  else if (path.startsWith('/note')) appMode.value = 'notes'
}, { immediate: true })

const MODES = [
  { key: 'notes', label: 'Notes', icon: 'i-lucide-notebook-pen', path: '/note' },
  { key: 'projects', label: 'Projects', icon: 'i-lucide-kanban', path: '/projects' },
  { key: 'archive', label: 'Archive', icon: 'i-lucide-archive', path: '/archive' }
] as const

function switchMode(mode: AppMode) {
  appMode.value = mode
  const target = MODES.find(entry => entry.key === mode)
  if (target && !route.path.startsWith(target.path)) navigateTo(target.path)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-default">
    <div class="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4">
      <AppLogo class="min-w-0 flex-1 text-xl" />
      <UButton
        v-if="createAction"
        :icon="createAction.icon"
        size="sm"
        color="primary"
        variant="soft"
        :aria-label="createAction.label"
        class="shrink-0 rounded-lg"
        @click="createAction.run()"
      />
    </div>

    <!-- Notes / Projects mode toggle -->
    <div class="shrink-0 px-3 pb-2">
      <div class="grid grid-cols-3 gap-1 rounded-lg bg-elevated/60 p-1">
        <button
          v-for="mode in MODES"
          :key="mode.key"
          class="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
          :class="appMode === mode.key ? 'bg-default text-default shadow-sm' : 'text-muted hover:text-default'"
          @click="switchMode(mode.key)"
        >
          <UIcon
            :name="mode.icon"
            class="size-4 shrink-0"
          />
          {{ mode.label }}
        </button>
      </div>
    </div>

    <div class="shrink-0 space-y-2 px-3 pb-2">
      <button
        v-if="appMode !== 'archive'"
        class="flex w-full items-center gap-2.5 rounded-lg border border-default bg-elevated/40 px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-default"
        @click="searchOpen = true"
      >
        <UIcon
          name="i-lucide-search"
          class="size-4 shrink-0"
        />
        <span class="min-w-0 flex-1 truncate text-left">Search everything...</span>
        <UKbd
          value="meta"
          size="sm"
        />
        <UKbd
          value="K"
          size="sm"
        />
      </button>

      <NotesTagsPanel v-if="appMode === 'notes'" />
    </div>

    <NotesListPanel
      v-if="appMode === 'notes'"
      class="min-h-0 flex-1"
    />
    <div
      v-else-if="appMode === 'projects'"
      class="min-h-0 flex-1 overflow-y-auto p-2"
    >
      <ProjectsListPanel />
    </div>
    <!-- Archive files nothing by hand, but what it keeps is listed here so the
         user can see it, open it, and throw out what it got wrong. -->
    <ArchiveStorePanel
      v-else
      class="min-h-0 flex-1"
    />

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
