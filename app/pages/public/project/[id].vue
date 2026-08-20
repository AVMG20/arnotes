<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { columnDotClass, tagChipClass } from '~/utils/tagColors'

// A shared board: the columns and the cards on them, and nothing else. No
// sidebar, no editing, no task updates — a reader gets the state of the work,
// not the tools for changing it.

interface PublicColumn {
  id: string
  name: string
  position: number
}

interface PublicTask {
  id: string
  columnId: string
  title: string
  description: string
  tags: string[]
  position: number
  createdAt: number
  updatedAt: number
}

interface PublicBoard {
  project: { id: string, name: string, createdAt: number, updatedAt: number }
  columns: PublicColumn[]
  tasks: PublicTask[]
}

const route = useRoute()
const router = useRouter()

const board = ref<PublicBoard | null>(null)
const error = ref(false)
const isLoggedIn = ref(false)

const projectId = computed(() => route.params.id as string)

useSeoMeta({
  title: computed(() => board.value?.project.name || 'Shared board'),
  description: computed(() => board.value ? `Follow "${board.value.project.name}" on Arnotes` : undefined)
})

async function loadBoard() {
  try {
    board.value = await $fetch<PublicBoard>(`/api/public/project/${projectId.value}`)
    error.value = false
  } catch {
    board.value = null
    error.value = true
  }
}

onMounted(async () => {
  const { authClient } = await import('~/composables/useAuth')
  const { data: session } = await authClient.getSession()
  isLoggedIn.value = !!session

  await loadBoard()
})

// A board is a live thing — cards move while people watch it — so the page
// follows every change to it instead of needing a reload.
usePublicLive(() => ({ kind: 'project', id: projectId.value }), loadBoard)

function goHome() {
  router.push(isLoggedIn.value ? '/projects' : '/login')
}

const columns = computed(() =>
  [...(board.value?.columns ?? [])].sort((a, b) => a.position - b.position)
)

const tasksByColumn = computed(() => {
  const map = new Map<string, PublicTask[]>()
  for (const column of columns.value) map.set(column.id, [])
  for (const task of board.value?.tasks ?? []) map.get(task.columnId)?.push(task)
  for (const tasks of map.values()) tasks.sort((a, b) => a.position - b.position)
  return map
})

function tasksOf(columnId: string): PublicTask[] {
  return tasksByColumn.value.get(columnId) ?? []
}

const taskCount = computed(() => board.value?.tasks.length ?? 0)

// ─── Read-only task detail ─────────────────────────────────

const openTaskId = ref<string | null>(null)

const openTask = computed<PublicTask | null>(() =>
  openTaskId.value ? board.value?.tasks.find(t => t.id === openTaskId.value) ?? null : null
)

// The modal fades out rather than vanishing, so it keeps rendering the task it
// was opened with: reading off openTask would empty it mid-animation.
const shownTask = ref<PublicTask | null>(null)

// A card that is deleted while its panel is open closes it rather than leaving
// an empty modal behind.
watch(openTask, (task) => {
  if (task) shownTask.value = task
  else if (openTaskId.value) openTaskId.value = null
})

const shownTaskColumn = computed(() =>
  columns.value.find(c => c.id === shownTask.value?.columnId) ?? null
)
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-default">
    <!-- Top navbar -->
    <header class="flex shrink-0 items-center gap-3 border-b border-default px-4 py-3 lg:px-6">
      <button
        class="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-75"
        @click="goHome"
      >
        <AppLogo class="text-xl" />
      </button>

      <template v-if="board">
        <div class="h-4 w-px shrink-0 bg-muted/40" />
        <h1 class="min-w-0 truncate text-base font-semibold text-default">
          {{ board.project.name }}
        </h1>
        <span class="shrink-0 text-xs text-dimmed">
          {{ taskCount }} {{ taskCount === 1 ? 'task' : 'tasks' }}
        </span>
      </template>

      <span class="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-dimmed">
        <UIcon
          name="i-lucide-eye"
          class="size-3.5"
        />
        <span class="hidden sm:inline">Read-only</span>
      </span>
    </header>

    <!-- Error state -->
    <div
      v-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
    >
      <UIcon
        name="i-lucide-unlink"
        class="size-12 text-muted"
      />
      <p class="text-sm text-muted">
        This board is not available or has been made private.
      </p>
      <UButton
        :label="isLoggedIn ? 'Go to my boards' : 'Go to app'"
        color="primary"
        variant="soft"
        size="sm"
        @click="goHome"
      />
    </div>

    <!-- Loading state -->
    <div
      v-else-if="!board"
      class="flex flex-1 items-center justify-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-6 animate-spin text-muted"
      />
    </div>

    <!-- Board -->
    <div
      v-else-if="columns.length"
      class="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto px-4 py-4 lg:px-6"
    >
      <section
        v-for="column in columns"
        :key="column.id"
        class="flex h-full w-[19rem] shrink-0 flex-col rounded-xl bg-elevated/50"
      >
        <header class="flex items-center gap-2 px-3 pb-2 pt-2.5">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="columnDotClass(column.name)"
          />
          <span
            class="min-w-0 truncate text-sm font-semibold text-default"
            :title="column.name"
          >
            {{ column.name }}
          </span>
          <span class="shrink-0 text-xs tabular-nums text-dimmed">
            {{ tasksOf(column.id).length }}
          </span>
        </header>

        <div class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-hidden">
          <KanbanCard
            v-for="task in tasksOf(column.id)"
            :key="task.id"
            :task="task"
            @open="openTaskId = $event"
          />

          <p
            v-if="!tasksOf(column.id).length"
            class="px-1 py-2 text-xs text-dimmed"
          >
            Nothing here yet
          </p>
        </div>
      </section>
    </div>

    <div
      v-else
      class="flex flex-1 items-center justify-center px-8 text-center"
    >
      <p class="text-sm text-muted">
        This board has no columns yet.
      </p>
    </div>

    <!-- Task detail, read-only -->
    <UModal
      :open="openTask !== null"
      :title="shownTask?.title ?? ''"
      :ui="{ content: 'max-w-2xl' }"
      @update:open="(value: boolean) => { if (!value) openTaskId = null }"
    >
      <template #body>
        <div
          v-if="shownTask"
          class="space-y-3"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              v-if="shownTaskColumn"
              class="flex items-center gap-1.5 text-xs text-muted"
            >
              <span
                class="size-2 rounded-full"
                :class="columnDotClass(shownTaskColumn.name)"
              />
              {{ shownTaskColumn.name }}
            </span>
            <span
              v-for="tag in shownTask.tags"
              :key="tag"
              class="rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset"
              :class="tagChipClass(tag)"
            >
              {{ tag }}
            </span>
          </div>

          <!-- The editor pads itself for a full page; inside a modal that
               padding reads as the text being indented from everything else. -->
          <ReadOnlyRichText
            v-if="shownTask.description"
            :content="shownTask.description"
            :ui="{ base: 'sm:px-0 *:my-3' }"
          />
          <p
            v-else
            class="text-sm text-dimmed"
          >
            No description.
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>
