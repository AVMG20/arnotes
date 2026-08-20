<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { VueNodeViewRenderer, type Editor } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection, type EditorState } from '@tiptap/pm/state'
import { DOMSerializer } from '@tiptap/pm/model'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { closeHistory } from '@tiptap/pm/history'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CodeBlockView from '~/components/CodeBlockView.vue'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { CellSelection } from '@tiptap/pm/tables'
import { createLowlight, common } from 'lowlight'
import { DateMention } from '~/composables/useDateMention'
import { ResizableImage } from '~/utils/resizable-image'
import { markdownToHtml, htmlToMarkdown, normalizeAiOutput } from '~/utils/markdown'
import { runAi, runCustomAi, transformActions } from '~/composables/useAi'
import { useUserSettings } from '~/composables/useUserSettings'
import TableGridPicker from '~/components/TableGridPicker.vue'

// Shared rich text editor: the exact editing surface used by notes, reusable
// for task descriptions. Parents own persistence via v-model; this component
// only edits. `uploadImage` opts into image support (notes have an attachment
// endpoint, tasks do not). The #toolbar-right slot hosts context actions.
const props = defineProps<{
  modelValue: string
  placeholder?: string
  uploadImage?: (file: File) => Promise<string | null>
}>()

const emit = defineEmits<{ 'update:modelValue': [html: string] }>()

const toast = useToast()
const { openrouterApiKey } = useUserSettings()

const editorRef = ref()
const editor = computed(() => editorRef.value?.editor as Editor | undefined)

const content = computed({
  get: () => props.modelValue,
  set: (html: string) => emit('update:modelValue', html)
})

// ─── AI helpers ───────────────────────────────────────────────

const aiLoading = ref(false)
const aiPromptOpen = ref(false)
const aiPrompt = ref('')
const aiPromptPosition = ref<number | null>(null)
const aiPromptIncludeContext = ref(true)

// ─── Table creation picker ───────────────────────────────────

const tablePickerOpen = ref(false)
const tablePicker = reactive({ open: false, x: 0, y: 0 })
let tablePickerEditor: Editor | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function insertTableOfSize(ed: any, size: { rows: number, cols: number }) {
  ed.chain().focus().insertTable({ rows: size.rows, cols: size.cols, withHeaderRow: true }).run()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onToolbarTablePick(ed: any, size: { rows: number, cols: number }) {
  tablePickerOpen.value = false
  insertTableOfSize(ed, size)
}

function onSlashTablePick(size: { rows: number, cols: number }) {
  const ed = tablePickerEditor
  tablePickerEditor = null
  tablePicker.open = false
  if (ed && !ed.isDestroyed) insertTableOfSize(ed, size)
}

function closeSlashTablePicker() {
  tablePickerEditor = null
  tablePicker.open = false
}

function onTablePickerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeSlashTablePicker()
}

watch(() => tablePicker.open, (open) => {
  if (open) window.addEventListener('keydown', onTablePickerKeydown, true)
  else window.removeEventListener('keydown', onTablePickerKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onTablePickerKeydown, true)
})

type AiPending = {
  kind: 'generate' | 'transform'
  from: number
  to: number
}

const aiPendingKey = new PluginKey<AiPending | null>('aiPending')

const AiPendingDecoration = Extension.create({
  name: 'aiPendingDecoration',
  addProseMirrorPlugins() {
    return [
      new Plugin<AiPending | null>({
        key: aiPendingKey,
        state: {
          init: () => null,
          apply(transaction, pending) {
            const meta = transaction.getMeta(aiPendingKey) as { pending?: AiPending, clear?: boolean } | undefined
            if (meta?.clear) return null
            if (meta?.pending) return meta.pending
            if (!pending || !transaction.docChanged) return pending

            return {
              ...pending,
              from: transaction.mapping.map(pending.from, 1),
              to: transaction.mapping.map(pending.to, pending.kind === 'transform' ? -1 : 1)
            }
          }
        },
        props: {
          decorations(state) {
            const pending = aiPendingKey.getState(state)
            if (!pending) return null

            if (pending.kind === 'transform' && pending.from < pending.to) {
              return DecorationSet.create(state.doc, [
                Decoration.inline(pending.from, pending.to, { class: 'ai-processing-selection' })
              ])
            }

            const widget = Decoration.widget(pending.from, () => {
              const indicator = document.createElement('span')
              indicator.className = 'ai-writing-indicator'
              indicator.contentEditable = 'false'
              indicator.setAttribute('aria-label', 'AI is writing')

              const label = document.createElement('span')
              label.textContent = 'AI is writing'
              indicator.append(label)
              for (let index = 0; index < 3; index++) {
                const dot = document.createElement('i')
                dot.style.setProperty('--ai-dot-index', String(index))
                indicator.append(dot)
              }
              return indicator
            }, { key: 'ai-writing-indicator', side: 1 })
            return DecorationSet.create(state.doc, [widget])
          }
        }
      })
    ]
  }
})

function setAiPending(ed: Editor, pending: AiPending | null) {
  ed.view.dispatch(ed.state.tr.setMeta(aiPendingKey, pending ? { pending } : { clear: true }))
}

function getSelectionHtml(ed: Editor): string {
  const { from, to } = ed.state.selection
  if (from === to) return ''
  const slice = ed.state.doc.slice(from, to)
  const serializer = DOMSerializer.fromSchema(ed.state.schema)
  const fragment = serializer.serializeFragment(slice.content)
  const div = document.createElement('div')
  div.appendChild(fragment)
  return div.innerHTML
}

async function streamAiIntoEditor(
  ed: Editor,
  pending: AiPending,
  request: (onChunk: (result: string) => void) => Promise<string>,
  rollbackHtml = ''
) {
  const range = { from: pending.from, to: pending.to }
  let rendered = ''

  ed.view.dispatch(closeHistory(ed.state.tr))

  const replaceRange = (output: string, addToHistory: boolean) => {
    if (!output || output === rendered) return

    const previousSize = ed.state.doc.content.size
    ed.chain()
      .setMeta('addToHistory', addToHistory)
      .insertContentAt(range, markdownToHtml(output))
      .run()
    range.to += ed.state.doc.content.size - previousSize
    rendered = output
    setAiPending(ed, pending.kind === 'generate'
      ? { kind: 'generate', from: range.to, to: range.to }
      : { kind: 'transform', ...range })
  }

  const renderChunk = (markdown: string) => {
    try {
      replaceRange(markdown, false)
    } catch {
      // Partial markdown such as "- " can briefly produce an invalid empty node.
    }
  }

  const restoreOriginal = () => {
    const previousSize = ed.state.doc.content.size
    const chain = ed.chain().setMeta('addToHistory', false)
    if (rollbackHtml) chain.insertContentAt(range, rollbackHtml)
    else if (range.from < range.to) chain.deleteRange(range)
    chain.run()
    range.to += ed.state.doc.content.size - previousSize
    rendered = ''
  }

  try {
    const result = await request(renderChunk)
    restoreOriginal()
    ed.view.dispatch(closeHistory(ed.state.tr))
    replaceRange(normalizeAiOutput(result), true)
    ed.commands.focus(range.to)
  } catch (error) {
    restoreOriginal()
    throw error
  }
}

async function runTransform(action: string) {
  const ed = editor.value
  if (!ed || aiLoading.value) return
  if (!openrouterApiKey.value) {
    toast.add({
      title: 'No OpenRouter API key',
      description: 'Add your key in Settings → AI to use AI features.',
      icon: 'i-lucide-key-round',
      color: 'error',
      duration: 4000
    })
    return
  }
  const { from, to } = ed.state.selection
  if (from === to) return
  const selectionHtml = getSelectionHtml(ed)
  if (!selectionHtml.trim()) return
  const text = htmlToMarkdown(selectionHtml)

  aiLoading.value = true
  const pending: AiPending = { kind: 'transform', from, to }
  setAiPending(ed, pending)
  try {
    await streamAiIntoEditor(ed, pending, onChunk => runAi(action, text, '', onChunk), selectionHtml)
  } catch (e) {
    const err = e as { data?: { message?: string }, message?: string }
    toast.add({
      title: 'AI request failed',
      description: err?.data?.message ?? err?.message ?? 'Unknown error',
      icon: 'i-lucide-alert-triangle',
      color: 'error',
      duration: 5000
    })
  } finally {
    setAiPending(ed, null)
    aiLoading.value = false
  }
}

function openAiPrompt(ed: Editor) {
  aiPromptPosition.value = ed.state.selection.from
  aiPromptOpen.value = true
}

async function runCustomPrompt() {
  const ed = editor.value
  const instruction = aiPrompt.value.trim()
  if (!ed || !instruction || aiLoading.value) return
  if (!openrouterApiKey.value) {
    toast.add({
      title: 'No OpenRouter API key',
      description: 'Add your key in Settings → AI to use AI features.',
      icon: 'i-lucide-key-round',
      color: 'error',
      duration: 4000
    })
    return
  }

  const position = aiPromptPosition.value ?? ed.state.selection.from
  const context = aiPromptIncludeContext.value ? htmlToMarkdown(ed.getHTML()).trim() : ''
  aiPromptOpen.value = false
  aiLoading.value = true
  const pending: AiPending = { kind: 'generate', from: position, to: position }
  setAiPending(ed, pending)
  try {
    await streamAiIntoEditor(ed, pending, onChunk => runCustomAi(instruction, context, onChunk))
    aiPrompt.value = ''
    aiPromptPosition.value = null
  } catch (e) {
    const err = e as { data?: { message?: string }, message?: string }
    toast.add({
      title: 'AI request failed',
      description: err?.data?.message ?? err?.message ?? 'Unknown error',
      icon: 'i-lucide-alert-triangle',
      color: 'error',
      duration: 5000
    })
  } finally {
    setAiPending(ed, null)
    aiLoading.value = false
  }
}

function focusEditor() {
  editor.value?.commands.focus('start')
}

defineExpose({ focusEditor })

// ─── Custom extensions ───────────────────────────────────────

const lowlight = createLowlight(common)

const ImagePaste = Extension.create({
  name: 'imagePaste',
  addProseMirrorPlugins() {
    const ed = this.editor
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste(_view, event) {
            if (!props.uploadImage) return false
            const items = Array.from(event.clipboardData?.items ?? [])
            const imageItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'))
            if (!imageItem) return false
            const file = imageItem.getAsFile()
            if (!file) return false
            event.preventDefault()
            props.uploadImage(file).then((url) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (url) (ed.chain().focus() as any).setImage({ src: url }).run()
            })
            return true
          }
        }
      })
    ]
  }
})

// File drops are handled on the wrapper div to avoid the drag handle intercepting them.
async function onFileDrop(event: DragEvent) {
  if (!props.uploadImage) return
  const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
  if (!files.length) return
  editor.value?.commands.focus()
  const urls = await Promise.all(files.map(f => props.uploadImage!(f)))
  urls.forEach((url) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (url) (editor.value?.chain().focus() as any)?.setImage({ src: url }).run()
  })
}

const HashtagHighlight = Extension.create({
  name: 'hashtagHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hashtagHighlight'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const re = /#[a-zA-Z][a-zA-Z0-9_]*/g
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              re.lastIndex = 0
              let m
              while ((m = re.exec(node.text)) !== null) {
                decorations.push(
                  Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                    class: 'hashtag-highlight'
                  })
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})

const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const ed = this.editor
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste(_view, event) {
            const text = event.clipboardData?.getData('text/plain') ?? ''
            if (!text.trim()) return false

            const html = markdownToHtml(text)
            // Clipboard sources often provide Markdown tables as an HTML code block.
            // Prefer the plain-text table when Marked recognizes one.
            if (/<table(?:\s|>)/.test(html)) {
              event.preventDefault()
              ed.commands.insertContent(html)
              return true
            }

            if (event.clipboardData?.getData('text/html')) return false
            ed.commands.insertContent(html)
            return true
          }
        }
      })
    ]
  }
})

// Hover-revealed "+" buttons to append a row/column at the end of the table.
// Destructive row/column operations live in the table bubble toolbar instead,
// where they act on the cell the cursor is in.
const InlineTableControls = Extension.create({
  name: 'inlineTableControls',
  addProseMirrorPlugins() {
    const ed = this.editor

    function getTableContext() {
      const { $from } = ed.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === 'table') {
          return { node: $from.node(depth), pos: $from.before(depth), start: $from.start(depth) }
        }
      }
      return null
    }

    function appendToTable(axis: 'row' | 'column') {
      const table = getTableContext()
      const lastRow = table?.node.lastChild
      const lastCell = lastRow?.lastChild
      if (!table || !lastRow || !lastCell) return

      const rowPos = table.start + table.node.content.size - lastRow.nodeSize
      const cellPos = rowPos + 1 + lastRow.content.size - lastCell.nodeSize
      const selection = Selection.near(ed.state.doc.resolve(cellPos + 1))
      ed.view.dispatch(ed.state.tr.setSelection(selection))

      if (axis === 'row') ed.chain().focus().addRowAfter().run()
      else ed.chain().focus().addColumnAfter().run()
    }

    return [
      new Plugin({
        key: new PluginKey('inlineTableControls'),
        view(view) {
          const controls = document.createElement('div')
          controls.className = 'table-edge-controls'
          controls.contentEditable = 'false'

          const makeButton = (axis: 'row' | 'column') => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'table-edge-controls__button'
            button.dataset.axis = axis
            button.textContent = '+'
            button.title = axis === 'row' ? 'Add row at the end' : 'Add column at the end'
            button.setAttribute('aria-label', button.title)
            button.addEventListener('pointerdown', (event) => {
              event.preventDefault()
              event.stopPropagation()
              appendToTable(axis)
            })
            return button
          }

          controls.append(makeButton('row'), makeButton('column'))

          let wrapper: HTMLElement | null = null
          const update = () => {
            const table = getTableContext()
            const tableDom = table ? view.nodeDOM(table.pos) as HTMLElement | null : null
            const nextWrapper = tableDom?.matches('.tableWrapper')
              ? tableDom
              : tableDom?.closest<HTMLElement>('.tableWrapper')

            if (nextWrapper === wrapper) return
            wrapper?.classList.remove('table-controls-active')
            controls.remove()
            wrapper = nextWrapper ?? null
            if (wrapper) {
              wrapper.classList.add('table-controls-active')
              wrapper.append(controls)
            }
          }

          update()
          return {
            update,
            destroy() {
              wrapper?.classList.remove('table-controls-active')
              controls.remove()
            }
          }
        }
      })
    ]
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extensions: any[] = [
  CodeBlockLowlight.configure({ lowlight }).extend({
    addNodeView: () => VueNodeViewRenderer(CodeBlockView)
  }),
  Highlight.configure({ multicolor: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  DateMention,
  ResizableImage,
  ImagePaste,
  AiPendingDecoration,
  HashtagHighlight,
  MarkdownPaste,
  InlineTableControls
]

// ─── Handlers ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customHandlers: any = {
  aiPrompt: {
    canExecute: () => !aiLoading.value,
    execute: (ed: Editor) => {
      openAiPrompt(ed)
      return ed.chain()
    },
    isActive: () => false
  },
  image: {
    canExecute: () => !!props.uploadImage,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (ed: any) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !props.uploadImage) return
        const url = await props.uploadImage(file)
        if (url) ed.chain().focus().setImage({ src: url }).run()
      }
      input.click()
    },
    isActive: () => false
  },
  table: {
    canExecute: () => true,
    execute: (ed: Editor) => {
      const { state, view } = ed
      try {
        const coords = view.coordsAtPos(state.selection.from)
        tablePicker.x = Math.min(coords.left, Math.max(window.innerWidth - 260, 8))
        tablePicker.y = Math.min(coords.bottom + 8, window.innerHeight - 220)
      } catch {
        tablePicker.x = window.innerWidth / 2 - 110
        tablePicker.y = window.innerHeight / 2 - 100
      }
      tablePickerEditor = ed
      tablePicker.open = true
      return ed.chain()
    },
    isActive: () => false
  },
  addColumnBefore: {
    canExecute: (ed: Editor) => ed.can().addColumnBefore(),
    execute: (ed: Editor) => ed.chain().focus().addColumnBefore(),
    isActive: () => false
  },
  addColumnAfter: {
    canExecute: (ed: Editor) => ed.can().addColumnAfter(),
    execute: (ed: Editor) => ed.chain().focus().addColumnAfter(),
    isActive: () => false
  },
  deleteColumn: {
    canExecute: (ed: Editor) => ed.can().deleteColumn(),
    execute: (ed: Editor) => ed.chain().focus().deleteColumn(),
    isActive: () => false
  },
  addRowBefore: {
    canExecute: (ed: Editor) => ed.can().addRowBefore(),
    execute: (ed: Editor) => ed.chain().focus().addRowBefore(),
    isActive: () => false
  },
  addRowAfter: {
    canExecute: (ed: Editor) => ed.can().addRowAfter(),
    execute: (ed: Editor) => ed.chain().focus().addRowAfter(),
    isActive: () => false
  },
  deleteRow: {
    canExecute: (ed: Editor) => ed.can().deleteRow(),
    execute: (ed: Editor) => ed.chain().focus().deleteRow(),
    isActive: () => false
  },
  deleteTable: {
    canExecute: (ed: Editor) => ed.can().deleteTable(),
    execute: (ed: Editor) => ed.chain().focus().deleteTable(),
    isActive: () => false
  },
  mergeCells: {
    canExecute: (ed: Editor) => ed.can().mergeCells(),
    execute: (ed: Editor) => ed.chain().focus().mergeCells(),
    isActive: () => false
  },
  splitCell: {
    canExecute: (ed: Editor) => ed.can().splitCell(),
    execute: (ed: Editor) => ed.chain().focus().splitCell(),
    isActive: () => false
  },
  toggleHeaderRow: {
    canExecute: (ed: Editor) => ed.can().toggleHeaderRow(),
    execute: (ed: Editor) => ed.chain().focus().toggleHeaderRow(),
    isActive: () => false
  },
  toggleHeaderColumn: {
    canExecute: (ed: Editor) => ed.can().toggleHeaderColumn(),
    execute: (ed: Editor) => ed.chain().focus().toggleHeaderColumn(),
    isActive: () => false
  }
}

// ─── Toolbar & menu items ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixedToolbarItems: any[][] = [[
  { kind: 'heading', level: 1, icon: 'i-lucide-heading-1', tooltip: { text: 'Heading 1' } },
  { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', tooltip: { text: 'Heading 2' } },
  { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', tooltip: { text: 'Heading 3' } }
], [
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } },
  { kind: 'mark', mark: 'highlight', icon: 'i-lucide-highlighter', tooltip: { text: 'Highlight' } },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } }
], [
  { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' } },
  { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Ordered list' } },
  { kind: 'taskList', icon: 'i-lucide-list-checks', tooltip: { text: 'Task list' } },
  { kind: 'table', slot: 'table', icon: 'i-lucide-table', tooltip: { text: 'Insert table' } },
  { kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code block' } },
  { kind: 'blockquote', icon: 'i-lucide-quote', tooltip: { text: 'Blockquote' } }
]]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const aiBubbleItems: any[] = transformActions.map(action => ({
  label: action.label,
  icon: action.icon,
  onSelect: () => runTransform(action.id)
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bubbleToolbarItems: any[][] = [[
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } },
  { kind: 'mark', mark: 'highlight', icon: 'i-lucide-highlighter', tooltip: { text: 'Highlight' } },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } },
  {
    icon: 'i-lucide-sparkles',
    tooltip: { text: 'AI' },
    color: 'primary',
    items: aiBubbleItems
  }
]]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tableToolbarItems: any[][] = [[
  {
    label: 'Row',
    icon: 'i-lucide-rows-3',
    items: [[
      { kind: 'addRowBefore', label: 'Add row above', icon: 'i-lucide-arrow-up-to-line' },
      { kind: 'addRowAfter', label: 'Add row below', icon: 'i-lucide-arrow-down-to-line' }
    ], [
      { kind: 'deleteRow', label: 'Delete row', icon: 'i-lucide-trash-2', color: 'error' }
    ]]
  },
  {
    label: 'Column',
    icon: 'i-lucide-columns-3',
    items: [[
      { kind: 'addColumnBefore', label: 'Add column left', icon: 'i-lucide-arrow-left-to-line' },
      { kind: 'addColumnAfter', label: 'Add column right', icon: 'i-lucide-arrow-right-to-line' }
    ], [
      { kind: 'deleteColumn', label: 'Delete column', icon: 'i-lucide-trash-2', color: 'error' }
    ]]
  },
  {
    label: 'Options',
    icon: 'i-lucide-table-properties',
    items: [[
      { kind: 'mergeCells', label: 'Merge selected cells', icon: 'i-lucide-table-cells-merge' },
      { kind: 'splitCell', label: 'Split cell', icon: 'i-lucide-table-cells-split' },
      { kind: 'toggleHeaderRow', label: 'Toggle header row', icon: 'i-lucide-rows-3' },
      { kind: 'toggleHeaderColumn', label: 'Toggle header column', icon: 'i-lucide-columns-3' }
    ], [
      { kind: 'deleteTable', label: 'Delete table', icon: 'i-lucide-trash-2', color: 'error' }
    ]]
  }
]]

function shouldShowTableToolbar(ed: Pick<Editor, 'isActive'>, view: EditorView, state: EditorState) {
  // Also show while multiple cells are selected, otherwise merge/split are unreachable.
  const cellSelection = state.selection instanceof CellSelection
  if (!cellSelection && !state.selection.empty) return false

  if (!cellSelection) {
    const domSelection = view.dom.ownerDocument.getSelection()
    const hasDomTextSelection = Boolean(
      domSelection
      && !domSelection.isCollapsed
      && domSelection.anchorNode
      && domSelection.focusNode
      && view.dom.contains(domSelection.anchorNode)
      && view.dom.contains(domSelection.focusNode)
    )
    if (hasDomTextSelection) return false
  }

  return view.hasFocus() && ed.isActive('table')
}

const suggestionItems = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups: any[][] = [[
    { kind: 'aiPrompt', label: 'Ask AI', description: 'Generate anything from a custom prompt', icon: 'i-lucide-sparkles' }
  ], [
    { type: 'label', label: 'Style' },
    { kind: 'paragraph', label: 'Paragraph', icon: 'i-lucide-type' },
    { kind: 'heading', level: 1, label: 'Heading 1', icon: 'i-lucide-heading-1' },
    { kind: 'heading', level: 2, label: 'Heading 2', icon: 'i-lucide-heading-2' },
    { kind: 'heading', level: 3, label: 'Heading 3', icon: 'i-lucide-heading-3' },
    { kind: 'bulletList', label: 'Bullet list', icon: 'i-lucide-list' },
    { kind: 'orderedList', label: 'Numbered list', icon: 'i-lucide-list-ordered' },
    { kind: 'taskList', label: 'Task list', icon: 'i-lucide-list-checks' },
    { kind: 'blockquote', label: 'Blockquote', icon: 'i-lucide-text-quote' },
    { kind: 'codeBlock', label: 'Code block', icon: 'i-lucide-square-code' },
    { kind: 'table', label: 'Table', description: 'Pick a size and insert a table', icon: 'i-lucide-table' },
    { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-separator-horizontal' }
  ]]
  if (props.uploadImage) {
    groups.push([
      { type: 'label', label: 'Insert' },
      { kind: 'image', label: 'Image', icon: 'i-lucide-image' }
    ])
  }
  return groups
})
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col"
    @dragover.prevent
    @drop.prevent="onFileDrop"
  >
    <UEditor
      ref="editorRef"
      v-slot="{ editor: ed }"
      :model-value="content"
      content-type="html"
      :placeholder="placeholder ?? 'Start writing… (@ for dates, # for tags)'"
      :starter-kit="{ codeBlock: false }"
      :image="false"
      :extensions="extensions"
      :handlers="customHandlers"
      class="flex min-h-0 flex-1 flex-col overflow-y-auto"
      @update:model-value="content = $event"
    >
      <!-- Fixed toolbar -->
      <div class="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-default bg-default px-3 py-2.5">
        <UEditorToolbar
          :editor="ed"
          :items="fixedToolbarItems"
        >
          <template #table>
            <UPopover
              v-model:open="tablePickerOpen"
              :content="{ align: 'start', sideOffset: 8 }"
            >
              <UTooltip text="Insert table">
                <UButton
                  icon="i-lucide-table"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  aria-label="Insert table"
                />
              </UTooltip>

              <template #content>
                <TableGridPicker @select="size => onToolbarTablePick(ed, size)" />
              </template>
            </UPopover>
          </template>
        </UEditorToolbar>

        <div
          v-if="$slots['toolbar-right']"
          class="ml-auto flex shrink-0 items-center gap-1"
        >
          <slot name="toolbar-right" />
        </div>
      </div>

      <!-- Slash commands (type /) -->
      <UEditorSuggestionMenu
        :editor="ed"
        :items="suggestionItems"
      />

      <!-- Bubble toolbar (appears on text selection) -->
      <UEditorToolbar
        :editor="ed"
        :items="bubbleToolbarItems"
        layout="bubble"
        :ui="{ root: 'z-50' }"
        :should-show="({ editor: e, view, state }) => {
          const { selection } = state
          return view.hasFocus() && !selection.empty && !(selection instanceof CellSelection) && !e.isActive('image')
        }"
      />

      <!-- Table controls (appears when the cursor is in a table) -->
      <UEditorToolbar
        :editor="ed"
        :items="tableToolbarItems"
        layout="bubble"
        plugin-key="table-toolbar"
        :should-show="({ editor: e, view, state }) => shouldShowTableToolbar(e, view, state)"
      />

      <!-- Drag handle (hover any block) -->
      <UEditorDragHandle
        v-slot="{ ui }"
        :editor="ed"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-grip-vertical"
          :class="ui.handle()"
        />
      </UEditorDragHandle>
    </UEditor>

    <UModal
      v-model:open="aiPromptOpen"
      title="Ask AI"
      description="Describe what you want to add at the current cursor position. You can optionally include the current content as context."
      :ui="{ footer: 'justify-between' }"
    >
      <template #body>
        <form
          id="ai-prompt-form"
          class="space-y-3"
          @submit.prevent="runCustomPrompt"
        >
          <UTextarea
            v-model="aiPrompt"
            autofocus
            autoresize
            :rows="4"
            :maxrows="10"
            placeholder="For example: Create a Drizzle schema for roles and permissions with a short usage example"
            class="w-full"
            @keydown.meta.enter.prevent="runCustomPrompt"
            @keydown.ctrl.enter.prevent="runCustomPrompt"
          />
          <div class="flex items-center justify-between gap-4">
            <UCheckbox
              v-model="aiPromptIncludeContext"
              label="Include current content as context"
            />
            <p class="text-xs text-muted text-right">
              Markdown, tables, task lists, and code blocks are supported.
            </p>
          </div>
        </form>
      </template>

      <template #footer="{ close }">
        <span class="text-xs text-muted">Cmd/Ctrl + Enter to generate</span>
        <div class="flex items-center gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="close"
          />
          <UButton
            type="submit"
            form="ai-prompt-form"
            label="Generate"
            icon="i-lucide-sparkles"
            :disabled="!aiPrompt.trim()"
          />
        </div>
      </template>
    </UModal>

    <!-- Table size picker (opened from the slash menu) -->
    <Teleport to="body">
      <div v-if="tablePicker.open">
        <div
          class="fixed inset-0 z-50"
          data-editor-overlay
          @click="closeSlashTablePicker"
          @contextmenu.prevent="closeSlashTablePicker"
        />
        <div
          class="fixed z-[60] rounded-lg border border-default bg-default shadow-lg"
          data-editor-overlay
          :style="{ left: `${tablePicker.x}px`, top: `${tablePicker.y}px` }"
        >
          <TableGridPicker @select="onSlashTablePick" />
        </div>
      </div>
    </Teleport>
  </div>
</template>
