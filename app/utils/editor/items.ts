// The editor's commands, described once. The fixed toolbar, the selection
// bubble, the slash menu and the block handle each show a different cut of the
// same lists, so a command looks and reads the same wherever it turns up.
//
// An item with a `kind` is run by the handler of that name: Nuxt UI's built-in
// ones, or the custom handlers `RichEditor` registers.

import type { EditorToolbarProps } from '@nuxt/ui'

// Modifier glyphs for shortcut hints, matched to the platform.
const isMac = import.meta.client && /Mac|iP(hone|ad|od)/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'
export const ALT = isMac ? '⌥' : 'Alt'
export const SHIFT = isMac ? '⇧' : 'Shift'

// The editor as Nuxt UI's components type it. `@nuxt/ui` resolves its own copy
// of `@tiptap/vue-3`, so this is the one `Editor` type its props accept; it is
// still a `@tiptap/core` editor for everything else.
export type UiEditor = NonNullable<EditorToolbarProps['editor']>

// Loose on purpose: an item is handed to Nuxt UI's toolbar, dropdown and
// suggestion menus, each of which types its own superset of these fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EditorItem = Record<string, any>

// Toolbar buttons show the label as a tooltip, with the shortcut beside it.
export function asButton({ label, kbds, description: _description, ...item }: EditorItem): EditorItem {
  return { ...item, 'aria-label': label, 'tooltip': { text: label, kbds } }
}

export const HISTORY_ITEMS: EditorItem[] = [
  { kind: 'undo', label: 'Undo', icon: 'i-lucide-undo-2', kbds: [MOD, 'Z'] },
  { kind: 'redo', label: 'Redo', icon: 'i-lucide-redo-2', kbds: [MOD, SHIFT, 'Z'] }
]

export const MARK_ITEMS: EditorItem[] = [
  { kind: 'mark', mark: 'bold', label: 'Bold', icon: 'i-lucide-bold', kbds: [MOD, 'B'] },
  { kind: 'mark', mark: 'italic', label: 'Italic', icon: 'i-lucide-italic', kbds: [MOD, 'I'] },
  { kind: 'mark', mark: 'underline', label: 'Underline', icon: 'i-lucide-underline', kbds: [MOD, 'U'] },
  { kind: 'mark', mark: 'strike', label: 'Strikethrough', icon: 'i-lucide-strikethrough', kbds: [MOD, SHIFT, 'S'] },
  { kind: 'mark', mark: 'code', label: 'Inline code', icon: 'i-lucide-code', kbds: [MOD, 'E'] }
]

export const TEXT_STYLE_ITEMS: EditorItem[] = [
  { kind: 'paragraph', label: 'Text', icon: 'i-lucide-type' },
  { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
  { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
  { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' }
]

export const LIST_ITEMS: EditorItem[] = [
  { kind: 'bulletList', label: 'Bullet list', icon: 'i-lucide-list', kbds: [MOD, SHIFT, '8'] },
  { kind: 'orderedList', label: 'Numbered list', icon: 'i-lucide-list-ordered', kbds: [MOD, SHIFT, '7'] },
  { kind: 'taskList', label: 'Task list', icon: 'i-lucide-list-checks', kbds: [MOD, SHIFT, '9'] }
]

export const QUOTE_ITEM: EditorItem = { kind: 'blockquote', label: 'Quote', icon: 'i-lucide-text-quote' }
export const CODE_BLOCK_ITEM: EditorItem = { kind: 'codeBlock', label: 'Code block', icon: 'i-lucide-square-code' }
export const DIVIDER_ITEM: EditorItem = { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-separator-horizontal' }

export const DIAGRAM_ITEMS: EditorItem[] = [
  { kind: 'chart', label: 'Chart', description: 'Bar, line or pie from a few lines of numbers', icon: 'i-lucide-chart-column' },
  { kind: 'mermaid', label: 'Mermaid diagram', description: 'Flowcharts, sequences, Gantt and more', icon: 'i-lucide-workflow' }
]

// Everything a block of text can be turned into.
export const TURN_INTO_ITEMS: EditorItem[] = [...TEXT_STYLE_ITEMS, ...LIST_ITEMS, QUOTE_ITEM, CODE_BLOCK_ITEM]
