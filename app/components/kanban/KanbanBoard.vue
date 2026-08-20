<script setup lang="ts">
import Sortable from 'sortablejs'
import type { ProjectColumn } from '~/composables/useProjects'
import { columnDotClass } from '~/utils/tagColors'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ openTask: [taskId: string] }>()

const {
  board,
  boardColumns,
  visibleColumnTasks,
  commentCount,
  activeTags,
  createTask,
  moveTask,
  addColumn,
  renameColumn,
  moveColumn,
  deleteColumn
} = useProjects()

// ─── Drag & drop ────────────────────────────────────────────

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
  const before = beforeId ? siblings.find(t => t.id === beforeId)?.position ?? null : null
  const after = afterId ? siblings.find(t => t.id === afterId)?.position ?? null : null

  let position: number
  if (before === null && after === null) position = (siblings.at(-1)?.position ?? -1000) + 1000
  else if (before === null) position = (after as number) - 1000
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

// Column-level Sortable instances must follow board loads; task lists mount per
// column so their Sortable is wired in the same watcher.
watch(boardColumns, async (cols) => {
  await nextTick()
  destroySortables()

  if (boardEl.value) {
    columnSortable = Sortable.create(boardEl.value, {
      group: 'kanban-columns',
      draggable: '.kanban-column',
      animation: 150,
      handle: '.kanban-column-handle',
      filter: '.kanban-add-column',
      onEnd: handleColumnDrop
    })
  }

  for (const col of cols) {
    const el = listEls.get(col.id)
    if (!el) continue
    taskSortables.push(Sortable.create(el, {
      group: 'kanban-tasks',
      draggable: '.kanban-card-wrap',
      animation: 150,
      ghostClass: 'kanban-ghost',
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
  composingColumnId.value = columnId
  composingTitle.value = ''
  await nextTick()
  focusIn<HTMLTextAreaElement>('[data-composer]')
}

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
    composingTitle.value = ''
    composingColumnId.value = null
  }
}

async function onComposerBlur(columnId: string) {
  if (submitting) return
  await submitTask(columnId)
  composingColumnId.value = null
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

async function confirmDeleteColumn() {
  const column = deletingColumn.value
  deletingColumn.value = null
  if (column) await deleteColumn(column.id)
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
      class="kanban-column flex h-full w-[19rem] shrink-0 flex-col rounded-xl bg-elevated/50"
    >
      <!-- Column header — also the drag handle -->
      <header class="kanban-column-handle group/col flex cursor-grab items-center gap-2 px-3 pb-2 pt-2.5 active:cursor-grabbing">
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
          {{ visibleColumnTasks(column.id).length }}
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
          v-for="task in visibleColumnTasks(column.id)"
          :key="task.id"
          class="kanban-card-wrap"
          :data-id="task.id"
        >
          <KanbanCard
            :task="task"
            :comment-count="commentCount(task.id)"
            @open="emit('openTask', $event)"
          />
        </div>

        <p
          v-if="isFiltering && visibleColumnTasks(column.id).length === 0"
          class="px-1 py-2 text-xs text-dimmed"
        >
          Nothing matches the filter
        </p>

        <!-- Composer sits with the cards, not pinned to the bottom of a tall
             empty column. Sortable ignores it: only .kanban-card-wrap drags. -->
        <textarea
          v-if="composingColumnId === column.id"
          v-model="composingTitle"
          data-composer
          rows="2"
          placeholder="Task title — Enter to add, Esc to close"
          class="w-full resize-none rounded-lg border border-primary/60 bg-default p-2.5 text-sm text-default outline-none placeholder:text-dimmed"
          @keydown="onComposerKeydown($event, column.id)"
          @blur="onComposerBlur(column.id)"
        />
        <button
          v-else
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
      description="Its tasks move to the previous column. A first column's tasks move to the next one."
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
          label="Delete column"
          color="error"
          @click="confirmDeleteColumn"
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
