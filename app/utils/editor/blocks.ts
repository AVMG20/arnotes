import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import { fragmentToMarkdown } from '~/utils/editor/clipboard'

// Working with whole blocks: moving them, duplicating them, naming them. The
// keyboard shortcuts and the block handle's menu are two ways into the same
// operations.

export const LIST_ITEMS = new Set(['listItem', 'taskItem'])

// The depth of the thing a move or duplicate applies to: the list item the
// caret is in, so items reorder within their list, and otherwise the top-level
// block.
function blockDepth($from: ResolvedPos, $to: ResolvedPos): number {
  const shared = $from.sharedDepth($to.pos)
  for (let depth = shared; depth > 1; depth--) {
    if (LIST_ITEMS.has($from.node(depth).type.name)) return depth
  }
  return 1
}

interface BlockRange {
  parent: ProseMirrorNode
  // Indexes into `parent` of the first and last selected block.
  first: number
  last: number
  // Document positions around the run of selected blocks.
  start: number
  end: number
}

function selectedBlocks(editor: Editor): BlockRange | null {
  const { $from, $to } = editor.state.selection
  if ($from.depth === 0) {
    // A node selection on a top-level block (an image, a rule).
    const first = $from.index(0)
    const last = Math.max(first, $to.indexAfter(0) - 1)
    return { parent: editor.state.doc, first, last, start: $from.posAtIndex(first, 0), end: $from.posAtIndex(last + 1, 0) }
  }
  const depth = blockDepth($from, $to)
  const first = $from.index(depth - 1)
  const last = $to.index(depth - 1)
  return {
    parent: $from.node(depth - 1),
    first,
    last,
    start: $from.posAtIndex(first, depth - 1),
    end: $from.posAtIndex(last + 1, depth - 1)
  }
}

// The neighbour is what moves, to the far side of the selection: the selected
// blocks never leave the document, so the caret and selection stay put in them.
export function moveBlocks(editor: Editor, direction: 'up' | 'down'): boolean {
  const range = selectedBlocks(editor)
  if (!range) return false
  const { parent, first, last, start, end } = range
  const { tr } = editor.state

  if (direction === 'up') {
    if (first === 0) return true
    const neighbour = parent.child(first - 1)
    tr.delete(start - neighbour.nodeSize, start)
    tr.insert(tr.mapping.map(end, -1), neighbour)
  } else {
    if (last >= parent.childCount - 1) return true
    const neighbour = parent.child(last + 1)
    tr.delete(end, end + neighbour.nodeSize)
    tr.insert(start, neighbour)
  }

  editor.view.dispatch(tr.scrollIntoView())
  return true
}

export function duplicateBlocks(editor: Editor): boolean {
  const range = selectedBlocks(editor)
  if (!range) return false
  const copies: ProseMirrorNode[] = []
  for (let index = range.first; index <= range.last; index++) copies.push(range.parent.child(index))
  editor.view.dispatch(editor.state.tr.insert(range.end, Fragment.from(copies)).scrollIntoView())
  return true
}

export function blockMarkdown(editor: Editor, pos: number): string {
  const node = editor.state.doc.nodeAt(pos)
  return node ? fragmentToMarkdown(editor, Fragment.from(node)) : ''
}

const BLOCK_LABELS: Record<string, string> = {
  paragraph: 'Text',
  listItem: 'List item',
  taskItem: 'Task',
  blockquote: 'Quote',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
  taskList: 'Task list',
  codeBlock: 'Code block',
  table: 'Table',
  image: 'Image',
  horizontalRule: 'Divider'
}

const DIAGRAM_LABELS: Record<string, string> = { chart: 'Chart', mermaid: 'Diagram' }

export function blockLabel(node: { type?: string, attrs?: Record<string, unknown> } | null | undefined): string {
  if (!node?.type) return 'Block'
  if (node.type === 'heading') return `Heading ${node.attrs?.level ?? ''}`.trim()
  if (node.type === 'codeBlock') return DIAGRAM_LABELS[String(node.attrs?.language)] ?? 'Code block'
  return BLOCK_LABELS[node.type] ?? 'Block'
}

// Blocks made of text, which can be turned into one another.
export const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList'])

export interface BlockShortcutsOptions {
  onLink: () => boolean
}

export const BlockShortcuts = Extension.create<BlockShortcutsOptions>({
  name: 'blockShortcuts',

  addOptions() {
    return { onLink: () => false }
  },

  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => moveBlocks(this.editor, 'up'),
      'Alt-ArrowDown': () => moveBlocks(this.editor, 'down'),
      'Mod-Shift-d': () => duplicateBlocks(this.editor),
      // Plain ⌘K belongs to the app's search, which takes it in the capture
      // phase on purpose; the link shortcut is the shifted one.
      'Mod-Shift-k': () => this.options.onLink()
    }
  }
})
