<script setup lang="ts">
import type { ProjectTask } from '~/composables/useProjects'
import { tagChipClass } from '~/utils/tagColors'

definePageMeta({ layout: 'app' })

const route = useRoute()
const { appMode, sidebarOpen } = useSidebar()
const searchOpen = useSearchModal()
appMode.value = 'projects'

const {
  activeProject,
  loadBoard,
  board,
  renameProject,
  updateProjectSharing,
  deleteProject,
  activeTags,
  boardTagCounts,
  toggleTagFilter,
  clearTagFilter
} = useProjects()

const projectId = computed(() => route.params.id as string)

const loadFailed = ref(false)

watch(projectId, async (id) => {
  if (!id || !/^[a-z0-9]+$/i.test(id)) return
  loadFailed.value = false
  try {
    await loadBoard(id)
  } catch {
    // Deleted in another tab, or a board from a workspace this session no longer
    // has: an endless spinner is the one thing that must not happen.
    loadFailed.value = true
  }
}, { immediate: true })

// ─── Task panel ────────────────────────────────────────────

const drawerTaskId = ref<string | null>(null)

// Deep link ?task=<id> (global search) opens the panel.
watch(() => route.query.task, (taskId) => {
  drawerTaskId.value = typeof taskId === 'string' && taskId ? taskId : null
}, { immediate: true })

function closeDrawer() {
  drawerTaskId.value = null
  if (route.query.task) navigateTo({ path: route.path, replace: true })
}

const drawerTask = computed<ProjectTask | null>(() =>
  drawerTaskId.value ? board.value?.tasks.find(t => t.id === drawerTaskId.value) ?? null : null
)

// ─── Project name (inline rename) ──────────────────────────

const renaming = ref(false)
const nameDraft = ref('')
const nameEl = ref<HTMLInputElement | null>(null)

async function startRename() {
  if (!activeProject.value) return
  nameDraft.value = activeProject.value.name
  renaming.value = true
  await nextTick()
  nameEl.value?.select()
}

async function commitRename() {
  const name = nameDraft.value.trim()
  const project = activeProject.value
  renaming.value = false
  if (project && name && name !== project.name) await renameProject(project.id, name)
}

const deleteOpen = ref(false)

async function confirmDelete() {
  const project = activeProject.value
  deleteOpen.value = false
  if (!project) return
  await deleteProject(project.id)
  navigateTo('/projects')
}

const projectMenu = computed(() => [[
  { label: 'Rename project', icon: 'i-lucide-pencil', onSelect: startRename }
], [
  {
    label: 'Delete project',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { deleteOpen.value = true }
  }
]])

const taskCount = computed(() => board.value?.tasks.length ?? 0)

// ─── Sharing ───────────────────────────────────────────────

const publicLink = computed(() =>
  activeProject.value && import.meta.client
    ? `${window.location.origin}/public/project/${activeProject.value.id}`
    : ''
)

function saveSharing(isPublic: boolean, publicUntil: number | null) {
  return updateProjectSharing(projectId.value, isPublic, publicUntil)
}

useSeoMeta({
  title: computed(() => activeProject.value?.name || 'Projects')
})
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col">
    <!-- Board header -->
    <header class="flex shrink-0 items-center gap-2 border-b border-default px-4 py-3 lg:px-6">
      <UButton
        icon="i-lucide-panel-left"
        color="neutral"
        variant="ghost"
        size="sm"
        class="lg:hidden"
        aria-label="Open sidebar"
        @click="sidebarOpen = true"
      />

      <input
        v-if="renaming"
        ref="nameEl"
        v-model="nameDraft"
        class="min-w-0 max-w-80 flex-1 rounded bg-elevated px-2 py-1 text-base font-semibold text-default outline-none ring-1 ring-primary"
        @keydown.enter.prevent="commitRename"
        @keydown.escape="renaming = false"
        @blur="commitRename"
      >
      <button
        v-else
        class="min-w-0 truncate rounded px-1 py-0.5 text-base font-semibold text-default transition-colors hover:bg-elevated"
        :title="activeProject?.name"
        @click="startRename"
      >
        {{ activeProject?.name ?? 'Board' }}
      </button>

      <span class="shrink-0 text-xs text-dimmed">
        {{ taskCount }} {{ taskCount === 1 ? 'task' : 'tasks' }}
      </span>

      <div class="ml-auto flex shrink-0 items-center gap-1">
        <!-- Label filter -->
        <UPopover
          v-if="boardTagCounts.length"
          :content="{ align: 'end', sideOffset: 6 }"
        >
          <UButton
            icon="i-lucide-filter"
            size="xs"
            :color="activeTags.length ? 'primary' : 'neutral'"
            :variant="activeTags.length ? 'soft' : 'ghost'"
          >
            <span class="hidden sm:inline">Labels</span>
            <span v-if="activeTags.length">{{ activeTags.length }}</span>
          </UButton>

          <template #content>
            <div class="w-56 p-1.5">
              <div class="flex items-center justify-between px-1.5 pb-1.5">
                <span class="text-xs font-semibold text-muted">Filter by label</span>
                <button
                  v-if="activeTags.length"
                  class="text-xs text-primary hover:underline"
                  @click="clearTagFilter"
                >
                  Clear
                </button>
              </div>
              <button
                v-for="[tag, count] in boardTagCounts"
                :key="tag"
                class="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-elevated"
                @click="toggleTagFilter(tag)"
              >
                <UIcon
                  :name="activeTags.includes(tag) ? 'i-lucide-square-check' : 'i-lucide-square'"
                  class="size-3.5 shrink-0"
                  :class="activeTags.includes(tag) ? 'text-primary' : 'text-dimmed'"
                />
                <span
                  class="min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset"
                  :class="tagChipClass(tag)"
                >
                  {{ tag }}
                </span>
                <span class="shrink-0 text-xs tabular-nums text-dimmed">{{ count }}</span>
              </button>
            </div>
          </template>
        </UPopover>

        <SharePopover
          v-if="activeProject"
          subject="board"
          :is-public="activeProject.isPublic"
          :public-until="activeProject.publicUntil"
          :link="publicLink"
          :save="saveSharing"
        />

        <UDropdownMenu :items="projectMenu">
          <UButton
            icon="i-lucide-ellipsis"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Project options"
          />
        </UDropdownMenu>
      </div>
    </header>

    <!-- Active filter summary -->
    <div
      v-if="activeTags.length"
      class="flex shrink-0 items-center gap-1.5 border-b border-default px-4 py-2 lg:px-6"
    >
      <span class="text-xs text-dimmed">Showing tasks labelled</span>
      <span
        v-for="tag in activeTags"
        :key="tag"
        class="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset"
        :class="tagChipClass(tag)"
        @click="toggleTagFilter(tag)"
      >
        {{ tag }}
        <UIcon
          name="i-lucide-x"
          class="size-3 opacity-50"
        />
      </span>
    </div>

    <!-- Board -->
    <div class="min-h-0 flex-1">
      <div
        v-if="loadFailed"
        class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <UIcon
          name="i-lucide-unlink"
          class="size-6 text-dimmed"
        />
        <p class="text-sm text-muted">
          This board is not available in this workspace.
        </p>
        <UButton
          label="Back to projects"
          size="sm"
          color="neutral"
          variant="soft"
          @click="navigateTo('/projects')"
        />
      </div>
      <KanbanBoard
        v-else-if="projectId"
        :project-id="projectId"
        @open-task="drawerTaskId = $event"
      />
    </div>

    <!-- Task panel -->
    <KanbanTaskDrawer
      :task="drawerTask"
      @close="closeDrawer"
    />

    <UModal
      v-model:open="deleteOpen"
      title="Delete project?"
      description="Columns, tasks and updates are deleted with it. This cannot be undone."
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteOpen = false"
        />
        <UButton
          label="Delete project"
          color="error"
          @click="confirmDelete"
        />
      </template>
    </UModal>

    <!-- Mobile bottom nav -->
    <div
      class="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-default bg-default/95 px-8 backdrop-blur-sm lg:hidden"
      style="padding-top: 0.5rem; padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
    >
      <UButton
        icon="i-lucide-panel-left"
        color="neutral"
        variant="ghost"
        size="md"
        aria-label="Open sidebar"
        @click="sidebarOpen = true"
      />
      <UButton
        icon="i-lucide-search"
        color="neutral"
        variant="ghost"
        size="md"
        aria-label="Search"
        @click="searchOpen = true"
      />
      <UButton
        icon="i-lucide-kanban"
        color="primary"
        variant="soft"
        size="md"
        aria-label="Projects"
        @click="navigateTo('/projects')"
      />
    </div>

    <div class="h-14 lg:hidden" />
  </div>
</template>
