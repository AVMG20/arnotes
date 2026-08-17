<script setup lang="ts">
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { format } from 'date-fns'
import type { TaskProp } from '~/composables/useNotes'
import { dueInfo, daysFromToday, endOfDay, toDateInputValue } from '~/composables/useTasks'
import { relativeTime } from '~/composables/useRelativeTime'

const emit = defineEmits<{ close: [], navigate: [id: string] }>()

const { selectedTask, selectedTaskId, toggleTask, updateTaskMeta, renameNote, deleteNote, restoreNote, selectTask, toggleTagFilter } = useTasks()
const { notes, getNote, createNote } = useNotes()
const toast = useToast()

const task = selectedTask

// ─── Viewport ────────────────────────────────────────────────
// The drawer is a bottom sheet on phones and a resizable side panel from `sm`
// up, so the breakpoint has to be reactive (and client-only, to keep SSR and
// hydration in agreement).

const viewportWidth = ref(0)
const isMobile = computed(() => viewportWidth.value > 0 && viewportWidth.value < 640)

function syncViewport() {
  viewportWidth.value = window.innerWidth
}

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})
onBeforeUnmount(() => window.removeEventListener('resize', syncViewport))

// ─── Closing ─────────────────────────────────────────────────

function close() {
  flushProps()
  flushTitle()
  emit('close')
}

// Reka renders menus, popovers and dialogs in body-level portals. While one is
// open Escape belongs to it, not to the drawer. The drawer itself is a dialog,
// so it is excluded from the check.
function hasOpenOverlay() {
  const overlays = document.querySelectorAll(
    '[data-reka-popper-content-wrapper], [role="dialog"], [role="menu"], [data-editor-overlay]'
  )
  return [...overlays].some(el => el !== asideRef.value && !asideRef.value?.contains(el))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || resizing.value || hasOpenOverlay()) return
  close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// ─── Resizable side panel (width persisted in a cookie) ──────

// Percent of viewport width; only used from the `sm` breakpoint up.
const savedWidth = useCookie<number>('tasks-drawer-width', {
  default: () => 46,
  maxAge: 60 * 60 * 24 * 365
})

const asideRef = ref<HTMLElement | null>(null)
const dragWidth = ref<number | null>(null) // px while dragging; null = idle
const resizing = ref(false)

// The panel is always flush with the right edge of the viewport, so a width
// measured from that edge (px while dragging, vw once stored) means the same
// thing in both layouts.
const drawerStyle = computed(() => {
  if (isMobile.value) {
    return sheetOffset.value > 0 ? { transform: `translateY(${sheetOffset.value}px)` } : undefined
  }
  if (dragWidth.value !== null) return { width: `${dragWidth.value}px` }
  return { width: `${savedWidth.value}vw` }
})

function onResizeStart() {
  resizing.value = true
  dragWidth.value = asideRef.value?.offsetWidth ?? null
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  if (!resizing.value) return
  const min = Math.max(320, window.innerWidth * 0.2)
  const max = Math.min(window.innerWidth * 0.85, window.innerWidth - 260)
  dragWidth.value = Math.max(min, Math.min(window.innerWidth - e.clientX, max))
}

function onResizeEnd() {
  if (!resizing.value) return
  if (dragWidth.value !== null) {
    savedWidth.value = Math.round((dragWidth.value / window.innerWidth) * 1000) / 10
  }
  resizing.value = false
  dragWidth.value = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
}

onBeforeUnmount(onResizeEnd)

// ─── Swipe the sheet down to dismiss (phones) ────────────────
// Bound to the grab handle only, so scrolling the body or the editor is never
// mistaken for a dismiss gesture.

const sheetOffset = ref(0)
const DISMISS_DISTANCE = 120
let sheetStartY: number | null = null

function onSheetDragStart(e: PointerEvent) {
  sheetStartY = e.clientY
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onSheetDragMove(e: PointerEvent) {
  if (sheetStartY === null) return
  sheetOffset.value = Math.max(0, e.clientY - sheetStartY)
}

function onSheetDragEnd() {
  if (sheetStartY === null) return
  const dismissed = sheetOffset.value > DISMISS_DISTANCE
  sheetStartY = null
  sheetOffset.value = 0
  if (dismissed) close()
}

// ─── Title ───────────────────────────────────────────────────
// Titles are derived from the note body, so renaming rewrites its heading.

const titleInput = ref('')
const titleEl = ref<HTMLInputElement | null>(null)
let titleTimer: ReturnType<typeof setTimeout> | null = null
let titleTaskId: string | null = null

watch(() => [task.value?.id, task.value?.title] as const, ([, title]) => {
  // Never fight the user for the caret while they are typing in the field.
  if (import.meta.client && document.activeElement === titleEl.value) return
  titleInput.value = title ?? ''
}, { immediate: true })

function onTitleInput() {
  titleTaskId = task.value?.id ?? null
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(flushTitle, 600)
}

function flushTitle() {
  if (titleTimer) {
    clearTimeout(titleTimer)
    titleTimer = null
  }
  const id = titleTaskId
  titleTaskId = null
  const title = titleInput.value.trim()
  if (!id || !title) return
  renameNote(id, title).catch(() => toast.add({ title: 'Could not rename task', color: 'error', duration: 3000 }))
}

// ─── Due date ────────────────────────────────────────────────

const dueDateInput = ref('')

watch(() => task.value?.dueAt ?? null, (dueAt) => {
  dueDateInput.value = toDateInputValue(dueAt)
}, { immediate: true })

const due = computed(() => dueInfo(task.value?.dueAt ?? null))

async function setDue(dueAt: number | null) {
  const id = task.value?.id
  if (!id) return
  dueDateInput.value = toDateInputValue(dueAt)
  await updateTaskMeta(id, { dueAt })
}

const dueShortcuts = computed(() => [
  { label: 'Today', value: daysFromToday(0) },
  { label: 'Tomorrow', value: daysFromToday(1) },
  { label: 'Next week', value: daysFromToday(7) }
])

// ─── Custom properties ───────────────────────────────────────
// Edits live in a local copy and are written back as one debounced patch, so
// typing a value is not one PUT per keystroke.

const propDrafts = ref<TaskProp[]>([])
let propTimer: ReturnType<typeof setTimeout> | null = null
let propTaskId: string | null = null

function syncProps() {
  propDrafts.value = (task.value?.taskProps ?? []).map(p => ({ ...p }))
}

watch(() => [task.value?.id, task.value?.taskProps] as const, () => {
  // Pending local edits win until they are flushed.
  if (propTaskId && propTaskId === task.value?.id) return
  syncProps()
}, { immediate: true, deep: true })

function scheduleProps() {
  propTaskId = task.value?.id ?? null
  if (propTimer) clearTimeout(propTimer)
  propTimer = setTimeout(flushProps, 500)
}

function flushProps() {
  if (propTimer) {
    clearTimeout(propTimer)
    propTimer = null
  }
  const id = propTaskId
  propTaskId = null
  if (!id) return
  const taskProps = propDrafts.value.map(p => ({ ...p }))
  updateTaskMeta(id, { taskProps }).catch(() =>
    toast.add({ title: 'Could not save properties', color: 'error', duration: 3000 })
  )
}

// Switching tasks must not carry unsaved property edits over to the new one.
watch(selectedTaskId, () => {
  flushProps()
  flushTitle()
  pickerPropId.value = null
  addPropOpen.value = false
})

onBeforeUnmount(() => {
  flushProps()
  flushTitle()
})

function editProp(id: string, key: 'name' | 'value', value: string) {
  const prop = propDrafts.value.find(p => p.id === id)
  if (!prop) return
  prop[key] = value
  scheduleProps()
}

async function addProp(type: TaskProp['type']) {
  addPropOpen.value = false
  if (!task.value) return
  propDrafts.value = [...propDrafts.value, {
    id: Math.random().toString(36).slice(2, 10),
    name: type === 'link' ? 'Link' : type === 'note' ? 'Note' : 'Text',
    type,
    value: ''
  }]
  scheduleProps()
  flushProps()
}

function removeProp(id: string) {
  propDrafts.value = propDrafts.value.filter(p => p.id !== id)
  scheduleProps()
  flushProps()
}

const addPropOpen = ref(false)

const propIcon: Record<TaskProp['type'], string> = {
  text: 'i-lucide-type',
  link: 'i-lucide-link',
  note: 'i-lucide-notebook-pen'
}

const propTypeOptions: { type: TaskProp['type'], label: string, icon: string }[] = [
  { type: 'text', label: 'Text', icon: propIcon.text },
  { type: 'link', label: 'Link', icon: propIcon.link },
  { type: 'note', label: 'Note', icon: propIcon.note }
]

function externalLink(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

// ─── Note picker (for note-type props) ───────────────────────

// One popover at a time — keyed by property id, otherwise every note property
// on the task opens its picker at once.
const pickerPropId = ref<string | null>(null)
const noteQuery = ref('')

const notePickerResults = computed(() => {
  const q = noteQuery.value.trim().toLowerCase()
  return notes.value
    .filter(n => !n.deletedAt && n.id !== task.value?.id && (!q || n.title.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
})

// Offer creation when a query is typed that doesn't match an existing title.
const canCreateNote = computed(() => {
  const q = noteQuery.value.trim().toLowerCase()
  return !!q && !notes.value.some(n => !n.deletedAt && n.title.toLowerCase() === q)
})

function openNotePicker(prop: TaskProp) {
  noteQuery.value = ''
  pickerPropId.value = pickerPropId.value === prop.id ? null : prop.id
}

function linkNote(propId: string, noteId: string) {
  pickerPropId.value = null
  editProp(propId, 'value', noteId)
  flushProps()
}

async function createAndLinkNote(propId: string) {
  const title = noteQuery.value.trim()
  if (!title) return
  // `select: false` keeps the notes view on whatever the user had open.
  const note = await createNote({ title, select: false })
  linkNote(propId, note.id)
  toast.add({ title: `Linked new note "${note.title}"`, icon: 'i-lucide-link', duration: 2500 })
}

// Open a linked note — a linked task swaps the drawer to that task instead.
function openLinkedNote(id: string) {
  const note = getNote(id)
  if (!note) return
  if (note.isTask) selectTask(id)
  else emit('navigate', id)
}

// ─── Details section (collapsible, mostly for phones) ────────

const detailsOpen = useCookie<boolean>('tasks-drawer-details', {
  default: () => true,
  maxAge: 60 * 60 * 24 * 365
})

const detailsSummary = computed(() => {
  const parts: string[] = []
  if (due.value) parts.push(due.value.label)
  const props = propDrafts.value.length
  if (props > 0) parts.push(`${props} propert${props === 1 ? 'y' : 'ies'}`)
  return parts.join(' · ') || 'No due date'
})

// ─── Actions ─────────────────────────────────────────────────

const taskMenuItems = computed(() => [[
  { label: 'Convert to note', icon: 'i-lucide-notebook-pen', onSelect: convertToNote },
  { label: 'Move to trash', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: removeTask }
]])

async function convertToNote() {
  const id = task.value?.id
  if (!id) return
  flushProps()
  flushTitle()
  await updateTaskMeta(id, { isTask: false })
  navigateTo('/note/' + id)
}

async function removeTask() {
  const id = task.value?.id
  if (!id) return
  close()
  await deleteNote(id)
  toast.add({
    title: 'Task moved to trash',
    icon: 'i-lucide-trash-2',
    duration: 5000,
    actions: [{
      label: 'Undo',
      color: 'neutral',
      variant: 'outline',
      onClick: async () => {
        await restoreNote(id)
        selectTask(id)
      }
    }]
  })
}

// Focus the title of a brand new task so it can be named right away.
watch(() => task.value?.id, async (id) => {
  if (!id || getNote(id)?.title !== 'Untitled') return
  await nextTick()
  titleEl.value?.focus()
  titleEl.value?.select()
})
</script>

<template>
  <!-- Phones get a dismissible bottom sheet in a portal; from `sm` up the panel
       renders in place, next to the list, so the two never overlap. -->
  <Teleport
    to="body"
    :disabled="!isMobile"
  >
    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="task && isMobile"
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
        @click="close"
      />
    </Transition>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      leave-active-class="transition duration-150 ease-in"
      :enter-from-class="isMobile ? 'translate-y-full' : 'translate-x-full opacity-0'"
      :leave-to-class="isMobile ? 'translate-y-full' : 'translate-x-full opacity-0'"
    >
      <aside
        v-if="task"
        ref="asideRef"
        role="dialog"
        :aria-modal="isMobile"
        aria-label="Task details"
        class="flex flex-col bg-default"
        :class="isMobile
          ? ['fixed inset-x-0 bottom-0 z-50 h-[92dvh] w-full rounded-t-2xl shadow-2xl', sheetOffset > 0 ? '' : 'transition-transform']
          : 'relative h-full min-h-0 min-w-0 shrink-0 border-l border-default'"
        :style="drawerStyle"
      >
        <!-- Resize handle (side-panel layout only) -->
        <div
          class="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none transition-colors hover:bg-primary-500/40 sm:block"
          :class="resizing ? 'bg-primary-500/60' : 'bg-transparent'"
          @pointerdown.prevent="onResizeStart"
        />

        <!-- Grab handle: swipe down to dismiss (phones only) -->
        <div
          class="flex shrink-0 cursor-grab touch-none justify-center py-2 active:cursor-grabbing sm:hidden"
          aria-hidden="true"
          @pointerdown="onSheetDragStart"
          @pointermove="onSheetDragMove"
          @pointerup="onSheetDragEnd"
          @pointercancel="onSheetDragEnd"
        >
          <div class="h-1 w-10 rounded-full bg-accented" />
        </div>

        <!-- Header -->
        <div class="shrink-0 border-b border-default px-4 pb-3 sm:px-5 sm:pt-4">
          <div class="flex items-start gap-3">
            <button
              class="mt-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors"
              :class="task.taskStatus === 'done'
                ? 'border-primary bg-primary text-inverted'
                : 'border-muted hover:border-primary'"
              :aria-label="task.taskStatus === 'done' ? 'Mark as open' : 'Mark as done'"
              @click="toggleTask(task.id)"
            >
              <UIcon
                v-if="task.taskStatus === 'done'"
                name="i-lucide-check"
                class="size-3.5"
              />
            </button>

            <input
              ref="titleEl"
              v-model="titleInput"
              placeholder="Untitled task"
              aria-label="Task title"
              class="min-w-0 flex-1 border-0 bg-transparent p-0 text-lg font-semibold leading-snug text-default outline-none placeholder:text-muted"
              :class="task.taskStatus === 'done' ? 'text-muted line-through' : ''"
              @input="onTitleInput"
              @blur="flushTitle"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            >

            <div class="flex shrink-0 items-center gap-0.5">
              <UDropdownMenu :items="taskMenuItems">
                <UButton
                  icon="i-lucide-ellipsis"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  aria-label="More actions"
                />
              </UDropdownMenu>
              <UButton
                icon="i-lucide-x"
                size="sm"
                color="neutral"
                variant="ghost"
                aria-label="Close task"
                @click="close"
              />
            </div>
          </div>

          <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-9 text-xs text-muted">
            <span>Created {{ format(task.createdAt, 'MMM d, yyyy') }}</span>
            <span class="opacity-40">•</span>
            <span>Updated {{ relativeTime(task.updatedAt) }}</span>
            <UBadge
              v-if="due"
              :color="due.color"
              variant="subtle"
              size="sm"
              icon="i-lucide-calendar"
            >
              {{ due.label }}
            </UBadge>
          </div>
        </div>

        <!-- Details: due date, custom properties, tags -->
        <div class="shrink-0 border-b border-default">
          <button
            class="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-xs font-medium text-muted transition-colors hover:text-default sm:px-5"
            :aria-expanded="detailsOpen"
            @click="detailsOpen = !detailsOpen"
          >
            <UIcon
              name="i-lucide-chevron-right"
              class="size-3.5 transition-transform"
              :class="detailsOpen ? 'rotate-90' : ''"
            />
            <span>Details</span>
            <span
              v-if="!detailsOpen"
              class="truncate opacity-70"
            >{{ detailsSummary }}</span>
          </button>

          <div
            v-if="detailsOpen"
            class="max-h-[45vh] space-y-1 overflow-y-auto px-4 pb-3 sm:max-h-none sm:px-5"
          >
            <!-- Due date -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-elevated/50">
              <UIcon
                :name="due?.tone === 'overdue' ? 'i-lucide-calendar-clock' : 'i-lucide-calendar'"
                class="size-4 shrink-0"
                :class="due?.tone === 'overdue' ? 'text-error' : 'text-muted'"
              />
              <span class="w-16 shrink-0 text-sm text-muted">Due</span>
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <input
                  v-model="dueDateInput"
                  type="date"
                  aria-label="Due date"
                  class="min-w-0 flex-1 rounded-md border border-default bg-transparent px-2 py-1 text-sm text-default outline-none focus:border-primary"
                  @change="setDue(endOfDay(dueDateInput))"
                >
                <UButton
                  v-if="task.dueAt"
                  icon="i-lucide-x"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Clear due date"
                  @click="setDue(null)"
                />
              </div>
              <div class="flex w-full flex-wrap gap-1 pl-7 sm:w-auto sm:pl-0">
                <button
                  v-for="shortcut in dueShortcuts"
                  :key="shortcut.label"
                  class="cursor-pointer rounded-full bg-elevated px-2 py-0.5 text-xs text-muted transition-colors hover:text-primary"
                  @click="setDue(shortcut.value)"
                >
                  {{ shortcut.label }}
                </button>
              </div>
            </div>

            <!-- Custom props -->
            <div
              v-for="prop in propDrafts"
              :key="prop.id"
              class="group flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-elevated/50"
            >
              <UIcon
                :name="propIcon[prop.type]"
                class="size-4 shrink-0 text-muted"
              />
              <input
                :value="prop.name"
                placeholder="Name"
                aria-label="Property name"
                class="w-16 shrink-0 border-0 bg-transparent p-0 text-sm text-muted outline-none focus:text-default"
                @input="editProp(prop.id, 'name', ($event.target as HTMLInputElement).value)"
                @blur="flushProps"
              >

              <!-- Text / link value -->
              <div
                v-if="prop.type !== 'note'"
                class="flex min-w-0 flex-1 items-center gap-1.5"
              >
                <input
                  :value="prop.value"
                  :placeholder="prop.type === 'link' ? 'https://…' : 'Value'"
                  :aria-label="prop.name || 'Property value'"
                  class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-default outline-none placeholder:text-muted"
                  @input="editProp(prop.id, 'value', ($event.target as HTMLInputElement).value)"
                  @blur="flushProps"
                >
                <UButton
                  v-if="prop.type === 'link' && prop.value"
                  icon="i-lucide-external-link"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Open link"
                  :to="externalLink(prop.value)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="shrink-0"
                />
              </div>

              <!-- Note value -->
              <div
                v-else
                class="flex min-w-0 flex-1 items-center gap-1"
              >
                <button
                  class="flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md text-sm transition-colors"
                  :class="prop.value && getNote(prop.value)
                    ? 'text-primary hover:underline'
                    : 'text-muted hover:text-default'"
                  @click="prop.value && getNote(prop.value) ? openLinkedNote(prop.value) : openNotePicker(prop)"
                >
                  <span class="truncate">
                    {{ prop.value ? getNote(prop.value)?.title ?? 'Deleted note' : 'No note linked…' }}
                  </span>
                </button>

                <UPopover
                  :open="pickerPropId === prop.id"
                  :content="{ align: 'start', sideOffset: 6 }"
                  @update:open="open => pickerPropId = open ? prop.id : null"
                >
                  <UButton
                    icon="i-lucide-arrow-left-right"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :aria-label="prop.value ? 'Change linked note' : 'Link a note'"
                    class="shrink-0"
                    @click="openNotePicker(prop)"
                  />

                  <template #content>
                    <div class="w-72 max-w-[calc(100vw-2rem)] p-2">
                      <UInput
                        v-model="noteQuery"
                        icon="i-lucide-search"
                        placeholder="Search notes…"
                        size="sm"
                        autofocus
                        class="w-full"
                      />
                      <div class="mt-1 max-h-56 overflow-y-auto">
                        <button
                          v-for="n in notePickerResults"
                          :key="n.id"
                          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-default transition-colors hover:bg-elevated"
                          @click="linkNote(prop.id, n.id)"
                        >
                          <UIcon
                            :name="n.isTask ? 'i-lucide-square-check-big' : 'i-lucide-notebook-pen'"
                            class="size-3.5 shrink-0 text-muted"
                          />
                          <span class="min-w-0 flex-1 truncate">{{ n.title || 'Untitled' }}</span>
                        </button>
                        <p
                          v-if="notePickerResults.length === 0 && !canCreateNote"
                          class="px-2 py-3 text-center text-xs text-muted"
                        >
                          No notes found
                        </p>
                        <button
                          v-if="canCreateNote"
                          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevated"
                          @click="createAndLinkNote(prop.id)"
                        >
                          <UIcon
                            name="i-lucide-plus"
                            class="size-3.5 shrink-0 text-primary"
                          />
                          <span class="min-w-0 flex-1 truncate text-muted">
                            Create note <span class="font-medium text-default">"{{ noteQuery.trim() }}"</span>
                          </span>
                        </button>
                      </div>
                    </div>
                  </template>
                </UPopover>
              </div>

              <UButton
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Remove property"
                class="shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                @click="removeProp(prop.id)"
              />
            </div>

            <!-- Add property -->
            <UPopover
              v-model:open="addPropOpen"
              :content="{ align: 'start', sideOffset: 6 }"
            >
              <button class="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted transition-colors hover:text-primary">
                <UIcon
                  name="i-lucide-plus"
                  class="size-3.5"
                />
                Add property
              </button>

              <template #content>
                <div class="w-44 p-1.5">
                  <button
                    v-for="opt in propTypeOptions"
                    :key="opt.type"
                    class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-default transition-colors hover:bg-elevated"
                    @click="addProp(opt.type)"
                  >
                    <UIcon
                      :name="opt.icon"
                      class="size-4 shrink-0 text-muted"
                    />
                    {{ opt.label }}
                  </button>
                </div>
              </template>
            </UPopover>

            <!-- Tags (click filters the list behind the drawer) -->
            <div
              v-if="task.tags.length > 0"
              class="flex flex-wrap items-center gap-1.5 px-2 pt-1 -mx-2"
            >
              <button
                v-for="tag in task.tags"
                :key="tag"
                class="inline-flex cursor-pointer items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                :title="`Filter tasks by #${tag}`"
                @click="toggleTagFilter(tag)"
              >
                #{{ tag }}
              </button>
            </div>
          </div>
        </div>

        <!-- Description (editor bound to this task only) -->
        <div class="min-h-0 flex-1">
          <NotesEditor
            :note-id="task.id"
            class="h-full"
          />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
