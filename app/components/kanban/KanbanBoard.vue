<script setup lang="ts">
import Sortable from 'sortablejs'
import type { ProjectColumn, ProjectTask } from '~/composables/useProjects'
import { columnDotClass } from '~/utils/tagColors'
import { relativeTime } from '~/composables/useRelativeTime'
import { deletionSourceLabel } from '#shared/utils/board'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ openTask: [taskId: string] }>()

const {
  board,
  boardColumns,
  columnTasks,
  visibleColumnTasks,
  commentCount,
  activeTags,
  isTrashed,
  createTask,
  moveTask,
  deleteTask,
  restoreTask,
  addColumn,
  renameColumn,
  moveColumn,
  deleteColumn,
  restoreColumn
} = useProjects()

const toast = useToast()

// ─── Drag & drop ────────────────────────────────────────────

// A finger on a card means "scroll this column" far more often than it means
// "pick this card up", and without a hold the board eats every swipe. A short
// press before the drag arms gives touch its scrolling back; a mouse is
// unambiguous and keeps dragging on contact.
const TOUCH_HOLD = {
  delay: 160,
  delayOnTouchOnly: true,
  touchStartThreshold: 6
} as const

const boardEl = useTemplateRef<HTMLDivElement>('boardEl')
const listEls = new Map<string, HTMLElement>()
let columnSortable: Sortable | null = null
const taskSortables: Sortable[] = []

function registerList(el: unknown, column: ProjectColumn) {
  if (el instanceof HTMLElement) listEls.set(column.id, el)
  else listEls.delete(column.id)
}

// Local mirror reorder so the DOM (already reverted by the handler below) snaps
// to the drop position without waiting for the server round-trip.
function applyLocalMove(taskId: string, columnId: string, beforeId: string | null, afterId: string | null) {
  if (!board.value) return
  const tasks = board.value.tasks
  const task = tasks.find(t => t.id === taskId)
  if (!task) return

  const siblings = tasks
    .filter(t => t.columnId === columnId && t.id !== taskId)
    .sort((a, b) => a.position - b.position)

  // Mirrors positionBetween on the server: the card named above the drop is the
  // anchor and the bound below it comes from the whole column, not from the pair
  // the DOM reported. A label filter or a collapsed column leaves cards out of
  // that DOM, and splitting the reported pair would compute a slot a hidden card
  // is already sitting in.
  const beforeIdx = beforeId ? siblings.findIndex(t => t.id === beforeId) : -1
  const afterIdx = afterId ? siblings.findIndex(t => t.id === afterId) : -1

  let before: number | null = null
  let after: number | null = null
  if (beforeIdx >= 0) {
    before = siblings[beforeIdx]!.position
    after = siblings[beforeIdx + 1]?.position ?? null
  } else if (afterIdx >= 0) {
    before = siblings[afterIdx - 1]?.position ?? null
    after = siblings[afterIdx]!.position
  }

  let position: number
  if (before === null && after === null) {
    position = afterId && !beforeId
      ? (siblings[0]?.position ?? 1000) - 1000
      : (siblings.at(-1)?.position ?? -1000) + 1000
  } else if (before === null) position = (after as number) - 1000
  else if (after === null) position = before + 1000
  else position = Math.floor((before + after) / 2)

  task.columnId = columnId
  task.position = position
  board.value = { ...board.value, tasks: [...tasks] }
}

function handleDrop(evt: Sortable.SortableEvent) {
  const itemEl = evt.item as HTMLElement
  const taskId = itemEl.dataset.id
  const toColumnId = (evt.to as HTMLElement).dataset.columnId
  if (!taskId || !toColumnId) return

  // Neighbors around the dropped position (excluding the card itself).
  const children = [...evt.to.children] as HTMLElement[]
  const droppedAt = children.indexOf(itemEl)
  const beforeEl = children.slice(0, droppedAt).reverse().find(el => el.dataset.id)
  const afterEl = children.slice(droppedAt + 1).find(el => el.dataset.id)

  // Revert the DOM: Vue owns it, state is the single source of truth.
  evt.from.insertBefore(itemEl, evt.from.children[evt.oldIndex ?? 0] ?? null)

  applyLocalMove(taskId, toColumnId, beforeEl?.dataset.id ?? null, afterEl?.dataset.id ?? null)
  moveTask(taskId, toColumnId, beforeEl?.dataset.id ?? null, afterEl?.dataset.id ?? null)
}

function handleColumnDrop(evt: Sortable.SortableEvent) {
  const itemEl = evt.item as HTMLElement
  const columnId = itemEl.dataset.columnId
  if (!columnId || !boardEl.value) return

  const columns = [...boardEl.value.children].filter(el =>
    (el as HTMLElement).classList?.contains('kanban-column')
  ) as HTMLElement[]
  const droppedAt = columns.indexOf(itemEl)
  const beforeEl = columns.slice(0, droppedAt).reverse().find(el => el.dataset.columnId)
  const afterEl = columns.slice(droppedAt + 1).find(el => el.dataset.columnId)

  evt.from.insertBefore(itemEl, evt.from.children[evt.oldIndex ?? 0] ?? null)

  // Optimistic local reorder.
  if (board.value) {
    const col = board.value.columns.find(c => c.id === columnId)
    const siblings = board.value.columns
      .filter(c => c.id !== columnId)
      .sort((a, b) => a.position - b.position)
    const before = beforeEl ? siblings.find(c => c.id === beforeEl.dataset.columnId)?.position ?? null : null
    const after = afterEl ? siblings.find(c => c.id === afterEl.dataset.columnId)?.position ?? null : null
    if (col) {
      if (before === null && after === null) col.position = 0
      else if (before === null) col.position = (after as number) - 1000
      else if (after === null) col.position = before + 1000
      else col.position = Math.floor((before + after) / 2)
      board.value = { ...board.value, columns: [...board.value.columns] }
    }
  }

  moveColumn(columnId, beforeEl?.dataset.columnId ?? null, afterEl?.dataset.columnId ?? null)
}

// Sortable instances follow the *set* of columns, not the board object. Watching
// the board itself would rebuild them on every task write — including one that
// lands mid-drag from an autosave, an agent or a teammate, which would destroy
// the instance holding the drag and drop the card on the floor.
const columnSignature = computed(() =>
  boardColumns.value.map(column => `${column.id}:${column.position}`).join(',')
)

watch(columnSignature, async () => {
  const cols = boardColumns.value
  await nextTick()
  destroySortables()

  if (boardEl.value) {
    columnSortable = Sortable.create(boardEl.value, {
      group: 'kanban-columns',
      draggable: '.kanban-column',
      animation: 150,
      handle: '.kanban-column-handle',
      // A column in the trash keeps its slot on the board so it is obvious
      // where it used to be, but it is not something to drag around.
      filter: '.kanban-add-column, .kanban-column-trashed',
      ...TOUCH_HOLD,
      onEnd: handleColumnDrop
    })
  }

  for (const col of cols) {
    const el = listEls.get(col.id)
    if (!el) continue
    taskSortables.push(Sortable.create(el, {
      group: 'kanban-tasks',
      // Trashed cards render without this class, so they sit in place and
      // neither drag nor accept a drop.
      draggable: '.kanban-card-wrap',
      animation: 150,
      ghostClass: 'kanban-ghost',
      ...TOUCH_HOLD,
      onEnd: handleDrop
    }))
  }
}, { immediate: true })

onBeforeUnmount(destroySortables)

function destroySortables() {
  columnSortable?.destroy()
  columnSortable = null
  for (const s of taskSortables) s.destroy()
  taskSortables.length = 0
}

// ─── Inline task creation ───────────────────────────────────

const composingColumnId = ref<string | null>(null)
const composingTitle = ref('')

// A `ref` inside v-for collects into an array, so the single mounted composer /
// rename input is grabbed from the DOM instead.
function focusIn<T extends HTMLElement>(selector: string, select = false) {
  const el = boardEl.value?.querySelector<T>(selector)
  el?.focus()
  if (select && el instanceof HTMLInputElement) el.select()
}

async function startCompose(columnId: string) {
  // A new card joins the end of the column, which on a folded one is behind the
  // fold — so writing in a column opens the whole of it. Adding to a column is
  // as good a sign as any that it is the one being worked in.
  expandColumn(columnId)
  composingColumnId.value = columnId
  composingTitle.value = ''
  await nextTick()
  focusIn<HTMLTextAreaElement>('[data-composer]')
}

// An empty composer never becomes a card: a title is the whole of a task, so
// with nothing typed there is nothing to keep. Anything typed is committed,
// including on the way out — clicking away from a written card should not throw
// the writing away.
async function submitTask(columnId: string) {
  const title = composingTitle.value.trim()
  composingTitle.value = ''
  if (!title) return
  await createTask(props.projectId, columnId, title)
}

// Enter adds and keeps the composer open so several cards land in a row. The
// new card re-renders the list and blurs the textarea, so the blur handler has
// to know a submit is in flight and leave the composer alone.
let submitting = false

function closeComposer(columnId: string) {
  // Blur fires after the click that caused it, so by now another column's
  // composer may already have opened. Closing then would shut the one that has
  // just taken this one's place.
  if (composingColumnId.value === columnId) composingColumnId.value = null
}

async function onComposerKeydown(e: KeyboardEvent, columnId: string) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submitting = true
    try {
      await submitTask(columnId)
      await nextTick()
      focusIn<HTMLTextAreaElement>('[data-composer]')
    } finally {
      submitting = false
    }
  } else if (e.key === 'Escape') {
    // Escape is the way out that keeps nothing, so the draft is dropped before
    // the blur that follows can commit it.
    composingTitle.value = ''
    closeComposer(columnId)
  }
}

async function onComposerBlur(columnId: string) {
  if (submitting) return
  await submitTask(columnId)
  closeComposer(columnId)
}

// ─── Column rename (inline) / delete / add ──────────────────

const renamingColumnId = ref<string | null>(null)
const renameValue = ref('')

async function startRename(column: ProjectColumn) {
  renamingColumnId.value = column.id
  renameValue.value = column.name
  await nextTick()
  focusIn<HTMLInputElement>('[data-column-rename]', true)
}

async function commitRename(column: ProjectColumn) {
  const id = renamingColumnId.value
  const name = renameValue.value.trim()
  renamingColumnId.value = null
  if (id && name && name !== column.name) await renameColumn(id, name)
}

const deletingColumn = ref<ProjectColumn | null>(null)

// A column normally hands its tasks to a neighbour, but the last column on a
// board has no neighbour to hand them to and takes them into the trash with it.
// Either way the column is recoverable for a week, which is what the prompt has
// to get across — this is no longer a point of no return.
const deleteColumnPrompt = computed(() => {
  const column = deletingColumn.value
  if (!column) return null
  if (liveColumns.value.length > 1) {
    return {
      description: 'Its tasks move to the previous column — a first column\'s tasks move to the next one. The column goes to the board\'s trash, where "Show trashed" can restore it with its tasks for 7 days.',
      confirm: 'Delete column'
    }
  }
  const count = columnTasks(column.id).length
  return {
    description: count
      ? `This is the board's only column, so there is nowhere for its ${count} ${count === 1 ? 'task' : 'tasks'} to go — they go to the trash with it. "Show trashed" can restore all of it for 7 days.`
      : 'This is the board\'s only column. Deleting it leaves an empty board; "Show trashed" can restore it for 7 days.',
    confirm: count ? `Delete column and ${count} ${count === 1 ? 'task' : 'tasks'}` : 'Delete column'
  }
})

async function confirmDeleteColumn() {
  const column = deletingColumn.value
  deletingColumn.value = null
  if (!column) return
  await deleteColumn(column.id)
  toast.add({
    title: `"${column.name}" moved to trash`,
    description: 'Restore it from Show trashed for the next 7 days.',
    icon: 'i-lucide-trash-2',
    duration: 5000
  })
}

function columnMenu(column: ProjectColumn) {
  return [[
    { label: 'Add task', icon: 'i-lucide-plus', onSelect: () => startCompose(column.id) },
    { label: 'Rename', icon: 'i-lucide-pencil', onSelect: () => startRename(column) }
  ], [
    {
      label: 'Delete column',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => { deletingColumn.value = column }
    }
  ]]
}

// ─── Trash ──────────────────────────────────────────────────

// The board draws its trash in place: a deleted column keeps its slot and a
// deleted card keeps its row, both faded. Nothing is filtered out here — the
// board endpoint only sends trashed rows when the mode is on, so when it is off
// there is nothing trashed in state to draw.
const liveColumns = computed(() => boardColumns.value.filter(column => !isTrashed(column)))

// A live column counts the cards on it, as it always has; the trashed cards
// sitting in it are not part of the board. A trashed column counts what
// restoring it would bring back, which is everything still inside it.
function columnCount(column: ProjectColumn): number {
  const tasks = tasksOf(column.id)
  return isTrashed(column) ? tasks.length : tasks.filter(task => !isTrashed(task)).length
}

function trashedNote(row: { deletedAt?: number | null, deletedVia?: 'ui' | 'mcp' | 'ai' | null }) {
  if (!row.deletedAt) return ''
  return `Deleted ${relativeTime(row.deletedAt)}${deletionSourceLabel(row.deletedVia)}`
}

async function onRestoreTask(taskId: string) {
  const res = await restoreTask(taskId)
  toast.add({
    title: 'Task restored',
    ...(res.restoredColumn ? { description: `Back in "${res.restoredColumn}".` } : {}),
    icon: 'i-lucide-undo-2',
    duration: 4000
  })
}

async function onRestoreColumn(column: ProjectColumn) {
  const res = await restoreColumn(column.id)
  toast.add({
    title: `"${column.name}" restored`,
    ...(res.restoredTasks ? { description: `${res.restoredTasks} ${res.restoredTasks === 1 ? 'task came' : 'tasks came'} back with it.` } : {}),
    icon: 'i-lucide-undo-2',
    duration: 4000
  })
}

// Permanent removal is the one thing an agent cannot do, so it always asks
// first — from here there is nothing left to restore.
const purgingTask = ref<ProjectTask | null>(null)
const purgingColumn = ref<ProjectColumn | null>(null)

function askPurgeTask(taskId: string) {
  purgingTask.value = (board.value?.tasks ?? []).find(task => task.id === taskId) ?? null
}

async function confirmPurgeTask() {
  const task = purgingTask.value
  purgingTask.value = null
  if (task) await deleteTask(task.id)
}

const purgeColumnPrompt = computed(() => {
  const column = purgingColumn.value
  if (!column) return null
  const count = (board.value?.tasks ?? []).filter(task => task.columnId === column.id).length
  return count
    ? `"${column.name}" and the ${count} ${count === 1 ? 'task' : 'tasks'} still in it are removed for good, with their updates. This cannot be undone.`
    : `"${column.name}" is removed for good. This cannot be undone.`
})

async function confirmPurgeColumn() {
  const column = purgingColumn.value
  purgingColumn.value = null
  if (column) await deleteColumn(column.id)
}

const addingColumn = ref(false)
const newColumnName = ref('')
const newColumnEl = ref<HTMLInputElement | null>(null)

async function startAddColumn() {
  addingColumn.value = true
  newColumnName.value = ''
  await nextTick()
  newColumnEl.value?.focus()
}

async function submitColumn() {
  const name = newColumnName.value.trim()
  newColumnName.value = ''
  addingColumn.value = false
  if (name) await addColumn(props.projectId, name)
}

const isFiltering = computed(() => activeTags.value.length > 0)

// Filtered once per render instead of three times per column (header count,
// list and empty state each asked for the same list).
const tasksByColumn = computed(() => {
  const map = new Map<string, ProjectTask[]>()
  for (const column of boardColumns.value) map.set(column.id, visibleColumnTasks(column.id))
  return map
})

function tasksOf(columnId: string): ProjectTask[] {
  return tasksByColumn.value.get(columnId) ?? []
}

// ─── Long columns ───────────────────────────────────────────

// A column that has been collecting finished work for months is a long stretch
// of cards nobody scrolls to, rendered on every board load. Past this many, the
// tail folds into one line that opens it. Column order is untouched — this is
// only how much of the column is on screen.
const COLLAPSE_AFTER = 20

const expandedColumns = ref(new Set<string>())

// Opening one board and then another should not carry the first one's expanded
// columns over, and neither should filtering down to a handful of cards.
watch([() => props.projectId, activeTags], () => {
  expandedColumns.value = new Set()
})

function isCollapsed(columnId: string): boolean {
  return tasksOf(columnId).length > COLLAPSE_AFTER && !expandedColumns.value.has(columnId)
}

function visibleTasksOf(columnId: string): ProjectTask[] {
  const tasks = tasksOf(columnId)
  return isCollapsed(columnId) ? tasks.slice(0, COLLAPSE_AFTER) : tasks
}

function foldedCount(columnId: string): number {
  return isCollapsed(columnId) ? tasksOf(columnId).length - COLLAPSE_AFTER : 0
}

function expandColumn(columnId: string) {
  expandedColumns.value = new Set(expandedColumns.value).add(columnId)
}

// ─── Keyboard ───────────────────────────────────────────────

// Cards are focusable, so the board can be walked without a mouse: arrows move
// between cards, Enter opens one (the card handles that itself) and `n` starts
// a card in the column being looked at.

function cardsIn(columnEl: Element): HTMLElement[] {
  return [...columnEl.querySelectorAll<HTMLElement>('[data-card-id]')]
}

function focusedCard(): HTMLElement | null {
  const el = document.activeElement
  return el instanceof HTMLElement && el.dataset.cardId ? el : null
}

function columnEls(): HTMLElement[] {
  return boardEl.value ? [...boardEl.value.querySelectorAll<HTMLElement>('.kanban-column')] : []
}

function moveFocusWithinColumn(card: HTMLElement, step: number) {
  const columnEl = card.closest('.kanban-column')
  if (!columnEl) return
  const cards = cardsIn(columnEl)
  cards[Math.min(Math.max(cards.indexOf(card) + step, 0), cards.length - 1)]?.focus()
}

function moveFocusAcrossColumns(card: HTMLElement | null, step: number) {
  const columns = columnEls()
  if (!columns.length) return

  const columnEl = card?.closest('.kanban-column')
  const from = columnEl ? columns.indexOf(columnEl as HTMLElement) : -1
  const row = columnEl && card ? cardsIn(columnEl).indexOf(card) : 0

  // Skip past columns with nothing to land on rather than stopping dead on them.
  for (let i = from + step; i >= 0 && i < columns.length; i += step) {
    const cards = cardsIn(columns[i]!)
    if (cards.length) {
      cards[Math.min(row, cards.length - 1)]?.focus()
      return
    }
  }
}

function onBoardKeydown(e: KeyboardEvent) {
  if (!boardEl.value || e.metaKey || e.ctrlKey || e.altKey) return

  // Anything being typed into owns its own keys, and an open panel or menu is
  // in front of the board rather than part of it.
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (document.querySelector('[role="dialog"], [role="menu"]')) return

  const card = focusedCard()

  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const step = e.key === 'ArrowDown' ? 1 : -1
      if (card) moveFocusWithinColumn(card, step)
      else if (step === 1) moveFocusAcrossColumns(null, 1)
      else return
      e.preventDefault()
      break
    }
    case 'ArrowRight':
    case 'ArrowLeft':
      moveFocusAcrossColumns(card, e.key === 'ArrowRight' ? 1 : -1)
      e.preventDefault()
      break
    case 'Escape':
      if (!card) return
      card.blur()
      e.preventDefault()
      break
    case 'n':
    case 'N': {
      // The column being looked at, or the first one when nothing is focused.
      // A trashed column takes no new cards, so `n` skips past it.
      const focused = card?.closest<HTMLElement>('.kanban-column')?.dataset.columnId
      const columnId = liveColumns.value.some(column => column.id === focused)
        ? focused
        : liveColumns.value[0]?.id
      if (!columnId) return
      e.preventDefault()
      startCompose(columnId)
      break
    }
  }
}

onMounted(() => window.addEventListener('keydown', onBoardKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onBoardKeydown))
</script>

<template>
  <div
    v-if="board"
    ref="boardEl"
    class="flex h-full min-h-0 items-stretch gap-3 overflow-x-auto px-4 py-4 lg:px-6"
  >
    <section
      v-for="column in boardColumns"
      :key="column.id"
      :data-column-id="column.id"
      class="kanban-column flex h-full w-[19rem] shrink-0 flex-col rounded-xl"
      :class="isTrashed(column)
        ? 'kanban-column-trashed border border-dashed border-default bg-elevated/20 opacity-60 transition-opacity hover:opacity-100'
        : 'bg-elevated/50'"
    >
      <!-- A trashed column is a header and its cards, and nothing that edits
           them: the two ways out are restoring it or removing it for good. -->
      <header
        v-if="isTrashed(column)"
        class="flex flex-col gap-1.5 px-3 pb-2 pt-2.5"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-trash-2"
            class="size-3.5 shrink-0 text-dimmed"
          />
          <span
            class="min-w-0 flex-1 truncate text-sm font-semibold text-muted line-through decoration-1"
            :title="column.name"
          >
            {{ column.name }}
          </span>
          <span class="shrink-0 text-xs tabular-nums text-dimmed">
            {{ columnCount(column) }}
          </span>
        </div>
        <p class="truncate text-[0.6875rem] text-dimmed">
          {{ trashedNote(column) }}
        </p>
        <div class="flex items-center gap-1">
          <UButton
            label="Restore"
            icon="i-lucide-undo-2"
            size="xs"
            color="neutral"
            variant="soft"
            @click="onRestoreColumn(column)"
          />
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="error"
            variant="ghost"
            aria-label="Delete column permanently"
            title="Delete permanently"
            @click="purgingColumn = column"
          />
        </div>
      </header>

      <!-- Column header — also the drag handle -->
      <header
        v-else
        class="kanban-column-handle group/col flex cursor-grab items-center gap-2 px-3 pb-2 pt-2.5 active:cursor-grabbing"
      >
        <span
          class="size-2 shrink-0 rounded-full"
          :class="columnDotClass(column.name)"
        />

        <input
          v-if="renamingColumnId === column.id"
          v-model="renameValue"
          data-column-rename
          class="min-w-0 flex-1 rounded bg-default px-1 py-0.5 text-sm font-semibold text-default outline-none ring-1 ring-primary"
          @click.stop
          @keydown.enter.prevent="commitRename(column)"
          @keydown.escape="renamingColumnId = null"
          @blur="commitRename(column)"
        >
        <button
          v-else
          class="min-w-0 max-w-full cursor-text truncate text-left text-sm font-semibold text-default"
          :title="column.name"
          @click.stop="startRename(column)"
        >
          {{ column.name }}
        </button>

        <span class="mr-auto shrink-0 text-xs tabular-nums text-dimmed">
          {{ columnCount(column) }}
        </span>

        <!-- Actions keep their slot at all times: fading them in instead of
             mounting them keeps the header from reflowing on hover. -->
        <div class="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/col:opacity-100">
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Add task"
            @click.stop="startCompose(column.id)"
          />
          <UDropdownMenu :items="columnMenu(column)">
            <UButton
              icon="i-lucide-ellipsis"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Column options"
              @click.stop
            />
          </UDropdownMenu>
        </div>
      </header>

      <!-- Task list -->
      <div
        :ref="(el) => registerList(el, column)"
        :data-column-id="column.id"
        class="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-hidden"
      >
        <div
          v-for="task in visibleTasksOf(column.id)"
          :key="task.id"
          :class="isTrashed(task) ? '' : 'kanban-card-wrap'"
          :data-id="task.id"
        >
          <KanbanCard
            :task="task"
            :comment-count="commentCount(task.id)"
            @open="emit('openTask', $event)"
            @restore="onRestoreTask"
            @purge="askPurgeTask"
          />
        </div>

        <!-- The tail of a long column, one line instead of a hundred cards. -->
        <button
          v-if="foldedCount(column.id)"
          class="rounded-lg border border-dashed border-default px-2 py-1.5 text-xs text-muted transition-colors hover:border-primary/50 hover:text-default"
          @click="expandColumn(column.id)"
        >
          +{{ foldedCount(column.id) }} older
        </button>

        <p
          v-if="isFiltering && tasksOf(column.id).length === 0"
          class="px-1 py-2 text-xs text-dimmed"
        >
          Nothing matches the filter
        </p>

        <!-- Composer sits with the cards, not pinned to the bottom of a tall
             empty column. Sortable ignores it: only .kanban-card-wrap drags. -->
        <textarea
          v-if="composingColumnId === column.id && !isTrashed(column)"
          v-model="composingTitle"
          data-composer
          rows="2"
          placeholder="Task title — Enter to add, Esc to close"
          class="w-full resize-none rounded-lg border border-primary/60 bg-default p-2.5 text-sm text-default outline-none placeholder:text-dimmed"
          @keydown="onComposerKeydown($event, column.id)"
          @blur="onComposerBlur(column.id)"
        />
        <button
          v-else-if="!isTrashed(column)"
          class="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-default hover:text-default"
          @click="startCompose(column.id)"
        >
          <UIcon
            name="i-lucide-plus"
            class="size-4"
          />
          New task
        </button>
      </div>
    </section>

    <!-- Add column -->
    <div class="kanban-add-column w-[19rem] shrink-0 self-start">
      <input
        v-if="addingColumn"
        ref="newColumnEl"
        v-model="newColumnName"
        placeholder="Column name"
        class="w-full rounded-xl border border-primary/60 bg-default px-3 py-2.5 text-sm text-default outline-none placeholder:text-dimmed"
        @keydown.enter.prevent="submitColumn"
        @keydown.escape="addingColumn = false"
        @blur="submitColumn"
      >
      <button
        v-else
        class="flex w-full items-center gap-2 rounded-xl border border-dashed border-default px-3 py-2.5 text-sm text-muted transition-colors hover:border-primary/50 hover:text-default"
        @click="startAddColumn"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-4"
        />
        Add column
      </button>
    </div>

    <!-- Delete column confirm -->
    <UModal
      :open="deletingColumn !== null"
      title="Delete column?"
      :description="deleteColumnPrompt?.description"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) deletingColumn = null }"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="deletingColumn = null"
        />
        <UButton
          :label="deleteColumnPrompt?.confirm ?? 'Delete column'"
          color="error"
          @click="confirmDeleteColumn"
        />
      </template>
    </UModal>

    <!-- Permanent delete confirms — the trash is the last stop before these -->
    <UModal
      :open="purgingTask !== null"
      title="Delete this task for good?"
      :description="purgingTask ? `\u201C${purgingTask.title}\u201D and its updates are removed permanently. This cannot be undone.` : ''"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) purgingTask = null }"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="purgingTask = null"
        />
        <UButton
          label="Delete permanently"
          color="error"
          @click="confirmPurgeTask"
        />
      </template>
    </UModal>

    <UModal
      :open="purgingColumn !== null"
      title="Delete this column for good?"
      :description="purgeColumnPrompt ?? ''"
      :ui="{ footer: 'justify-end' }"
      @update:open="(v: boolean) => { if (!v) purgingColumn = null }"
    >
      <template #footer>
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="purgingColumn = null"
        />
        <UButton
          label="Delete permanently"
          color="error"
          @click="confirmPurgeColumn"
        />
      </template>
    </UModal>
  </div>

  <div
    v-else
    class="flex h-full items-center justify-center"
  >
    <UIcon
      name="i-lucide-loader-circle"
      class="size-5 animate-spin text-muted"
    />
  </div>
</template>

<style scoped>
/* Sortable's placeholder: a dashed slot instead of a washed-out copy. */
:deep(.kanban-ghost) > * {
  opacity: 0;
}

:deep(.kanban-ghost) {
  border-radius: 0.5rem;
  outline: 1px dashed var(--ui-border-accented);
  outline-offset: -1px;
  background: var(--ui-bg-elevated);
}
</style>
