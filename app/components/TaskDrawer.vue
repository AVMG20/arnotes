<script setup lang="ts">
import { computed, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { format } from 'date-fns'
import type { TaskProp } from '~/composables/useNotes'
import { dueInfo } from '~/composables/useTasks'
import { relativeTime } from '~/composables/useRelativeTime'

const emit = defineEmits<{ close: [], navigate: [id: string] }>()

const { selectedTask, selectedTaskId, toggleTask, updateTaskMeta, deleteNote, selectTask } = useTasks()
const { notes, activeNoteId, createNote } = useNotes()
const toast = useToast()

function closeDrawer() {
  flushDrafts()
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !resizing.value) closeDrawer()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (selectedTaskId.value) activeNoteId.value = null
})

// ─── Click outside closes the drawer ─────────────────────────

const asideRef = ref<HTMLElement | null>(null)

function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null
  if (!target) return
  if (asideRef.value?.contains(target)) return
  // Ignore clicks inside teleported Nuxt UI overlays (note picker, menus,
  // tooltips) and editor overlays (table grid picker) — they belong to us.
  if (target.closest('[data-reka-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"], [data-editor-overlay]')) return
  closeDrawer()
}

onMounted(() => window.addEventListener('pointerdown', onPointerDown, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDown, true))

// ─── Resizable drawer (width persisted in a cookie) ──────────

// Percent of viewport width, kept between 25% and 80%.
const savedWidth = useCookie<number>('tasks-drawer-width', {
  default: () => 46,
  maxAge: 60 * 60 * 24 * 365
})

const drawerWidth = ref<number | null>(null) // px while dragging; null = idle
const resizing = ref(false)

const drawerStyle = computed(() => {
  if (drawerWidth.value !== null) return { width: `${drawerWidth.value}px` }
  if (import.meta.client && window.innerWidth < 640) return undefined
  return { width: `${savedWidth.value}%` }
})

function onResizeStart(_e: PointerEvent) {
  resizing.value = true
  drawerWidth.value = asideRef.value?.offsetWidth ?? null
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
}

function onResizeMove(e: PointerEvent) {
  if (!resizing.value) return
  const min = Math.max(320, window.innerWidth * 0.2)
  const max = Math.min(window.innerWidth * 0.85, window.innerWidth - 260)
  const next = Math.max(min, Math.min(window.innerWidth - e.clientX, max))
  drawerWidth.value = next
}

function onResizeEnd() {
  if (resizing.value && asideRef.value) {
    savedWidth.value = Math.round((asideRef.value.offsetWidth / window.innerWidth) * 1000) / 10
  }
  resizing.value = false
  drawerWidth.value = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
}

onBeforeUnmount(onResizeEnd)

const noteById = computed(() => new Map(notes.value.map(n => [n.id, n])))

const propIcon: Record<TaskProp['type'], string> = {
  text: 'i-lucide-type',
  link: 'i-lucide-link',
  note: 'i-lucide-notebook-pen'
}

// ─── Due date ────────────────────────────────────────────────

const dueDateInput = ref('')

function toInputDate(ts: number): string {
  const d = new Date(ts)
  const offset = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

watch(selectedTask, (t) => {
  dueDateInput.value = t?.dueAt ? toInputDate(t.dueAt) : ''
})

async function saveDue() {
  if (!selectedTask.value) return
  const dueAt = dueDateInput.value
    ? new Date(`${dueDateInput.value}T23:59:59.999`).getTime()
    : null
  await updateTaskMeta(selectedTask.value.id, { dueAt })
}

async function clearDue() {
  if (!selectedTask.value) return
  dueDateInput.value = ''
  await updateTaskMeta(selectedTask.value.id, { dueAt: null })
}

const due = computed(() => dueInfo(selectedTask.value?.dueAt ?? null))

// ─── Custom properties ───────────────────────────────────────

// Unsaved input lives here; persisted on change/blur so we don't PUT per keystroke.
// Each draft records its owning task so pending edits survive task switches.
const drafts = reactive(new Map<string, { taskId: string, name?: string, value?: string }>())
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>()

function setDraft(prop: TaskProp, key: 'name' | 'value', val: string) {
  const task = selectedTask.value
  if (!task) return
  drafts.set(prop.id, { ...drafts.get(prop.id), taskId: task.id, [key]: val })
  // Debounced autosave — edits persist even if the drawer closes before blur/change fire.
  clearTimeout(draftTimers.get(prop.id))
  draftTimers.set(prop.id, setTimeout(() => saveProp(prop), 500))
}

// Persist pending drafts immediately (before closing or switching tasks).
function flushDrafts() {
  for (const timer of draftTimers.values()) clearTimeout(timer)
  draftTimers.clear()
  // Group drafts by task so a switch still writes to the right note.
  const byTask = new Map<string, Map<string, { name?: string, value?: string }>>()
  for (const [propId, d] of drafts) {
    if (!byTask.has(d.taskId)) byTask.set(d.taskId, new Map())
    byTask.get(d.taskId)!.set(propId, { name: d.name, value: d.value })
  }
  drafts.clear()
  for (const [taskId, props] of byTask) {
    const task = notes.value.find(n => n.id === taskId)
    if (!task) continue
    const next = task.taskProps.map((p) => {
      const d = props.get(p.id)
      if (!d) return p
      return {
        ...p,
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.value !== undefined ? { value: d.value } : {})
      }
    })
    updateTaskMeta(taskId, { taskProps: next })
  }
}

async function saveProp(prop: TaskProp) {
  const task = selectedTask.value
  const draft = drafts.get(prop.id)
  if (!task || !draft || draft.taskId !== task.id) return
  const next = task.taskProps.map(p => p.id === prop.id
    ? {
        ...p,
        ...(draft.name !== undefined ? { name: draft.name } : {}),
        ...(draft.value !== undefined ? { value: draft.value } : {})
      }
    : p)
  drafts.delete(prop.id)
  const timer = draftTimers.get(prop.id)
  if (timer) {
    clearTimeout(timer)
    draftTimers.delete(prop.id)
  }
  await updateTaskMeta(task.id, { taskProps: next })
}

onBeforeUnmount(flushDrafts)

// Bind the shared editor to the selected task while the drawer is open, and
// flush pending prop drafts whenever the selection moves to another task.
watch(selectedTaskId, (id) => {
  flushDrafts()
  activeNoteId.value = id
}, { immediate: true })

async function removeProp(prop: TaskProp) {
  const task = selectedTask.value
  if (!task) return
  const timer = draftTimers.get(prop.id)
  if (timer) {
    clearTimeout(timer)
    draftTimers.delete(prop.id)
  }
  drafts.delete(prop.id)
  await updateTaskMeta(task.id, { taskProps: task.taskProps.filter(p => p.id !== prop.id) })
}

const propTypeOptions: { type: TaskProp['type'], label: string, icon: string }[] = [
  { type: 'text', label: 'Text', icon: 'i-lucide-type' },
  { type: 'link', label: 'Link', icon: 'i-lucide-link' },
  { type: 'note', label: 'Note', icon: 'i-lucide-notebook-pen' }
]

const taskMenuItems = computed(() => [[
  { label: 'Open as note', icon: 'i-lucide-notebook-pen', onSelect: openAsNote },
  { label: 'Move to trash', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: removeTask }
]])

async function addProp(type: TaskProp['type']) {
  addPropOpen.value = false
  const task = selectedTask.value
  if (!task) return
  const prop: TaskProp = {
    id: Math.random().toString(36).slice(2, 10),
    name: type === 'link' ? 'Link' : type === 'note' ? 'Note' : 'Text',
    type,
    value: ''
  }
  await updateTaskMeta(task.id, { taskProps: [...task.taskProps, prop] })
}

const addPropOpen = ref(false)

// ─── Note picker (for note-type props) ───────────────────────

const notePickerProp = ref<TaskProp | null>(null)
const notePickerOpen = ref(false)
const noteQuery = ref('')

const notePickerResults = computed(() => {
  const q = noteQuery.value.trim().toLowerCase()
  return notes.value
    .filter(n => !n.deletedAt && (!q || n.title.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8)
})

function openNotePicker(prop: TaskProp) {
  notePickerProp.value = prop
  noteQuery.value = ''
  notePickerOpen.value = true
}

// Open a linked note — a linked task opens in the tasks drawer instead.
function openLinkedNote(id: string) {
  const note = noteById.value.get(id)
  if (!note) return
  if (note.isTask) {
    selectTask(id)
    return
  }
  emit('navigate', id)
}

async function linkNote(id: string) {
  const prop = notePickerProp.value
  const task = selectedTask.value
  notePickerProp.value = null
  if (!prop || !task) return
  await updateTaskMeta(task.id, {
    taskProps: task.taskProps.map(p => p.id === prop.id ? { ...p, value: id } : p)
  })
}

// Offer creation when a query is typed that doesn't match an existing title.
const canCreateNote = computed(() => {
  const q = noteQuery.value.trim().toLowerCase()
  if (!q) return false
  return !notes.value.some(n => !n.deletedAt && n.title.toLowerCase() === q)
})

async function createAndLinkNote() {
  const prop = notePickerProp.value
  const title = noteQuery.value.trim()
  if (!prop || !title) return
  const note = await createNote({ title })
  await linkNote(note.id)
  // Navigate away first — the tasks-page watcher then never pushes a bare /tasks
  // entry, so browser back returns to the task with the drawer open.
  notePickerProp.value = null
  navigateTo('/note/' + note.id)
}

// ─── Actions ─────────────────────────────────────────────────

async function openAsNote() {
  const task = selectedTask.value
  if (!task) return
  await updateTaskMeta(task.id, { isTask: false })
  navigateTo('/note/' + task.id)
}

async function removeTask() {
  const task = selectedTask.value
  if (!task) return
  closeDrawer()
  await deleteNote(task.id)
  toast.add({ title: 'Task moved to trash', icon: 'i-lucide-trash-2', duration: 2500 })
}
</script>

<template>
  <Teleport to="body">
    <!-- Mobile backdrop -->
    <div
      class="fixed inset-0 z-30 bg-default/60 backdrop-blur-[2px] sm:hidden"
      @click="closeDrawer"
    />

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-full opacity-70"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="translate-x-full opacity-70"
    >
      <aside
        v-if="selectedTask"
        ref="asideRef"
        class="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-default bg-default shadow-2xl sm:min-w-0"
        :style="drawerStyle"
      >
        <!-- Resize handle -->
        <div
          class="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize touch-none transition-colors hover:bg-primary-500/40 sm:block"
          :class="resizing ? 'bg-primary-500/60' : 'bg-transparent'"
          @pointerdown.prevent="onResizeStart"
        />
        <!-- Header -->
        <div class="flex items-start gap-3 px-5 pt-5 shrink-0">
          <button
            class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors cursor-pointer"
            :class="selectedTask.taskStatus === 'done'
              ? 'border-primary bg-primary text-inverted'
              : 'border-muted hover:border-primary'"
            aria-label="Toggle done"
            @click="toggleTask(selectedTask.id)"
          >
            <UIcon
              v-if="selectedTask.taskStatus === 'done'"
              name="i-lucide-check"
              class="size-3.5"
            />
          </button>

          <div class="min-w-0 flex-1">
            <h2
              class="truncate text-lg font-semibold leading-snug text-default"
              :class="selectedTask.taskStatus === 'done' ? 'line-through text-muted' : ''"
            >
              {{ selectedTask.title || 'Untitled' }}
            </h2>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>Created {{ format(selectedTask.createdAt, 'MMM d, yyyy') }}</span>
              <span class="opacity-40">•</span>
              <span>Updated {{ relativeTime(selectedTask.updatedAt) }}</span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-0.5">
            <UDropdownMenu :items="taskMenuItems">
              <UButton
                icon="i-lucide-ellipsis"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="More actions"
              />
            </UDropdownMenu>
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Close task"
              @click="closeDrawer"
            />
          </div>
        </div>

        <!-- Properties -->
        <div class="mt-4 shrink-0 space-y-1 px-5">
          <!-- Due date -->
          <div class="flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-elevated/50 transition-colors">
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
                class="min-w-0 flex-1 rounded-md border border-default bg-transparent px-2 py-1 text-sm text-default outline-none focus:border-primary"
                @change="saveDue"
              >
              <UBadge
                v-if="due"
                :color="due.tone === 'overdue' ? 'error' : due.tone === 'today' ? 'warning' : due.tone === 'soon' ? 'primary' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ due.label }}
              </UBadge>
              <UButton
                v-if="selectedTask.dueAt"
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Clear due date"
                @click="clearDue"
              />
            </div>
          </div>

          <!-- Custom props -->
          <div
            v-for="prop in selectedTask.taskProps"
            :key="prop.id"
            class="group flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-elevated/50 transition-colors"
          >
            <UIcon
              :name="propIcon[prop.type]"
              class="size-4 shrink-0 text-muted"
            />
            <input
              :value="drafts.get(prop.id)?.name ?? prop.name"
              placeholder="Name"
              class="w-16 shrink-0 border-0 bg-transparent p-0 text-sm text-muted outline-none focus:text-default"
              @input="setDraft(prop, 'name', ($event.target as HTMLInputElement).value)"
              @change="saveProp(prop)"
              @blur="saveProp(prop)"
            >

            <!-- Text / link value -->
            <template v-if="prop.type === 'text' || prop.type === 'link'">
              <div class="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  :value="drafts.get(prop.id)?.value ?? prop.value"
                  :placeholder="prop.type === 'link' ? 'https://…' : 'Value'"
                  class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-default outline-none placeholder:text-muted"
                  @input="setDraft(prop, 'value', ($event.target as HTMLInputElement).value)"
                  @change="saveProp(prop)"
                  @blur="saveProp(prop)"
                >
                <UButton
                  v-if="prop.type === 'link' && prop.value"
                  icon="i-lucide-external-link"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Open link"
                  :to="prop.value.startsWith('http') ? prop.value : `https://${prop.value}`"
                  target="_blank"
                  class="shrink-0"
                />
              </div>
            </template>

            <!-- Note value -->
            <template v-else>
              <div class="flex min-w-0 flex-1 items-center gap-1">
                <!-- Click opens the linked note; swap button re-opens the picker -->
                <button
                  class="flex min-w-0 max-w-full items-center gap-1.5 rounded-md text-sm transition-colors cursor-pointer"
                  :class="prop.value && noteById.has(prop.value)
                    ? 'text-primary hover:underline'
                    : 'text-muted hover:text-default'"
                  @click="prop.value && noteById.has(prop.value) ? openLinkedNote(prop.value) : openNotePicker(prop)"
                >
                  <span class="truncate">
                    {{ prop.value ? noteById.get(prop.value)?.title ?? 'Deleted note' : 'No note linked…' }}
                  </span>
                </button>

                <UPopover
                  v-model:open="notePickerOpen"
                  :content="{ align: 'start', sideOffset: 6 }"
                  :ui="{ content: 'z-50' }"
                  @update:open="open => !open && (notePickerProp = null)"
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
                    <div
                      class="w-72 p-2"
                      @click.stop
                    >
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
                          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-default transition-colors hover:bg-elevated cursor-pointer"
                          @click="linkNote(n.id)"
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
                          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevated cursor-pointer"
                          @click="createAndLinkNote"
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
            </template>

            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Remove property"
              class="shrink-0 opacity-0 group-hover:opacity-100"
              @click="removeProp(prop)"
            />
          </div>

          <!-- Add property -->
          <div class="px-2 -mx-2">
            <UPopover
              v-model:open="addPropOpen"
              :content="{ align: 'start', sideOffset: 6 }"
              :ui="{ content: 'z-50' }"
            >
              <button class="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted transition-colors hover:text-primary cursor-pointer">
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
                    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-default transition-colors hover:bg-elevated cursor-pointer"
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
          </div>

          <!-- Tags -->
          <div
            v-if="selectedTask.tags.length > 0"
            class="flex flex-wrap items-center gap-1.5 px-2 pb-1 -mx-2"
          >
            <span
              v-for="tag in selectedTask.tags"
              :key="tag"
              class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >#{{ tag }}</span>
          </div>
        </div>

        <!-- Description (shared editor) -->
        <div class="mt-2 min-h-0 flex-1 border-t border-default">
          <NotesEditor class="h-full" />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
