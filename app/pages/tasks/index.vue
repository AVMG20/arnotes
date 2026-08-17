<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'
import { dueInfo } from '~/composables/useTasks'

definePageMeta({ layout: 'app' })

const route = useRoute()
const router = useRouter()
const { sidebarOpen } = useSidebar()
const searchOpen = useSearchModal()
const { ready, notes, activeNoteId } = useNotes()
const {
  tasks,
  openCount,
  doneCount,
  filteredTasks,
  statusFilter,
  sort,
  query,
  selectedTaskId,
  selectTask,
  createTask,
  toggleTask,
  deleteNote
} = useTasks()

useSeoMeta({ title: 'Tasks' })

// ─── URL ↔ drawer sync ───────────────────────────────────────
// ?id= opens the drawer; opening/closing the drawer updates ?id= via the
// selectedTaskId watcher below. router.push keeps browser-history entries so
// back/forward close and reopen the drawer.

// Guards the selectedTaskId watcher while a URL-driven change propagates.
// Watchers flush asynchronously, so the flag must survive until nextTick.
let suppressUrlSync = false

watch(() => route.query.id, (id) => {
  suppressUrlSync = true
  if (typeof id === 'string') selectTask(id)
  else if (id === undefined) selectTask(null)
  nextTick(() => {
    suppressUrlSync = false
  })
})

watch(selectedTaskId, (id) => {
  if (suppressUrlSync) return
  // Once we've left /tasks (e.g. sidebar note click), never push back to it.
  if (route.path !== '/tasks') return
  if (id && route.query.id !== id) router.push({ path: '/tasks', query: { id } })
  else if (!id && route.query.id !== undefined) router.push({ path: '/tasks' })
})

// Navigating away (e.g. to a note) must still clear the drawer state.
watch(() => route.path, (p) => {
  if (!p.startsWith('/tasks')) selectTask(null)
})

// Clicking a note in the sidebar while on Tasks returns to the notes view.
// Suppression is required: the route change would otherwise trigger the
// sync watcher and insert a bare /tasks entry into the history.
watch(activeNoteId, (id) => {
  if (!id || id === selectedTaskId.value) return
  const note = notes.value.find(n => n.id === id)
  if (note && !note.isTask) {
    suppressUrlSync = true
    router.push('/note/' + id).finally(() => {
      nextTick(() => {
        suppressUrlSync = false
      })
    })
  }
})

// Opening a linked note from the task drawer.
function openLinkedNote(id: string) {
  suppressUrlSync = true
  router.push('/note/' + id).finally(() => {
    nextTick(() => {
      suppressUrlSync = false
    })
  })
}

// ─── Tag filtering (query supports "#tag" tokens) ────────────

function toggleTagFilter(tag: string) {
  const tokens = query.value.split(/\s+/).filter(Boolean)
  const token = '#' + tag
  const next = tokens.includes(token)
    ? tokens.filter(t => t !== token)
    : [...tokens, token]
  query.value = next.join(' ')
}

function hasTagFilter(tag: string) {
  return query.value.split(/\s+/).includes('#' + tag)
}

// Autocomplete for a trailing "#par…" token in the filter input.
const tagSuggestions = computed(() => {
  const partial = /#([\w]*)$/.exec(query.value)?.[1]
  if (partial === undefined) return []
  const counts = new Map<string, number>()
  for (const t of tasks.value) {
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const lower = partial.toLowerCase()
  return [...counts.entries()]
    .filter(([tag]) => tag.startsWith(lower))
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)
    .slice(0, 6)
})

function completeTag(tag: string) {
  query.value = query.value.replace(/#([\w]*)$/, `#${tag} `)
  searchInputRef.value?.focus()
}

const searchInputRef = ref<HTMLInputElement | null>(null)

function onSearchKeydown(e: KeyboardEvent) {
  if (tagSuggestions.value.length === 0) return
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault()
    completeTag(tagSuggestions.value[0]!)
  }
}

// ─── Sort menu ───────────────────────────────────────────────

const sortItems = [
  { label: 'Last updated', value: 'updated' },
  { label: 'Recently created', value: 'created' },
  { label: 'Due date', value: 'due' }
]

const statusTabs = computed(() => [
  { label: 'Open', value: 'open' as const, count: openCount.value },
  { label: 'Done', value: 'done' as const, count: doneCount.value },
  { label: 'All', value: 'all' as const, count: openCount.value + doneCount.value }
])

function setTab(value: string | number) {
  statusFilter.value = value as 'open' | 'done' | 'all'
}

// ─── Due badge ───────────────────────────────────────────────

function dueBadge(dueAt: number | null): { label: string, color: 'error' | 'warning' | 'primary' | 'neutral' } | null {
  const info = dueInfo(dueAt)
  if (!info) return null
  const color = info.tone === 'overdue'
    ? 'error'
    : info.tone === 'today'
      ? 'warning'
      : info.tone === 'soon'
        ? 'primary'
        : 'neutral'
  return { label: info.label, color }
}

// ─── Keyboard shortcuts ──────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && selectedTaskId.value) {
    selectTask(null)
    return
  }
  if (!e.metaKey && !e.ctrlKey) return
  if (e.key === 'n') {
    e.preventDefault()
    submitUntitled()
  }
}

async function submitUntitled() {
  const task = await createTask({})
  selectTask(task.id)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex min-w-0 flex-1 overflow-hidden">
    <!-- List column -->
    <div class="flex min-w-0 flex-1 flex-col bg-default pb-14 lg:pb-0">
      <!-- Header -->
      <div class="shrink-0 border-b border-default px-6 py-4">
        <div class="flex items-center gap-3">
          <h1 class="text-xl font-semibold text-default">
            Tasks
          </h1>
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
          >
            {{ openCount }} open
          </UBadge>
        </div>

        <!-- Status tabs -->
        <div class="mt-3 flex items-center gap-1">
          <button
            v-for="tab in statusTabs"
            :key="tab.value"
            class="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors cursor-pointer"
            :class="statusFilter === tab.value
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted hover:bg-elevated hover:text-default'"
            @click="setTab(tab.value)"
          >
            {{ tab.label }}
            <span class="text-xs opacity-60">{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <!-- Toolbar: search + sort + new task -->
      <div class="shrink-0 px-4 pt-3">
        <div class="flex items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <div class="flex items-center gap-2.5 rounded-lg border border-default bg-elevated/40 px-3 py-2 transition-colors focus-within:border-primary/60">
              <UIcon
                name="i-lucide-search"
                class="size-4 shrink-0 text-muted"
              />
              <input
                ref="searchInputRef"
                v-model="query"
                placeholder="Search tasks… (# for tags)"
                class="min-w-0 flex-1 bg-transparent text-sm text-default outline-none placeholder:text-muted"
                @keydown="onSearchKeydown"
              >
            </div>

            <!-- #tag autocomplete -->
            <div
              v-if="tagSuggestions.length > 0"
              class="absolute left-0 right-0 top-full z-20 mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-default bg-default p-2 shadow-lg"
            >
              <button
                v-for="tag in tagSuggestions"
                :key="tag"
                class="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 shrink-0 cursor-pointer"
                @click="completeTag(tag)"
              >
                <span class="opacity-70">#</span>{{ tag }}
                <UIcon
                  name="i-lucide-corner-down-left"
                  class="size-2.5 opacity-50"
                />
              </button>
            </div>
          </div>

          <USelect
            v-model="sort"
            :items="sortItems"
            icon="i-lucide-arrow-up-down"
            size="sm"
            class="w-36 shrink-0"
          />
          <UButton
            icon="i-lucide-plus"
            label="New task"
            size="sm"
            color="primary"
            variant="soft"
            class="shrink-0"
            @click="submitUntitled"
          />
        </div>
      </div>

      <!-- List -->
      <template v-if="ready">
        <UScrollArea
          v-if="filteredTasks.length > 0"
          v-slot="{ item: task }"
          :items="filteredTasks"
          :virtualize="{
            estimateSize: 56,
            overscan: 20,
            paddingStart: 12,
            paddingEnd: 12,
            gap: 2
          }"
          class="mx-2 mb-2 mt-2 min-h-0 flex-1"
          :ui="{ viewport: 'px-1' }"
        >
          <div
            class="group relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 transition-colors"
            :class="selectedTaskId === task.id ? 'bg-elevated ring-1 ring-inset ring-default' : 'hover:bg-elevated/60'"
            @click="selectTask(task.id)"
          >
            <!-- Checkbox -->
            <button
              class="flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors cursor-pointer"
              :class="task.taskStatus === 'done'
                ? 'border-primary bg-primary text-inverted'
                : 'border-muted hover:border-primary'"
              aria-label="Toggle done"
              @click.stop="toggleTask(task.id)"
            >
              <UIcon
                v-if="task.taskStatus === 'done'"
                name="i-lucide-check"
                class="size-3"
              />
            </button>

            <!-- Title + tags -->
            <div class="min-w-0 flex-1">
              <p
                class="truncate text-sm font-medium leading-snug"
                :class="task.taskStatus === 'done' ? 'text-muted line-through' : 'text-default'"
              >
                {{ task.title || 'Untitled' }}
              </p>
              <div
                v-if="task.tags.length > 0"
                class="mt-0.5 flex gap-1.5 overflow-hidden"
              >
                <button
                  v-for="tag in task.tags.slice(0, 4)"
                  :key="tag"
                  class="rounded px-0.5 text-xs transition-colors cursor-pointer"
                  :class="hasTagFilter(tag) ? 'text-primary font-medium' : 'text-primary/70 dark:text-primary-400/70 hover:text-primary'"
                  @click.stop="toggleTagFilter(tag)"
                >
                  #{{ tag }}
                </button>
              </div>
            </div>

            <!-- Meta -->
            <div class="flex shrink-0 items-center gap-2.5">
              <UBadge
                v-if="dueBadge(task.dueAt)"
                :color="dueBadge(task.dueAt)!.color"
                variant="subtle"
                size="sm"
                icon="i-lucide-calendar"
              >
                {{ dueBadge(task.dueAt)!.label }}
              </UBadge>
              <span class="hidden text-xs text-muted sm:inline">{{ relativeTime(task.updatedAt) }}</span>
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="neutral"
                variant="ghost"
                class="opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                aria-label="Delete task"
                @click.stop="deleteNote(task.id)"
              />
            </div>
          </div>
        </UScrollArea>

        <!-- Empty state -->
        <div
          v-else
          class="flex flex-col items-center justify-center gap-2 py-16 text-center flex-1"
        >
          <UIcon
            name="i-lucide-square-check-big"
            class="size-10 text-muted"
          />
          <p class="text-sm text-muted">
            {{ query ? 'No tasks match your filter' : statusFilter === 'done' ? 'No completed tasks yet' : 'All clear — nothing to do' }}
          </p>
        </div>
      </template>

      <!-- Loading -->
      <div
        v-else
        class="flex flex-1 items-center justify-center py-16"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-5 animate-spin text-muted"
        />
      </div>
    </div>

    <!-- Drawer -->
    <TaskDrawer
      @close="selectTask(null)"
      @navigate="openLinkedNote"
    />

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
        icon="i-lucide-square-check-big"
        color="primary"
        variant="soft"
        size="md"
        aria-label="New task"
        @click="submitUntitled"
      />
    </div>
  </div>
</template>
