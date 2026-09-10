// Helpers behind the table handles: answering "which table, row and column is
// this?" for a DOM node or the selection, and the handful of table edits that
// prosemirror-tables does not ship as ready-made commands.
import type { Editor } from '@tiptap/core'
import type { Node as PmNode, ResolvedPos } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import {
  CellSelection,
  TableMap,
  cellAround,
  findTable,
  moveTableColumn,
  moveTableRow,
  selectedRect
} from '@tiptap/pm/tables'

export interface TableContext {
  node: PmNode
  /** Position directly before the table node. */
  pos: number
  /** Position of the table's first child; cell offsets in the map add to this. */
  start: number
  map: TableMap
}

export interface CellCoords {
  row: number
  col: number
}

function contextFor($pos: ResolvedPos): TableContext | null {
  const table = findTable($pos)
  if (!table) return null
  return { node: table.node, pos: table.pos, start: table.start, map: TableMap.get(table.node) }
}

/** The table the selection sits in, if any. */
export function tableAtSelection(state: EditorState): TableContext | null {
  return contextFor(state.selection.$anchor)
}

/** The table that owns a DOM node (a cell, a row, text inside a cell). */
export function tableAtDom(editor: Editor, dom: Node): TableContext | null {
  const tableDom = (dom instanceof Element ? dom : dom.parentElement)?.closest('table')
  if (!tableDom || !editor.view.dom.contains(tableDom)) return null
  try {
    return contextFor(editor.state.doc.resolve(editor.view.posAtDOM(tableDom, 0)))
  } catch {
    return null
  }
}

/** Row and column of the cell under a DOM node, in the table's grid. */
export function cellCoordsAtDom(editor: Editor, table: TableContext, dom: Node): CellCoords | null {
  const cellDom = (dom instanceof Element ? dom : dom.parentElement)?.closest('td, th')
  if (!cellDom) return null
  try {
    const $pos = editor.state.doc.resolve(editor.view.posAtDOM(cellDom, 0))
    const $cell = cellAround($pos)
    if (!$cell) return null
    const rect = table.map.findCell($cell.pos - table.start)
    return { row: rect.top, col: rect.left }
  } catch {
    return null
  }
}

/** Row and column of the cell the caret (or the selection's anchor) is in. */
export function cellCoordsAtSelection(state: EditorState, table: TableContext): CellCoords | null {
  const $cell = cellAround(state.selection.$anchor)
    ?? (state.selection instanceof CellSelection ? state.selection.$anchorCell : null)
  if (!$cell) return null
  const rect = table.map.findCell($cell.pos - table.start)
  return { row: rect.top, col: rect.left }
}

/** Absolute document position of the cell covering a grid slot. */
export function cellPosAt(table: TableContext, row: number, col: number) {
  return table.start + table.map.map[row * table.map.width + col]!
}

/** The DOM element rendering the cell that covers a grid slot. */
export function cellDomAt(editor: Editor, table: TableContext, row: number, col: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(cellPosAt(table, row, col))
  return dom instanceof HTMLElement ? dom : null
}

export function tableDom(editor: Editor, table: TableContext): HTMLTableElement | null {
  const dom = editor.view.nodeDOM(table.pos)
  if (dom instanceof HTMLTableElement) return dom
  // With column resizing on, the node view wraps the table in a div.
  return dom instanceof HTMLElement ? dom.querySelector('table') : null
}

export function selectColumn(editor: Editor, table: TableContext, col: number) {
  const { doc } = editor.state
  const anchor = doc.resolve(cellPosAt(table, 0, col))
  const head = doc.resolve(cellPosAt(table, table.map.height - 1, col))
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.colSelection(anchor, head)))
}

export function selectRow(editor: Editor, table: TableContext, row: number) {
  const { doc } = editor.state
  const anchor = doc.resolve(cellPosAt(table, row, 0))
  const head = doc.resolve(cellPosAt(table, row, table.map.width - 1))
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.rowSelection(anchor, head)))
}

export function selectTable(editor: Editor, table: TableContext) {
  const { doc } = editor.state
  const anchor = doc.resolve(cellPosAt(table, 0, 0))
  const head = doc.resolve(cellPosAt(table, table.map.height - 1, table.map.width - 1))
  editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(anchor, head)))
}

/** Replaces the content of every given cell with one empty paragraph. */
function clearCellsAt(tr: Transaction, cellPositions: number[]) {
  const paragraph = tr.doc.type.schema.nodes.paragraph!
  // Highest position first so earlier replacements do not shift later ones.
  for (const pos of [...new Set(cellPositions)].sort((a, b) => b - a)) {
    const cell = tr.doc.nodeAt(pos)
    if (!cell) continue
    tr.replaceWith(pos + 1, pos + 1 + cell.content.size, paragraph.create())
  }
  return tr
}

export function clearSelectedCells(editor: Editor) {
  const { state } = editor
  if (!(state.selection instanceof CellSelection)) return false
  const positions: number[] = []
  state.selection.forEachCell((_cell, pos) => positions.push(pos))
  editor.view.dispatch(clearCellsAt(state.tr, positions))
  return true
}

export function clearColumn(editor: Editor, table: TableContext, col: number) {
  const positions = table.map
    .cellsInRect({ left: col, right: col + 1, top: 0, bottom: table.map.height })
    .map(offset => table.start + offset)
  editor.view.dispatch(clearCellsAt(editor.state.tr, positions))
}

export function clearRow(editor: Editor, table: TableContext, row: number) {
  const positions = table.map
    .cellsInRect({ left: 0, right: table.map.width, top: row, bottom: row + 1 })
    .map(offset => table.start + offset)
  editor.view.dispatch(clearCellsAt(editor.state.tr, positions))
}

export function clearTable(editor: Editor, table: TableContext) {
  const positions = table.map.map.map(offset => table.start + offset)
  editor.view.dispatch(clearCellsAt(editor.state.tr, positions))
}

/** Moves a column one step; false when the move is not possible. */
export function moveColumn(editor: Editor, table: TableContext, from: number, to: number) {
  if (to < 0 || to >= table.map.width) return false
  return moveTableColumn({ from, to, select: true, pos: table.start })(editor.state, editor.view.dispatch)
}

export function moveRow(editor: Editor, table: TableContext, from: number, to: number) {
  if (to < 0 || to >= table.map.height) return false
  return moveTableRow({ from, to, select: true, pos: table.start })(editor.state, editor.view.dispatch)
}

/** True when the cells in a column are all header cells. */
export function columnIsHeader(table: TableContext, col: number) {
  const header = table.node.type.schema.nodes.tableHeader
  for (let row = 0; row < table.map.height; row++) {
    if (table.node.nodeAt(table.map.map[row * table.map.width + col]!)?.type !== header) return false
  }
  return true
}

export function rowIsHeader(table: TableContext, row: number) {
  const header = table.node.type.schema.nodes.tableHeader
  for (let col = 0; col < table.map.width; col++) {
    if (table.node.nodeAt(table.map.map[row * table.map.width + col]!)?.type !== header) return false
  }
  return true
}

/** Bounding grid rect of a cell selection, or null for a caret. */
export function selectionGridRect(state: EditorState) {
  if (!(state.selection instanceof CellSelection)) return null
  const rect = selectedRect(state)
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
}

/** Whether a cell selection spans more than one cell. */
export function isMultiCellSelection(state: EditorState) {
  if (!(state.selection instanceof CellSelection)) return false
  let count = 0
  state.selection.forEachCell(() => {
    count++
  })
  return count > 1
}
