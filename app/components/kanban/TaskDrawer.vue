<script setup lang="ts">
import { columnDotAttrs } from '~/utils/tagColors'
import { format } from 'date-fns'
import { relativeTime } from '~/composables/useRelativeTime'
import type { TaskComment } from '~/composables/useProjects'

interface Task {
  id: string
  columnId: string
  title: string
  description: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

const props = defineProps<{ task: Task | null }>()

const emit = defineEmits<{ close: [] }>()

const { session } = useAuth()
const toast = useToast()
const {
  activeProject,
  boardColumns,
  boardTagCounts,
  updateTask,
  moveTask,
  deleteTask,
  comments,
  loadComments,
  addComment,
  clearComments
} = useProjects()

function fullDate(ts: number) {
  return format(new Date(ts), 'PPp')
}

const open = computed({
  get: () => props.task !== null,
  set: (v: boolean) => { if (!v) emit('close') }
})

// The panel slides out over ~half a second. It renders the last task it was
// given rather than the prop, so closing it doesn't empty it mid-animation.
const shownTask = ref<Task | null>(props.task)

watch(() => props.task, (task) => {
  if (task) shownTask.value = task
})

const column = computed(() =>
  boardColumns.value.find(c => c.id === shownTask.value?.columnId) ?? null
)

// ─── Panel width: cookie-persisted, drag-resize, reset ──────

const DEFAULT_WIDTH = 620
const MIN_WIDTH = 400

const storedWidth = useCookie<number | null>('kanban-drawer-width', { default: () => null })

const width = ref(DEFAULT_WIDTH)
const maxWidth = ref(DEFAULT_WIDTH)

function measure() {
  maxWidth.value = Math.max(MIN_WIDTH, window.innerWidth - 24)
  width.value = Math.min(storedWidth.value ?? DEFAULT_WIDTH, maxWidth.value)
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
})

let resizing = false

function onResizeStart(e: PointerEvent) {
  resizing = true
  e.preventDefault()
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  if (!resizing) return
  width.value = Math.min(Math.max(window.innerWidth - e.clientX, MIN_WIDTH), maxWidth.value)
}

function onResizeEnd() {
  resizing = false
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  storedWidth.value = width.value === DEFAULT_WIDTH ? null : width.value
}

function resetWidth() {
  width.value = DEFAULT_WIDTH
  storedWidth.value = null
}

// Declared up here because the task-switch watcher below resets them.
const commentDraft = ref('')
// Clicking anywhere along the composer row puts the caret in the editor.
const composer = ref<{ focus: () => void } | null>(null)
const tagDraft = ref('')
const tagFocused = ref(false)
const tagHighlight = ref(-1)

// ─── Title (auto-save) ─────────────────────────────────────

const titleDraft = ref('')
let titleTimer: ReturnType<typeof setTimeout> | null = null
let titleDirty = false

// The id is passed in rather than read off props: by the time the task-switch
// watcher runs, props.task is already the task being opened, so flushing
// against it would write this task's draft onto the next one.
function flushTitle(taskId = props.task?.id) {
  if (titleTimer) {
    clearTimeout(titleTimer)
    titleTimer = null
  }
  if (!titleDirty) return
  titleDirty = false
  if (taskId) updateTask(taskId, { title: titleDraft.value })
}

watch(titleDraft, (v) => {
  if (!props.task || v === props.task.title) return
  titleDirty = true
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(() => flushTitle(), 600)
})

// ─── Description (auto-save, same editor as notes) ─────────

const editorContent = ref('')
let descTimer: ReturnType<typeof setTimeout> | null = null
let descDirty = false
let suppressSave = false

function flushDescription(taskId = props.task?.id) {
  if (descTimer) {
    clearTimeout(descTimer)
    descTimer = null
  }
  if (!descDirty) return
  descDirty = false
  if (taskId) updateTask(taskId, { description: editorContent.value })
}

watch(editorContent, () => {
  if (suppressSave) return
  descDirty = true
  if (descTimer) clearTimeout(descTimer)
  descTimer = setTimeout(() => flushDescription(), 600)
})

// Switching task saves whatever the previous one had pending — against that
// task's id — and then reloads every draft.
// Closing leaves every draft alone: the panel is still on screen animating out,
// and the next open overwrites them anyway.
watch(() => props.task?.id, (id, previousId) => {
  flushTitle(previousId)
  flushDescription(previousId)
  if (!id) return

  titleDraft.value = props.task?.title ?? ''
  suppressSave = true
  editorContent.value = props.task?.description ?? ''
  nextTick(() => {
    suppressSave = false
  })

  commentDraft.value = ''
  tagDraft.value = ''
  tagHighlight.value = -1
  clearComments()
  loadComments(id).then(scrollUpdatesToEnd)
}, { immediate: true })

// Changes made elsewhere — an agent over MCP, a teammate, the AI chat — land in
// the open panel, but never on top of what the user is in the middle of typing.
watch(() => props.task?.title, (title) => {
  if (title === undefined || titleDirty || titleTimer) return
  if (title !== titleDraft.value) titleDraft.value = title
})

watch(() => props.task?.description, (description) => {
  if (description === undefined || descDirty || descTimer) return
  if (description === editorContent.value) return
  suppressSave = true
  editorContent.value = description
  nextTick(() => {
    suppressSave = false
  })
})

onBeforeUnmount(() => {
  flushTitle()
  flushDescription()
})

// ─── Labels ────────────────────────────────────────────────

// A label is only worth anything when it is the same label the rest of the board
// carries, and typing one from memory is how a board ends up holding "bug",
// "bugs" and "Bug" in three different colours. Focusing the field offers what is
// already in use; typing narrows it.
const tagSuggestions = computed(() => {
  const partial = tagDraft.value.trim().toLowerCase()
  const own = props.task?.tags ?? []
  return boardTagCounts.value
    .map(([tag]) => tag)
    .filter(tag => !own.includes(tag) && (!partial || tag.includes(partial)))
    .slice(0, 6)
})

const showTagSuggestions = computed(() => tagFocused.value && tagSuggestions.value.length > 0)

// -1 is "nothing picked": an open list under an empty field is a menu to look
// at, not an answer waiting on Enter. Typing narrows it to a best match, and
// arrowing always picks.
watch(tagDraft, (draft) => {
  tagHighlight.value = draft.trim() ? 0 : -1
})

function addTagValue(value: string) {
  const tag = value.trim().toLowerCase()
  tagDraft.value = ''
  tagHighlight.value = -1
  if (!tag || !props.task || props.task.tags.includes(tag)) return
  updateTask(props.task.id, { tags: [...props.task.tags, tag] })
}

function addTag() {
  addTagValue(tagDraft.value)
}

function removeTag(tag: string) {
  if (!props.task) return
  updateTask(props.task.id, { tags: props.task.tags.filter(t => t !== tag) })
}

function onTagKeydown(e: KeyboardEvent) {
  const suggestions = showTagSuggestions.value ? tagSuggestions.value : []

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestions.length) return
    e.preventDefault()
    const step = e.key === 'ArrowDown' ? 1 : -1
    tagHighlight.value = (Math.max(tagHighlight.value, 0) + step + suggestions.length) % suggestions.length
  } else if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    // The picked suggestion is what the field is offering, so that is what Enter
    // takes; with nothing picked it is the label being typed.
    addTagValue(suggestions[tagHighlight.value] ?? tagDraft.value)
  } else if (e.key === 'Escape') {
    if (!suggestions.length) return
    e.preventDefault()
    e.stopPropagation()
    tagFocused.value = false
  } else if (e.key === 'Backspace' && !tagDraft.value && props.task?.tags.length) {
    removeTag(props.task.tags[props.task.tags.length - 1]!)
  }
}

function onTagBlur() {
  tagFocused.value = false
  addTag()
}

// ─── Updates (comments) ────────────────────────────────────

const updatesOpen = useCookie<boolean>('kanban-updates-open', { default: () => true })
const updatesEl = ref<HTMLElement | null>(null)

function initials(name: string | null | undefined) {
  if (!name) return '?'
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
}

const userInitials = computed(() => initials(session.value?.user?.name))

// An update posted by an agent is signed with the key it came in on, not with
// the account that owns the key — otherwise a night of agent work reads back as
// the user's own writing.
function isAgentUpdate(comment: TaskComment) {
  return comment.createdVia === 'mcp' || comment.createdVia === 'ai'
}

function updateAuthor(comment: TaskComment) {
  if (comment.createdVia === 'mcp') return comment.keyName ?? 'MCP key'
  if (comment.createdVia === 'ai') return 'AI assistant'
  return comment.userName ?? 'Unknown'
}

function updateSourceLabel(comment: TaskComment) {
  return comment.createdVia === 'mcp' ? 'MCP' : 'AI'
}

async function scrollUpdatesToEnd() {
  await nextTick()
  const el = updatesEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function sendComment() {
  const body = commentDraft.value.trim()
  if (!body || !props.task) return
  commentDraft.value = ''
  await addComment(props.task.id, body)
  scrollUpdatesToEnd()
}

watch(updatesOpen, (isOpen) => {
  if (isOpen) scrollUpdatesToEnd()
})

// ─── Move / delete ─────────────────────────────────────────

async function moveToColumn(columnId: string) {
  if (!props.task || props.task.columnId === columnId) return
  await moveTask(props.task.id, columnId, null, null)
}

const stateItems = computed(() =>
  [boardColumns.value.map(c => ({
    label: c.name,
    // Rendered by the #item slot below: the same dot as the board column, so
    // state reads the same in both places.
    dot: columnDotAttrs(c),
    active: c.id === props.task?.columnId,
    onSelect: () => moveToColumn(c.id)
  }))]
)

const deleteOpen = ref(false)

async function confirmDelete() {
  if (!props.task) return
  deleteOpen.value = false
  const id = props.task.id
  // Drop pending autosaves: the row is about to be gone.
  descDirty = false
  titleDirty = false
  const title = props.task.title
  emit('close')
  await deleteTask(id)
  toast.add({
    title: `"${title}" moved to trash`,
    description: 'Restore it from Show trashed for the next 7 days.',
    icon: 'i-lucide-trash-2',
    duration: 5000
  })
}

const menuItems = computed(() => [[
  { label: 'Reset panel width', icon: 'i-lucide-rotate-ccw', onSelect: resetWidth }
], [
  {
    label: 'Delete task',
    icon: 'i-lucide-trash-2',
    color: 'error' as const,
    onSelect: () => { deleteOpen.value = true }
  }
]])
</script>

<template>
  <!-- `handle-only` with no handle rendered means nothing on the panel is a
       drag surface: swipe-to-dismiss fired on mouse drags inside the
       description and comment fields. Close is the X, a click outside, or
       Escape. The left edge still resizes. -->
  <UDrawer
    v-model:open="open"
    direction="right"
    :handle="false"
    handle-only
    :ui="{ content: 'inset-y-0 right-0 rounded-none' }"
  >
    <template #content>
      <div
        v-if="shownTask"
        class="relative flex h-full flex-col bg-default focus:outline-none"
        :style="{ width: `${width}px`, maxWidth: '100%' }"
      >
        <!-- Resize edge -->
        <div
          class="group absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize"
          @pointerdown="onResizeStart"
        >
          <div class="absolute inset-y-0 left-0 w-px bg-default transition-colors group-hover:bg-primary" />
        </div>

        <!-- Header: state, breadcrumb, actions -->
        <header class="flex shrink-0 items-center gap-2 border-b border-default px-4 py-2.5">
          <!-- The button borrows the menu's own padding and gap (6px each) so
               that with the menu flush against it, its dot and label sit on the
               same two vertical lines as every dot and label in the list.
               `items-center` because the theme starts menu items at the top,
               which leaves the dots riding above their labels. -->
          <UDropdownMenu
            :items="stateItems"
            :content="{ align: 'start', collisionPadding: 12 }"
            :ui="{ item: 'items-center' }"
          >
            <UButton
              color="neutral"
              variant="soft"
              size="xs"
              trailing-icon="i-lucide-chevron-down"
              :ui="{ base: 'px-1.5 gap-1.5' }"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="columnDotAttrs(column ?? { name: '' }).class"
                :style="columnDotAttrs(column ?? { name: '' }).style"
              />
              {{ column?.name ?? 'No column' }}
            </UButton>

            <template #item="{ item }">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="item.dot.class"
                :style="item.dot.style"
              />
              <span class="flex-1 truncate text-left">{{ item.label }}</span>
              <UIcon
                v-if="item.active"
                name="i-lucide-check"
                class="size-3.5 text-primary"
              />
            </template>
          </UDropdownMenu>

          <!-- Board and last-edited time, kept to one quiet line; the exact
               timestamps live in the tooltip. -->
          <span
            class="min-w-0 flex-1 truncate text-xs text-dimmed"
            :title="`Created ${fullDate(shownTask.createdAt)}\nUpdated ${fullDate(shownTask.updatedAt)}`"
          >
            <template v-if="activeProject">{{ activeProject.name }} · </template>edited {{ relativeTime(shownTask.updatedAt) }}
          </span>

          <UDropdownMenu
            :items="menuItems"
            :content="{ align: 'end', collisionPadding: 12 }"
          >
            <UButton
              icon="i-lucide-ellipsis"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Task options"
            />
          </UDropdownMenu>
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Close"
            @click="emit('close')"
          />
        </header>

        <!-- Title + labels + description -->
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="shrink-0 px-5 pb-3 pt-4">
            <UTextarea
              v-model="titleDraft"
              :rows="1"
              autoresize
              variant="none"
              placeholder="Task title"
              class="w-full"
              :ui="{ base: 'px-0 py-0 text-lg font-semibold leading-snug resize-none' }"
              @keydown.enter.prevent="($event.target as HTMLTextAreaElement).blur()"
            />

            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <KanbanLabelChip
                v-for="tag in shownTask.tags"
                :key="tag"
                :tag="tag"
                editable
                removable
                chip-class="text-xs"
                @remove="removeTag"
              />
              <div class="relative min-w-24 flex-1">
                <input
                  v-model="tagDraft"
                  :placeholder="shownTask.tags.length ? 'Add label…' : 'Add a label…'"
                  class="w-full bg-transparent py-0.5 text-xs text-default outline-none placeholder:text-dimmed"
                  @keydown="onTagKeydown"
                  @focus="tagFocused = true"
                  @input="tagFocused = true"
                  @blur="onTagBlur"
                >

                <!-- The board's own labels. `mousedown.prevent` keeps the field
                     focused so picking one is not read as blurring away from it. -->
                <div
                  v-if="showTagSuggestions"
                  class="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-default bg-default p-1 shadow-lg"
                >
                  <button
                    v-for="(tag, index) in tagSuggestions"
                    :key="tag"
                    class="flex w-full items-center rounded-md px-1 py-1 text-left transition-colors"
                    :class="index === tagHighlight ? 'bg-elevated' : 'hover:bg-elevated/60'"
                    @mousedown.prevent="addTagValue(tag)"
                  >
                    <KanbanLabelChip
                      :tag="tag"
                      chip-class="min-w-0 text-xs"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Description: the notes editor, bounded so it keeps its own scroll -->
          <div class="flex min-h-0 flex-1 flex-col border-t border-default">
            <RichEditor
              v-model="editorContent"
              placeholder="Add a description… (@ for dates, / for commands)"
              class="min-h-0 flex-1"
            />
          </div>
        </div>

        <!-- Updates: a short running log of what happened -->
        <section
          class="flex shrink-0 flex-col border-t border-default"
          :class="updatesOpen ? 'max-h-72' : ''"
        >
          <button
            class="flex shrink-0 items-center gap-2 px-5 py-2.5 text-left transition-colors hover:bg-elevated/50"
            @click="updatesOpen = !updatesOpen"
          >
            <UIcon
              name="i-lucide-message-square"
              class="size-3.5 text-muted"
            />
            <span class="text-xs font-semibold text-muted">Updates</span>
            <span
              v-if="comments.length"
              class="text-xs text-dimmed"
            >{{ comments.length }}</span>
            <UIcon
              :name="updatesOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
              class="ml-auto size-3.5 text-dimmed"
            />
          </button>

          <template v-if="updatesOpen">
            <div
              ref="updatesEl"
              class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-3"
            >
              <p
                v-if="comments.length === 0"
                class="py-6 text-center text-xs text-dimmed"
              >
                No updates yet. Note progress, blockers or decisions below.
              </p>

              <div
                v-for="comment in comments"
                :key="comment.id"
                class="flex gap-2.5"
              >
                <UAvatar
                  v-if="isAgentUpdate(comment)"
                  icon="i-lucide-bot"
                  size="2xs"
                  class="mt-0.5 shrink-0"
                />
                <UAvatar
                  v-else
                  :alt="initials(comment.userName)"
                  size="2xs"
                  class="mt-0.5 shrink-0"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-2">
                    <span class="truncate text-xs font-medium text-default">
                      {{ updateAuthor(comment) }}
                    </span>
                    <span
                      v-if="isAgentUpdate(comment)"
                      class="shrink-0 rounded px-1 py-px text-[0.625rem] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-accented"
                    >
                      {{ updateSourceLabel(comment) }}
                    </span>
                    <span class="shrink-0 text-xs text-dimmed">
                      {{ relativeTime(comment.createdAt) }}
                    </span>
                  </div>
                  <InlineMarkdown
                    :text="comment.body"
                    class="text-sm leading-relaxed text-default"
                  />
                </div>
              </div>
            </div>

            <div
              class="flex shrink-0 cursor-text items-start gap-2 border-t border-default px-4 py-2.5"
              @click="composer?.focus()"
            >
              <UAvatar
                :alt="userInitials"
                size="2xs"
                class="mt-0.5 shrink-0"
              />
              <UpdateComposer
                ref="composer"
                v-model="commentDraft"
                placeholder="Add an update…"
                @submit="sendComment"
              />
              <UButton
                icon="i-lucide-arrow-up"
                size="xs"
                color="primary"
                class="shrink-0"
                :disabled="!commentDraft.trim()"
                aria-label="Add update"
                @click="sendComment"
              />
            </div>
          </template>
        </section>
      </div>
    </template>
  </UDrawer>

  <UModal
    v-model:open="deleteOpen"
    title="Delete task?"
    description="It moves to the board's trash with its updates. Show trashed on the board can restore it for the next 7 days."
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
        label="Delete task"
        color="error"
        @click="confirmDelete"
      />
    </template>
  </UModal>
</template>
