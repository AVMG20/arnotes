<script setup lang="ts">
import { relativeTime } from '~/composables/useRelativeTime'

const { ready, projects, allTasks, deleteProject, renameProject } = useProjects()
const route = useRoute()

const activeId = computed(() => (route.params.id as string | undefined) ?? null)

function openProject(id: string) {
  if (route.path !== `/projects/${id}`) navigateTo(`/projects/${id}`)
}

// Project creation lives on one surface only: /projects?new=1.
function newProject() {
  navigateTo('/projects?new=1')
}

const taskCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const task of allTasks.value) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1)
  return counts
})

// ─── Inline rename / delete ────────────────────────────────

const renamingId = ref<string | null>(null)
const renameValue = ref('')

async function startRename(project: { id: string, name: string }) {
  renamingId.value = project.id
  renameValue.value = project.name
  // A `ref` inside v-for collects into an array, so the one mounted input is
  // picked up from the DOM instead.
  await nextTick()
  document.querySelector<HTMLInputElement>('[data-project-rename]')?.select()
}

async function commitRename(project: { id: string, name: string }) {
  const id = renamingId.value
  const name = renameValue.value.trim()
  renamingId.value = null
  if (id && name && name !== project.name) await renameProject(id, name)
}

const deleteTarget = ref<{ id: string, name: string } | null>(null)

async function confirmDelete() {
  const target = deleteTarget.value
  deleteTarget.value = null
  if (!target) return
  await deleteProject(target.id)
  if (activeId.value === target.id) navigateTo('/projects')
}

function menuItems(project: { id: string, name: string }) {
  return [[
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(project) }
  ], [
    {
      label: 'Delete project',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => { deleteTarget.value = project }
    }
  ]]
}
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <div class="flex items-center justify-between px-2 pb-1">
      <span class="text-xs font-semibold uppercase tracking-wider text-dimmed">Projects</span>
      <UButton
        icon="i-lucide-plus"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="New project"
        @click="newProject"
      />
    </div>

    <p
      v-if="ready && projects.length === 0"
      class="px-2 py-3 text-xs text-dimmed"
    >
      No projects yet.
      <button
        class="text-primary hover:underline"
        @click="newProject"
      >
        Create one
      </button>
    </p>

    <template
      v-for="project in projects"
      :key="project.id"
    >
      <input
        v-if="renamingId === project.id"
        v-model="renameValue"
        data-project-rename
        class="w-full rounded-lg bg-default px-2.5 py-1.5 text-sm font-medium text-default outline-none ring-1 ring-primary"
        @keydown.enter.prevent="commitRename(project)"
        @keydown.escape="renamingId = null"
        @blur="commitRename(project)"
      >
      <div
        v-else
        class="group flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
        :class="activeId === project.id ? 'bg-elevated' : 'hover:bg-elevated/60'"
        @click="openProject(project.id)"
      >
        <UIcon
          name="i-lucide-kanban"
          class="mt-0.5 size-4 shrink-0"
          :class="activeId === project.id ? 'text-primary' : 'text-dimmed group-hover:text-muted'"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium leading-snug text-default">
            {{ project.name }}
          </p>
          <p class="truncate text-xs text-muted">
            {{ relativeTime(project.updatedAt) }} · {{ taskCounts.get(project.id) ?? 0 }} {{ (taskCounts.get(project.id) ?? 0) === 1 ? 'task' : 'tasks' }}
          </p>
        </div>
        <!-- The menu keeps its slot even when invisible, so rows never jump on hover. -->
        <UDropdownMenu
          :items="menuItems(project)"
          :content="{ align: 'start', collisionPadding: 12 }"
        >
          <UButton
            icon="i-lucide-ellipsis"
            size="xs"
            color="neutral"
            variant="ghost"
            class="mt-0.5 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            aria-label="Project options"
            @click.stop
          />
        </UDropdownMenu>
      </div>
    </template>

    <UModal
      :open="deleteTarget !== null"
      title="Delete project?"
      description="Columns, tasks and updates are deleted with it. This cannot be undone."
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) deleteTarget = null }"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deleteTarget = null"
        />
        <UButton
          label="Delete project"
          color="error"
          @click="confirmDelete"
        />
      </template>
    </UModal>
  </div>
</template>
