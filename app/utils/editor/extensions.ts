import type { AnyExtension } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import CodeBlockView from '~/components/CodeBlockView.vue'
import { createEditorLowlight } from '~/utils/highlight'
import { DateMention } from '~/composables/useDateMention'
import { ResizableImage } from '~/utils/resizable-image'

// Highlights are stored by name, not by value: `<mark data-color="blue">`. The
// stylesheet owns what "blue" looks like, so a highlight reads well in both
// themes instead of carrying the light-mode colour it was made with.
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'orange', label: 'Orange' }
] as const

export type HighlightColor = typeof HIGHLIGHT_COLORS[number]['id']

const HIGHLIGHT_IDS = new Set<string>(HIGHLIGHT_COLORS.map(color => color.id))

const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        // A plain `<mark>` (older notes, pasted content) is the default yellow.
        parseHTML: (element) => {
          const color = element.getAttribute('data-color')
          return color && HIGHLIGHT_IDS.has(color) && color !== 'yellow' ? color : null
        },
        renderHTML: attributes => attributes.color ? { 'data-color': attributes.color } : {}
      }
    }
  }
})

// The schema every rich text surface shares, on top of the starter kit that
// `UEditor` brings: the editor itself and the read-only renderer must agree on
// it, or a note would render differently from how it was written.
export function createContentExtensions(options: { editable: boolean }): AnyExtension[] {
  return [
    CodeBlockLowlight.configure({ lowlight: createEditorLowlight() }).extend({
      addNodeView: () => VueNodeViewRenderer(CodeBlockView)
    }),
    ColorHighlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    options.editable
      ? Table.configure({ resizable: true, cellMinWidth: 64, handleWidth: 6, lastColumnResizable: true })
      : Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    DateMention,
    ResizableImage
  ]
}
