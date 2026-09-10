<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import {
  type TableContext,
  type CellCoords,
  tableAtDom,
  tableAtSelection,
  tableDom,
  cellDomAt,
  cellPosAt,
  cellCoordsAtDom,
  cellCoordsAtSelection,
  selectColumn,
  selectRow,
  selectTable,
  clearColumn,
  clearRow,
  clearTable,
  clearSelectedCells,
  moveColumn,
  moveRow,
  columnIsHeader,
  rowIsHeader,
  selectionGridRect,
  isMultiCellSelection
} from '~/utils/table-controls'

// Handles for the table under the pointer (or the caret): one above the
// column, one beside the row, a corner for the whole table, and "+" strips
// along the right and bottom edges. Each handle selects what it stands for and
// opens a menu of everything that can be done with it. Positions are measured
// from the rendered cells, so they follow resizes and reflows.
//
// The overlay lives inside the editor's positioned root rather than being
// teleported: a modal panel around the editor only lets its own layers take
// pointer events, and an overlay inside the editor is inside that layer.
const props = defineProps<{ editor: Editor }>()

const overlay = ref<HTMLElement | null>(null)

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Handle {
  index: number
  center: number
}

const layout = ref<{
  table: Box
  col: Handle | null
  row: Handle | null
  selection: Box | null
} | null>(null)

// What the pointer is over. The table element rather than a document position:
// positions go stale with every keystroke, the element does not.
let hoverTableEl: HTMLTableElement | null = null
let hoverCell: CellCoords | null = null

const menuOpen = ref(false)
let frame = 0

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

let scrollParent: HTMLElement | null = null

function toBox(rect: DOMRect, origin: DOMRect): Box {
  return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height }
}

function measure() {
  frame = 0
  const { editor } = props
  if (editor.isDestroyed || !overlay.value) {
    layout.value = null
    return
  }

  if (hoverTableEl && !editor.view.dom.contains(hoverTableEl)) {
    hoverTableEl = null
    hoverCell = null
  }

  const { state } = editor
  const table: TableContext | null = (hoverTableEl && tableAtDom(editor, hoverTableEl)) ?? tableAtSelection(state)
  const tableEl = table && tableDom(editor, table)
  if (!table || !tableEl) {
    layout.value = null
    return
  }

  const origin = overlay.value.getBoundingClientRect()
  const tableRect = tableEl.getBoundingClientRect()

  // The pointer wins over the caret so the handle follows the mouse; the caret
  // takes over as soon as the pointer leaves the table.
  const hoverApplies = hoverTableEl === tableEl ? hoverCell : null
  const coords = hoverApplies ?? cellCoordsAtSelection(state, table)

  let col: Handle | null = null
  let row: Handle | null = null
  if (coords) {
    const colCell = cellDomAt(editor, table, 0, coords.col)
    const rowCell = cellDomAt(editor, table, coords.row, 0)
    if (colCell) {
      const r = colCell.getBoundingClientRect()
      col = { index: coords.col, center: r.left + r.width / 2 - origin.left }
    }
    if (rowCell) {
      const r = rowCell.getBoundingClientRect()
      row = { index: coords.row, center: r.top + r.height / 2 - origin.top }
    }
  }

  let selection: Box | null = null
  const grid = isMultiCellSelection(state) ? selectionGridRect(state) : null
  if (grid) {
    const first = cellDomAt(editor, table, grid.top, grid.left)
    const last = cellDomAt(editor, table, grid.bottom - 1, grid.right - 1)
    if (first && last) {
      const a = first.getBoundingClientRect()
      const b = last.getBoundingClientRect()
      selection = {
        left: Math.min(a.left, b.left) - origin.left,
        top: Math.min(a.top, b.top) - origin.top,
        width: Math.max(a.right, b.right) - Math.min(a.left, b.left),
        height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top)
      }
    }
  }

  layout.value = { table: toBox(tableRect, origin), col, row, selection }
}

function schedule() {
  if (frame) return
  frame = requestAnimationFrame(measure)
}

// ─── Pointer tracking ──────────────────────────────────────

const HOVER_MARGIN = 28

function onPointerMove(event: PointerEvent) {
  if (menuOpen.value) return
  const target = event.target as Node | null
  if (!target) return

  if (overlay.value?.contains(target)) return

  const { editor } = props
  const table = tableAtDom(editor, target)
  if (table) {
    const el = tableDom(editor, table)
    if (el) {
      hoverTableEl = el
      hoverCell = cellCoordsAtDom(editor, table, target) ?? hoverCell
      schedule()
      return
    }
  }

  // Off the table, but a handle sits just outside its edge: keep the hover
  // alive within a margin so the pointer can reach it.
  if (hoverTableEl) {
    const r = hoverTableEl.getBoundingClientRect()
    const near = event.clientX >= r.left - HOVER_MARGIN && event.clientX <= r.right + HOVER_MARGIN
      && event.clientY >= r.top - HOVER_MARGIN && event.clientY <= r.bottom + HOVER_MARGIN
    if (near) return
    hoverTableEl = null
    hoverCell = null
    schedule()
  }
}

function onPointerLeave() {
  if (menuOpen.value || !hoverTableEl) return
  hoverTableEl = null
  hoverCell = null
  schedule()
}

// ─── Actions ───────────────────────────────────────────────

// Every menu action re-reads the table from the selection at the moment it
// runs: the handle selected its row or column on press, and a selection is the
// one reference that survives whatever the document did in between.
function current() {
  const { state } = props.editor
  const table = tableAtSelection(state)
  const coords = table ? cellCoordsAtSelection(state, table) : null
  return table && coords ? { table, coords } : null
}

function run(action: () => void) {
  action()
  props.editor.commands.focus()
  schedule()
}

// The table a handle acts on: the one under the pointer while hovering, else
// the one the caret is in.
function activeTable() {
  return (hoverTableEl && tableAtDom(props.editor, hoverTableEl)) ?? tableAtSelection(props.editor.state)
}

function pressColumn() {
  const table = activeTable()
  if (layout.value?.col && table) selectColumn(props.editor, table, layout.value.col.index)
}

function pressRow() {
  const table = activeTable()
  if (layout.value?.row && table) selectRow(props.editor, table, layout.value.row.index)
}

function pressCorner() {
  const table = activeTable()
  if (table) selectTable(props.editor, table)
}

// Adds at the end and puts the caret in the new column's first body cell (or
// the new row's first cell), ready to type.
function appendColumn() {
  const table = activeTable()
  if (!table) return
  selectColumn(props.editor, table, table.map.width - 1)
  props.editor.chain().focus().addColumnAfter().run()
  const grown = tableAtSelection(props.editor.state)
  if (grown) {
    const row = Math.min(1, grown.map.height - 1)
    props.editor.commands.focus(cellPosAt(grown, row, grown.map.width - 1) + 1)
  }
  schedule()
}

function appendRow() {
  const table = activeTable()
  if (!table) return
  selectRow(props.editor, table, table.map.height - 1)
  props.editor.chain().focus().addRowAfter().run()
  const grown = tableAtSelection(props.editor.state)
  if (grown) props.editor.commands.focus(cellPosAt(grown, grown.map.height - 1, 0) + 1)
  schedule()
}

// Each of these acts on the row or column the handle selected on press.
function withCurrent(action: (table: TableContext, coords: CellCoords) => void) {
  return () => run(() => {
    const c = current()
    if (c) action(c.table, c.coords)
  })
}

const insertColumnBefore = () => run(() => props.editor.commands.addColumnBefore())
const insertColumnAfter = () => run(() => props.editor.commands.addColumnAfter())
const moveColumnLeft = withCurrent((table, { col }) => moveColumn(props.editor, table, col, col - 1))
const moveColumnRight = withCurrent((table, { col }) => moveColumn(props.editor, table, col, col + 1))
const toggleColumnHeader = () => run(() => props.editor.commands.toggleHeaderColumn())
const eraseColumn = withCurrent((table, { col }) => clearColumn(props.editor, table, col))
const removeColumn = () => run(() => props.editor.commands.deleteColumn())

const insertRowBefore = () => run(() => props.editor.commands.addRowBefore())
const insertRowAfter = () => run(() => props.editor.commands.addRowAfter())
const moveRowUp = withCurrent((table, { row }) => moveRow(props.editor, table, row, row - 1))
const moveRowDown = withCurrent((table, { row }) => moveRow(props.editor, table, row, row + 1))
const toggleRowHeader = () => run(() => props.editor.commands.toggleHeaderRow())
const eraseRow = withCurrent((table, { row }) => clearRow(props.editor, table, row))
const removeRow = () => run(() => props.editor.commands.deleteRow())

const toggleFirstRowHeader = withCurrent((table) => {
  selectRow(props.editor, table, 0)
  props.editor.commands.toggleHeaderRow()
})
const toggleFirstColumnHeader = withCurrent((table) => {
  selectColumn(props.editor, table, 0)
  props.editor.commands.toggleHeaderColumn()
})
const eraseTable = withCurrent(table => clearTable(props.editor, table))
const removeTable = () => run(() => props.editor.commands.deleteTable())

const mergeSelected = () => run(() => props.editor.commands.mergeCells())
const splitSelected = () => run(() => props.editor.commands.splitCell())
const toggleSelectedHeader = () => run(() => props.editor.commands.toggleHeaderCell())
const eraseSelected = () => run(() => clearSelectedCells(props.editor))

const columnItems = computed(() => {
  const ctx = current()
  const col = layout.value?.col?.index ?? ctx?.coords.col ?? 0
  const width = ctx?.table.map.width ?? 1
  const isHeader = ctx ? columnIsHeader(ctx.table, col) : false
  return [[
    { label: 'Insert left', icon: 'i-lucide-arrow-left-to-line', onSelect: insertColumnBefore },
    { label: 'Insert right', icon: 'i-lucide-arrow-right-to-line', onSelect: insertColumnAfter }
  ], [
    { label: 'Move left', icon: 'i-lucide-chevron-left', disabled: col === 0, onSelect: moveColumnLeft },
    { label: 'Move right', icon: 'i-lucide-chevron-right', disabled: col >= width - 1, onSelect: moveColumnRight }
  ], [
    { label: isHeader ? 'Unset header column' : 'Set as header column', icon: 'i-lucide-panel-left', onSelect: toggleColumnHeader },
    { label: 'Clear column', icon: 'i-lucide-eraser', onSelect: eraseColumn }
  ], [
    { label: 'Delete column', icon: 'i-lucide-trash-2', color: 'error' as const, disabled: width <= 1, onSelect: removeColumn }
  ]]
})

const rowItems = computed(() => {
  const ctx = current()
  const row = layout.value?.row?.index ?? ctx?.coords.row ?? 0
  const height = ctx?.table.map.height ?? 1
  const isHeader = ctx ? rowIsHeader(ctx.table, row) : false
  return [[
    { label: 'Insert above', icon: 'i-lucide-arrow-up-to-line', onSelect: insertRowBefore },
    { label: 'Insert below', icon: 'i-lucide-arrow-down-to-line', onSelect: insertRowAfter }
  ], [
    { label: 'Move up', icon: 'i-lucide-chevron-up', disabled: row === 0, onSelect: moveRowUp },
    { label: 'Move down', icon: 'i-lucide-chevron-down', disabled: row >= height - 1, onSelect: moveRowDown }
  ], [
    { label: isHeader ? 'Unset header row' : 'Set as header row', icon: 'i-lucide-panel-top', onSelect: toggleRowHeader },
    { label: 'Clear row', icon: 'i-lucide-eraser', onSelect: eraseRow }
  ], [
    { label: 'Delete row', icon: 'i-lucide-trash-2', color: 'error' as const, disabled: height <= 1, onSelect: removeRow }
  ]]
})

const tableItems = computed(() => [[
  { label: 'Toggle header row', icon: 'i-lucide-panel-top', onSelect: toggleFirstRowHeader },
  { label: 'Toggle header column', icon: 'i-lucide-panel-left', onSelect: toggleFirstColumnHeader }
], [
  { label: 'Clear table', icon: 'i-lucide-eraser', onSelect: eraseTable }
], [
  { label: 'Delete table', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: removeTable }
]])

// ─── Selection toolbar ─────────────────────────────────────

const canMerge = computed(() => props.editor.can().mergeCells())
const canSplit = computed(() => props.editor.can().splitCell())

function onMenuOpen(open: boolean) {
  menuOpen.value = open
  if (!open) schedule()
}

// ─── Lifecycle ─────────────────────────────────────────────

onMounted(() => {
  const root = overlay.value?.parentElement
  scrollParent = findScrollParent(props.editor.view.dom)
  root?.addEventListener('pointermove', onPointerMove)
  root?.addEventListener('pointerleave', onPointerLeave)
  scrollParent?.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  props.editor.on('transaction', schedule)
  props.editor.on('focus', schedule)
  props.editor.on('blur', schedule)
  schedule()
})

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  const root = overlay.value?.parentElement
  root?.removeEventListener('pointermove', onPointerMove)
  root?.removeEventListener('pointerleave', onPointerLeave)
  scrollParent?.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  props.editor.off('transaction', schedule)
  props.editor.off('focus', schedule)
  props.editor.off('blur', schedule)
})

watch(() => props.editor, schedule)

const HANDLE_GAP = 6

const handleClass = 'pointer-events-auto absolute flex items-center justify-center rounded-full border border-accented bg-elevated text-muted shadow-sm transition-colors hover:border-primary hover:bg-primary hover:text-inverted data-[state=open]:border-primary data-[state=open]:bg-primary data-[state=open]:text-inverted'
</script>

<template>
  <div
    ref="overlay"
    class="pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none"
    data-table-controls
  >
    <template v-if="layout">
      <!-- Corner: the whole table -->
      <UDropdownMenu
        :items="tableItems"
        :content="{ align: 'start', side: 'bottom', sideOffset: 4, collisionPadding: 8 }"
        @update:open="onMenuOpen"
      >
        <button
          type="button"
          :class="handleClass"
          class="size-4"
          :style="{ left: `${layout.table.left - 16 - HANDLE_GAP}px`, top: `${layout.table.top - 16 - HANDLE_GAP}px` }"
          aria-label="Table options"
          title="Table"
          @pointerdown="pressCorner"
        >
          <UIcon
            name="i-lucide-table"
            class="size-3"
          />
        </button>
      </UDropdownMenu>

      <!-- Column handle -->
      <UDropdownMenu
        v-if="layout.col"
        :items="columnItems"
        :content="{ align: 'center', side: 'bottom', sideOffset: 4, collisionPadding: 8 }"
        @update:open="onMenuOpen"
      >
        <button
          type="button"
          :class="handleClass"
          class="h-4 w-8 -translate-x-1/2"
          :style="{ left: `${layout.col.center}px`, top: `${layout.table.top - 16 - HANDLE_GAP}px` }"
          aria-label="Column options"
          @pointerdown="pressColumn"
        >
          <UIcon
            name="i-lucide-grip-horizontal"
            class="size-3"
          />
        </button>
      </UDropdownMenu>

      <!-- Row handle -->
      <UDropdownMenu
        v-if="layout.row"
        :items="rowItems"
        :content="{ align: 'start', side: 'right', sideOffset: 4, collisionPadding: 8 }"
        @update:open="onMenuOpen"
      >
        <button
          type="button"
          :class="handleClass"
          class="h-8 w-4 -translate-y-1/2"
          :style="{ left: `${layout.table.left - 16 - HANDLE_GAP}px`, top: `${layout.row.center}px` }"
          aria-label="Row options"
          @pointerdown="pressRow"
        >
          <UIcon
            name="i-lucide-grip-vertical"
            class="size-3"
          />
        </button>
      </UDropdownMenu>

      <!-- Append column: a strip along the right edge -->
      <button
        type="button"
        class="table-add-strip pointer-events-auto absolute flex w-4 items-center justify-center"
        :style="{ left: `${layout.table.left + layout.table.width + 2}px`, top: `${layout.table.top}px`, height: `${layout.table.height}px` }"
        aria-label="Add column"
        title="Add column"
        @pointerdown.prevent="appendColumn"
      >
        <span class="table-add-strip__bar" />
        <span class="table-add-strip__plus">+</span>
      </button>

      <!-- Append row: a strip along the bottom edge -->
      <button
        type="button"
        class="table-add-strip table-add-strip--row pointer-events-auto absolute flex h-4 items-center justify-center"
        :style="{ left: `${layout.table.left}px`, top: `${layout.table.top + layout.table.height + 2}px`, width: `${layout.table.width}px` }"
        aria-label="Add row"
        title="Add row"
        @pointerdown.prevent="appendRow"
      >
        <span class="table-add-strip__bar" />
        <span class="table-add-strip__plus">+</span>
      </button>

      <!-- Multi-cell selection: merge, split, clear. Always in the margin
           above the table: never over a cell, and clear of the column handle
           so a handle's click still lands on it once its column is selected. -->
      <div
        v-if="layout.selection"
        class="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-default bg-default p-1 shadow-lg"
        :style="{ left: `${layout.selection.left + layout.selection.width / 2}px`, top: `${Math.max(4, layout.table.top - 58)}px` }"
      >
        <UTooltip text="Merge cells">
          <UButton
            icon="i-lucide-table-cells-merge"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!canMerge"
            aria-label="Merge cells"
            @click="mergeSelected"
          />
        </UTooltip>
        <UTooltip text="Split cell">
          <UButton
            icon="i-lucide-table-cells-split"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!canSplit"
            aria-label="Split cell"
            @click="splitSelected"
          />
        </UTooltip>
        <UTooltip text="Toggle header cells">
          <UButton
            icon="i-lucide-heading"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Toggle header cells"
            @click="toggleSelectedHeader"
          />
        </UTooltip>
        <div class="mx-0.5 h-4 w-px bg-border" />
        <UTooltip text="Clear cells">
          <UButton
            icon="i-lucide-eraser"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Clear cells"
            @click="eraseSelected"
          />
        </UTooltip>
      </div>
    </template>
  </div>
</template>
