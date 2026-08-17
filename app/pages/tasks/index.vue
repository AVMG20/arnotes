<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'
import { dueInfo } from '~/composables/useTasks'

definePageMeta({ layout: 'app' })

const route = useRoute()
const router = useRouter()
const { sidebarOpen } = useSidebar()
const searchOpen = useSearchModal()
const { ready, getNote } = useNotes()
const {
  openCount,
  doneCount,
  overdueCount,
  taskTags,
  filteredTasks,
  statusFilter,
  sort,
  query,
  selectedTaskId,
  selectTask,
  createTask,
  toggleTask,
  deleteNote,
  restoreNote,
  hasTagFilter,
  toggleTagFilter
} = useTasks()

const toast = useToast()

useSeoMeta({ title: 'Tasks' })

// ─── URL ↔ drawer sync ───────────────────────────────────────
// ?id= opens the drawer and the drawer writes it back, so browser back/forward
// (and the Android back button) close and reopen it. Both directions bail out
// when the two are already in agreement, which is what keeps them from looping.

watch(() => route.query.id, (id) => {
  const next = typeof id === 'string' ? id : null
  if (next !== selectedTaskId.value) selectTask(next)
}, { immediate: true })

watch(selectedTaskId, (id) => {
  if (route.path !== '/tasks') return
  const current = typeof route.query.id === 'string' ? route.query.id : null
  if (id === current) return
  router.push(id ? { path: '/tasks', query: { id } } : { path: '/tasks' })
})

// Leaving the tasks view (a linked note, a sidebar click) drops the selection —
// the drawer state is a singleton shared with the rest of the app.
watch(() => route.path, (path) => {
  if (!path.startsWith('/tasks')) selectTask(null)
})

function openLinkedNote(id: string) {
  router.push('/note/' + id)
}

// ─── Quick add ───────────────────────────────────────────────
// "Design the landing page #work" → title + tags, without leaving the keyboard.

const draft = ref('')
const draftEl = ref<HTMLInputElement | null>(null)
const creating = ref(false)

async function submitDraft() {
  const raw = draft.value.trim()
  if (!raw || creating.value) return
  const tags = [...raw.matchAll(/#([a-zA-Z][a-zA-Z0-9_]*)/g)].map(m => m[1]!.toLowerCase())
  const title = raw.replace(/#[a-zA-Z][a-zA-Z0-9_]*/g, '').replace(/\s+/g, ' ').trim() || 'Untitled'

  creating.value = true
  try {
    await createTask({ title, tags: [...new Set(tags)] })
    draft.value = ''
    // Keep the composer focused so several tasks can be typed in a row.
    draftEl.value?.focus()
  } catch {
    toast.add({ title: 'Could not create task', icon: 'i-lucide-alert-triangle', color: 'error', duration: 3000 })
  } finally {
    creating.value = false
  }
}

function focusDraft() {
  draftEl.value?.focus()
}

// ─── Filtering ───────────────────────────────────────────────

// Autocomplete for a trailing "#par…" token in the filter input.
const tagSuggestions = computed(() => {
  const partial = /#([\w]*)$/.exec(query.value)?.[1]
  if (partial === undefined) return []
  const lower = partial.toLowerCase()
  return taskTags.value.filter(tag => tag.startsWith(lower)).slice(0, 6)
})

function completeTag(tag: string) {
  query.value = query.value.replace(/#([\w]*)$/, `#${tag} `)
  searchInputRef.value?.focus()
}

const searchInputRef = ref<HTMLInputElement | null>(null)

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && query.value) {
    e.stopPropagation()
    query.value = ''
    return
  }
  if (tagSuggestions.value.length === 0) return
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault()
    completeTag(tagSuggestions.value[0]!)
  }
}

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

// One due-date computation per task per render pass instead of one per badge.
const dueByTask = computed(() =>
  new Map(filteredTasks.value.map(t => [t.id, dueInfo(t.dueAt)]))
)

const emptyStateText = computed(() => {
  if (query.value.trim()) return 'No tasks match your filter'
  if (statusFilter.value === 'done') return 'No completed tasks yet'
  return 'All clear — nothing to do'
})

// ─── Actions ─────────────────────────────────────────────────

async function removeTask(id: string) {
  const title = getNote(id)?.title ?? 'Task'
  await deleteNote(id)
  toast.add({
    title: `"${title}" moved to trash`,
    icon: 'i-lucide-trash-2',
    duration: 5000,
    actions: [{
      label: 'Undo',
      color: 'neutral',
      variant: 'outline',
      onClick: () => {
        restoreNote(id)
      }
    }]
  })
}

// ─── Keyboard shortcuts ──────────────────────────────────────

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable)
}

function moveSelection(delta: number) {
  const list = filteredTasks.value
  if (list.length === 0) return
  const current = list.findIndex(t => t.id === selectedTaskId.value)
  const next = current < 0
    ? (delta > 0 ? 0 : list.length - 1)
    : Math.min(list.length - 1, Math.max(0, current + delta))
  selectTask(list[next]!.id)
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault()
    focusDraft()
    return
  }
  if (isTyping(e.target)) return
  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault()
    moveSelection(1)
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault()
    moveSelection(-1)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex min-w-0 flex-1 overflow-hidden">
    <!-- List column -->
    <div class="flex min-w-0 flex-1 flex-col bg-default pb-14 lg:pb-0">
      <!-- Header -->
      <div class="shrink-0 border-b border-default px-4 py-4 sm:px-6">
        <div class="flex items-center gap-2">
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
          <UBadge
            v-if="overdueCount > 0"
            color="error"
            variant="subtle"
            size="sm"
            icon="i-lucide-calendar-clock"
          >
            {{ overdueCount }} overdue
          </UBadge>
        </div>

        <!-- Status tabs -->
        <div class="mt-3 flex items-center gap-1">
          <button
            v-for="tab in statusTabs"
            :key="tab.value"
            class="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors"
            :class="statusFilter === tab.value
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted hover:bg-elevated hover:text-default'"
            @click="statusFilter = tab.value"
          >
            {{ tab.label }}
            <span class="text-xs opacity-60">{{ tab.count }}</span>
          </button>
        </div>
      </div>

      <!-- Quick add -->
      <div class="shrink-0 px-4 pt-3">
        <form
          class="flex items-center gap-2.5 rounded-lg border border-default bg-elevated/40 px-3 py-2 transition-colors focus-within:border-primary/60"
          @submit.prevent="submitDraft"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-4 shrink-0 text-muted"
          />
          <input
            ref="draftEl"
            v-model="draft"
            placeholder="Add a task… (#tag to label it)"
            aria-label="New task"
            class="min-w-0 flex-1 bg-transparent text-sm text-default outline-none placeholder:text-muted"
          >
          <UButton
            type="submit"
            icon="i-lucide-corner-down-left"
            size="xs"
            color="primary"
            variant="soft"
            :loading="creating"
            :disabled="!draft.trim()"
            aria-label="Create task"
          />
        </form>
      </div>

      <!-- Filter + sort -->
      <div class="shrink-0 px-4 pt-2">
        <div class="flex items-center gap-2">
          <div class="relative min-w-0 flex-1">
            <div class="flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors">
              <UIcon
                name="i-lucide-search"
                class="size-4 shrink-0 text-muted"
              />
              <input
                ref="searchInputRef"
                v-model="query"
                placeholder="Filter tasks… (# for tags)"
                aria-label="Filter tasks"
                class="min-w-0 flex-1 bg-transparent text-sm text-default outline-none placeholder:text-muted"
                @keydown="onSearchKeydown"
              >
              <UButton
                v-if="query"
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Clear filter"
                @click="query = ''"
              />
            </div>

            <!-- #tag autocomplete -->
            <div
              v-if="tagSuggestions.length > 0"
              class="absolute left-0 right-0 top-full z-20 mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-default bg-default p-2 shadow-lg"
            >
              <button
                v-for="tag in tagSuggestions"
                :key="tag"
                class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
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
            aria-label="Sort tasks"
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
            paddingStart: 8,
            paddingEnd: 12,
            gap: 2
          }"
          class="mx-2 mb-2 mt-1 min-h-0 flex-1"
          :ui="{ viewport: 'px-1' }"
        >
          <div
            class="group relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 transition-colors"
            :class="selectedTaskId === task.id ? 'bg-elevated ring-1 ring-inset ring-default' : 'hover:bg-elevated/60'"
            @click="selectTask(task.id)"
          >
            <!-- Checkbox -->
            <button
              class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors"
              :class="task.taskStatus === 'done'
                ? 'border-primary bg-primary text-inverted'
                : 'border-muted hover:border-primary'"
              :aria-label="task.taskStatus === 'done' ? 'Mark as open' : 'Mark as done'"
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
                  class="cursor-pointer rounded px-0.5 text-xs transition-colors"
                  :class="hasTagFilter(tag) ? 'font-medium text-primary' : 'text-primary/70 hover:text-primary dark:text-primary-400/70'"
                  @click.stop="toggleTagFilter(tag)"
                >
                  #{{ tag }}
                </button>
              </div>
            </div>

            <!-- Meta -->
            <div class="flex shrink-0 items-center gap-2.5">
              <UBadge
                v-if="dueByTask.get(task.id)"
                :color="dueByTask.get(task.id)!.color"
                variant="subtle"
                size="sm"
                icon="i-lucide-calendar"
              >
                {{ dueByTask.get(task.id)!.label }}
              </UBadge>
              <span class="hidden text-xs text-muted sm:inline">{{ relativeTime(task.updatedAt) }}</span>
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="neutral"
                variant="ghost"
                class="opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                aria-label="Delete task"
                @click.stop="removeTask(task.id)"
              />
            </div>
          </div>
        </UScrollArea>

        <!-- Empty state -->
        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center"
        >
          <UIcon
            name="i-lucide-square-check-big"
            class="size-10 text-muted"
          />
          <p class="text-sm text-muted">
            {{ emptyStateText }}
          </p>
          <UButton
            v-if="!query.trim() && statusFilter !== 'done'"
            icon="i-lucide-plus"
            label="Add a task"
            color="primary"
            variant="soft"
            size="sm"
            @click="focusDraft"
          />
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
        icon="i-lucide-plus"
        color="primary"
        variant="soft"
        size="md"
        aria-label="New task"
        @click="focusDraft"
      />
    </div>
  </div>
</template>
