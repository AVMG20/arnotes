<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { differenceInCalendarDays } from 'date-fns'
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
import { createLowlight, common } from 'lowlight'
import { DateMention } from '~/composables/useDateMention'
import { ResizableImage } from '~/utils/resizable-image'

const { activeNote, activeNoteId, autoFocus, updateNote, updateSharing } = useNotes()
const toast = useToast()
const { openrouterApiKey } = useUserSettings()

// ─── AI helpers ───────────────────────────────────────────────
const aiLoading = ref(false)
const aiPromptOpen = ref(false)
const aiPrompt = ref('')
const aiPromptPosition = ref<number | null>(null)
const aiPromptIncludeContext = ref(true)

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

function setAiPending(editor: Editor, pending: AiPending | null) {
  editor.view.dispatch(editor.state.tr.setMeta(aiPendingKey, pending ? { pending } : { clear: true }))
}

function getSelectionHtml(editor: Editor): string {
  const { from, to } = editor.state.selection
  if (from === to) return ''
  const slice = editor.state.doc.slice(from, to)
  const serializer = DOMSerializer.fromSchema(editor.state.schema)
  const fragment = serializer.serializeFragment(slice.content)
  const div = document.createElement('div')
  div.appendChild(fragment)
  return div.innerHTML
}

async function streamAiIntoEditor(
  editor: Editor,
  pending: AiPending,
  request: (onChunk: (result: string) => void) => Promise<string>,
  rollbackHtml = ''
) {
  const range = { from: pending.from, to: pending.to }
  let rendered = ''

  editor.view.dispatch(closeHistory(editor.state.tr))

  const replaceRange = (output: string, addToHistory: boolean) => {
    if (!output || output === rendered) return

    const previousSize = editor.state.doc.content.size
    editor.chain()
      .setMeta('addToHistory', addToHistory)
      .insertContentAt(range, markdownToHtml(output))
      .run()
    range.to += editor.state.doc.content.size - previousSize
    rendered = output
    setAiPending(editor, pending.kind === 'generate'
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
    const previousSize = editor.state.doc.content.size
    const chain = editor.chain().setMeta('addToHistory', false)
    if (rollbackHtml) chain.insertContentAt(range, rollbackHtml)
    else if (range.from < range.to) chain.deleteRange(range)
    chain.run()
    range.to += editor.state.doc.content.size - previousSize
    rendered = ''
  }

  try {
    const result = await request(renderChunk)
    restoreOriginal()
    editor.view.dispatch(closeHistory(editor.state.tr))
    replaceRange(normalizeAiOutput(result), true)
    editor.commands.focus(range.to)
  } catch (error) {
    restoreOriginal()
    throw error
  }
}

async function runTransform(action: string) {
  const editor = editorRef.value?.editor
  if (!editor || aiLoading.value) return
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
  const { from, to } = editor.state.selection
  if (from === to) return
  const selectionHtml = getSelectionHtml(editor)
  if (!selectionHtml.trim()) return
  const text = htmlToMarkdown(selectionHtml)

  aiLoading.value = true
  const pending: AiPending = { kind: 'transform', from, to }
  setAiPending(editor, pending)
  try {
    await streamAiIntoEditor(editor, pending, onChunk => runAi(action, text, '', onChunk), selectionHtml)
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
    setAiPending(editor, null)
    aiLoading.value = false
  }
}

function openAiPrompt(editor: Editor) {
  aiPromptPosition.value = editor.state.selection.from
  aiPromptOpen.value = true
}

async function runCustomPrompt() {
  const editor = editorRef.value?.editor as Editor | undefined
  const instruction = aiPrompt.value.trim()
  if (!editor || !instruction || aiLoading.value) return
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

  const position = aiPromptPosition.value ?? editor.state.selection.from
  const context = aiPromptIncludeContext.value ? htmlToMarkdown(editor.getHTML()).trim() : ''
  aiPromptOpen.value = false
  aiLoading.value = true
  const pending: AiPending = { kind: 'generate', from: position, to: position }
  setAiPending(editor, pending)
  try {
    await streamAiIntoEditor(editor, pending, onChunk => runCustomAi(instruction, context, onChunk))
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
    setAiPending(editor, null)
    aiLoading.value = false
  }
}

const shareOpen = ref(false)
const shareEndDate = ref('')
const sharing = ref(false)

watch(shareOpen, (open) => {
  if (open) shareEndDate.value = formatShareEndDate(activeNote.value?.publicUntil ?? null)
})

function formatShareEndDate(timestamp: number | null) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function getShareExpiry() {
  if (!shareEndDate.value) return null
  const expiresAt = new Date(`${shareEndDate.value}T23:59:59.999`).getTime()
  return Number.isNaN(expiresAt) ? null : expiresAt
}

function publicLink() {
  return activeNote.value ? `${window.location.origin}/public/${activeNote.value.id}` : ''
}

function shareExpiryLabel(timestamp: number | null) {
  if (!timestamp) return 'Shared indefinitely'
  const days = Math.max(0, differenceInCalendarDays(new Date(timestamp), new Date()))
  const weeks = Math.floor(days / 7)
  return `Expires in ${weeks} ${weeks === 1 ? 'week' : 'weeks'} and ${days % 7} ${days % 7 === 1 ? 'day' : 'days'}`
}

async function copyPublicLink() {
  const url = publicLink()
  if (!url) return
  await navigator.clipboard.writeText(url)
  toast.add({ title: 'Link copied', icon: 'i-lucide-clipboard-check', duration: 2000 })
}

async function saveSharing(isPublic: boolean) {
  if (!activeNoteId.value) return
  const publicUntil = isPublic ? getShareExpiry() : null
  if (publicUntil && publicUntil <= Date.now()) {
    toast.add({ title: 'Choose a future end date', icon: 'i-lucide-calendar-x', color: 'error', duration: 3000 })
    return
  }
  sharing.value = true
  try {
    const updated = await updateSharing(activeNoteId.value, isPublic, publicUntil)
    shareEndDate.value = formatShareEndDate(updated.publicUntil)
    toast.add({
      title: updated.isPublic ? 'Note is shared' : 'Sharing stopped',
      description: updated.isPublic && updated.publicUntil ? `Available through ${formatShareEndDate(updated.publicUntil)}` : undefined,
      icon: updated.isPublic ? 'i-lucide-globe' : 'i-lucide-lock',
      duration: 2500
    })
  } catch {
    toast.add({ title: 'Could not update sharing', icon: 'i-lucide-alert-triangle', color: 'error', duration: 3000 })
  } finally {
    sharing.value = false
  }
}
const editorRef = ref()

// ─── Image upload ────────────────────────────────────────────

async function uploadImage(file: File): Promise<string | null> {
  const noteId = activeNoteId.value
  if (!noteId) return null
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await $fetch<{ url: string }>(`/api/notes/${noteId}/attachments`, { method: 'POST', body: form })
    return res.url
  } catch {
    toast.add({ title: 'Image upload failed', icon: 'i-lucide-image-off', color: 'error', duration: 3000 })
    return null
  }
}

// ─── Custom extensions ───────────────────────────────────────

const lowlight = createLowlight(common)

const ImagePaste = Extension.create({
  name: 'imagePaste',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('imagePaste'),
        props: {
          handlePaste(_view, event) {
            const items = Array.from(event.clipboardData?.items ?? [])
            const imageItem = items.find(i => i.kind === 'file' && i.type.startsWith('image/'))
            if (!imageItem) return false
            const file = imageItem.getAsFile()
            if (!file) return false
            event.preventDefault()
            uploadImage(file).then((url) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (url) (editor.chain().focus() as any).setImage({ src: url }).run()
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
  const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
  if (!files.length) return
  editorRef.value?.editor?.commands.focus()
  const urls = await Promise.all(files.map(uploadImage))
  urls.forEach((url) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (url) (editorRef.value?.editor?.chain().focus() as any)?.setImage({ src: url }).run()
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
    const editor = this.editor
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
              editor.commands.insertContent(html)
              return true
            }

            if (event.clipboardData?.getData('text/html')) return false
            editor.commands.insertContent(html)
            return true
          }
        }
      })
    ]
  }
})

const InlineTableControls = Extension.create({
  name: 'inlineTableControls',
  addProseMirrorPlugins() {
    const editor = this.editor

    function getTableContext() {
      const { $from } = editor.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type.name === 'table') {
          return { node: $from.node(depth), pos: $from.before(depth), start: $from.start(depth) }
        }
      }
      return null
    }

    function runEdgeCommand(command: 'addRowAfter' | 'deleteRow' | 'addColumnAfter' | 'deleteColumn') {
      const table = getTableContext()
      if (!table) return

      const lastRow = table.node.lastChild
      const lastCell = lastRow?.lastChild
      if (!lastRow || !lastCell) return

      const rowPos = table.start + table.node.content.size - lastRow.nodeSize
      const cellPos = rowPos + 1 + lastRow.content.size - lastCell.nodeSize
      const selection = Selection.near(editor.state.doc.resolve(cellPos + 1))
      editor.view.dispatch(editor.state.tr.setSelection(selection))

      if (command === 'addRowAfter') editor.chain().focus().addRowAfter().run()
      if (command === 'deleteRow') editor.chain().focus().deleteRow().run()
      if (command === 'addColumnAfter') editor.chain().focus().addColumnAfter().run()
      if (command === 'deleteColumn') editor.chain().focus().deleteColumn().run()
    }

    return [
      new Plugin({
        key: new PluginKey('inlineTableControls'),
        view(view) {
          const controls = document.createElement('div')
          controls.className = 'table-edge-controls'
          controls.contentEditable = 'false'
          let wrapper: HTMLElement | null = null

          const makeButton = (label: string, command: Parameters<typeof runEdgeCommand>[0], axis: 'row' | 'column') => {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'table-edge-controls__button'
            button.textContent = label
            button.dataset.action = command.startsWith('add') ? 'add' : 'remove'
            button.addEventListener('pointerdown', (event) => {
              event.preventDefault()
              event.stopPropagation()
              runEdgeCommand(command)
            })
            button.dataset.axis = axis
            return button
          }

          const rowControls = document.createElement('div')
          rowControls.className = 'table-edge-controls__rows'
          const addRowButton = makeButton('+ Add row', 'addRowAfter', 'row')
          const removeRowButton = makeButton('- Remove row', 'deleteRow', 'row')
          rowControls.append(
            removeRowButton,
            addRowButton
          )

          const columnControls = document.createElement('div')
          columnControls.className = 'table-edge-controls__columns'
          const addColumnButton = makeButton('+ Column', 'addColumnAfter', 'column')
          const removeColumnButton = makeButton('- Column', 'deleteColumn', 'column')
          columnControls.append(
            addColumnButton,
            removeColumnButton
          )
          controls.append(rowControls, columnControls)

          const update = () => {
            const table = getTableContext()
            const firstRow = table?.node.firstChild
            let columnCount = 0
            firstRow?.forEach((cell) => {
              columnCount += cell.attrs.colspan ?? 1
            })
            removeRowButton.disabled = (table?.node.childCount ?? 0) <= 1
            removeColumnButton.disabled = columnCount <= 1
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
    execute: (editor: Editor) => {
      openAiPrompt(editor)
      return editor.chain()
    },
    isActive: () => false
  },
  image: {
    canExecute: () => true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (editor: any) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const url = await uploadImage(file)
        if (url) editor.chain().focus().setImage({ src: url }).run()
      }
      input.click()
    },
    isActive: () => false
  },
  table: {
    canExecute: () => true,
    execute: (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    isActive: () => false
  },
  addColumnBefore: {
    canExecute: (editor: Editor) => editor.can().addColumnBefore(),
    execute: (editor: Editor) => editor.chain().focus().addColumnBefore(),
    isActive: () => false
  },
  addColumnAfter: {
    canExecute: (editor: Editor) => editor.can().addColumnAfter(),
    execute: (editor: Editor) => editor.chain().focus().addColumnAfter(),
    isActive: () => false
  },
  deleteColumn: {
    canExecute: (editor: Editor) => editor.can().deleteColumn(),
    execute: (editor: Editor) => editor.chain().focus().deleteColumn(),
    isActive: () => false
  },
  addRowBefore: {
    canExecute: (editor: Editor) => editor.can().addRowBefore(),
    execute: (editor: Editor) => editor.chain().focus().addRowBefore(),
    isActive: () => false
  },
  addRowAfter: {
    canExecute: (editor: Editor) => editor.can().addRowAfter(),
    execute: (editor: Editor) => editor.chain().focus().addRowAfter(),
    isActive: () => false
  },
  deleteRow: {
    canExecute: (editor: Editor) => editor.can().deleteRow(),
    execute: (editor: Editor) => editor.chain().focus().deleteRow(),
    isActive: () => false
  },
  deleteTable: {
    canExecute: (editor: Editor) => editor.can().deleteTable(),
    execute: (editor: Editor) => editor.chain().focus().deleteTable(),
    isActive: () => false
  },
  mergeCells: {
    canExecute: (editor: Editor) => editor.can().mergeCells(),
    execute: (editor: Editor) => editor.chain().focus().mergeCells(),
    isActive: () => false
  },
  splitCell: {
    canExecute: (editor: Editor) => editor.can().splitCell(),
    execute: (editor: Editor) => editor.chain().focus().splitCell(),
    isActive: () => false
  },
  toggleHeaderRow: {
    canExecute: (editor: Editor) => editor.can().toggleHeaderRow(),
    execute: (editor: Editor) => editor.chain().focus().toggleHeaderRow(),
    isActive: () => false
  },
  toggleHeaderColumn: {
    canExecute: (editor: Editor) => editor.can().toggleHeaderColumn(),
    execute: (editor: Editor) => editor.chain().focus().toggleHeaderColumn(),
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
  { kind: 'table', icon: 'i-lucide-table', tooltip: { text: 'Insert table' } },
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

function shouldShowTableToolbar(editor: Pick<Editor, 'isActive'>, view: EditorView, state: EditorState) {
  const domSelection = view.dom.ownerDocument.getSelection()
  const hasDomTextSelection = Boolean(
    domSelection
    && !domSelection.isCollapsed
    && domSelection.anchorNode
    && domSelection.focusNode
    && view.dom.contains(domSelection.anchorNode)
    && view.dom.contains(domSelection.focusNode)
  )

  return view.hasFocus()
    && state.selection.empty
    && !hasDomTextSelection
    && editor.isActive('table')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suggestionItems: any[][] = [[
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
  { kind: 'table', label: 'Table', description: 'Insert a 3 x 3 table', icon: 'i-lucide-table' },
  { kind: 'horizontalRule', label: 'Divider', icon: 'i-lucide-separator-horizontal' }
], [
  { type: 'label', label: 'Insert' },
  { kind: 'image', label: 'Image', icon: 'i-lucide-image' }
]]

// ─── Content & auto-save ─────────────────────────────────────

const editorContent = ref('')
let saveTimer: ReturnType<typeof setTimeout> | null = null
const isDirty = ref(false)
let suppressSave = false

function scheduleAutoSave(html: string) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const id = activeNoteId.value
    if (id) {
      updateNote(id, html)
      isDirty.value = false
    }
  }, 600)
}

function flushSave(id?: string) {
  const targetId = id ?? activeNoteId.value
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (targetId && isDirty.value) {
    updateNote(targetId, editorContent.value)
    isDirty.value = false
  }
}

watch(editorContent, (html) => {
  if (suppressSave) return
  isDirty.value = true
  scheduleAutoSave(html)
})

watch(activeNoteId, async (newId, oldId) => {
  if (oldId) flushSave(oldId)
  suppressSave = true
  editorContent.value = activeNote.value?.content ?? ''
  await nextTick()
  suppressSave = false
  isDirty.value = false
  shareEndDate.value = formatShareEndDate(activeNote.value?.publicUntil ?? null)
  if (newId && autoFocus.value) {
    autoFocus.value = false
    editorRef.value?.editor?.commands.focus('start')
  }
}, { immediate: true })

onBeforeUnmount(() => flushSave())

// ─── Copy to Markdown ────────────────────────────────────────

function copyToMarkdown() {
  navigator.clipboard.writeText(htmlToMarkdown(editorContent.value)).then(() => {
    toast.add({ title: 'Copied as Markdown', icon: 'i-lucide-clipboard-check', duration: 2000 })
  })
}

const tagCount = computed(() => activeNote.value?.tags.length ?? 0)
</script>

<template>
  <div class="flex flex-col h-full bg-default">
    <!-- Empty state -->
    <template v-if="!activeNote">
      <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <UIcon
          name="i-lucide-notebook-pen"
          class="size-12 text-muted"
        />
        <p class="text-muted text-sm">
          Select a note or create a new one
        </p>
        <UButton
          icon="i-lucide-plus"
          label="New note"
          color="primary"
          variant="soft"
          size="sm"
          @click="useNotes().createNote()"
        />
      </div>
    </template>

    <template v-else>
      <div
        class="flex-1 overflow-y-auto"
        @dragover.prevent
        @drop.prevent="onFileDrop"
      >
        <UEditor
          ref="editorRef"
          v-slot="{ editor }"
          v-model="editorContent"
          content-type="html"
          placeholder="Start writing… (@ for dates, # for tags)"
          :starter-kit="{ codeBlock: false }"
          :image="false"
          :extensions="extensions"
          :handlers="customHandlers"
          class="min-h-full"
        >
          <!-- Fixed toolbar -->
          <div class="flex items-center gap-2 px-3 py-2.5 pb-3 border-b border-default sticky top-0 bg-default z-10 overflow-x-auto">
            <UEditorToolbar
              :editor="editor"
              :items="fixedToolbarItems"
            />
            <div class="flex items-center gap-1 shrink-0 ml-auto">
              <span
                v-if="tagCount > 0"
                class="flex items-center gap-1 text-xs text-muted"
              >
                <UIcon
                  name="i-lucide-tag"
                  class="size-3"
                />
                {{ tagCount }}
              </span>
              <div class="w-px h-4 bg-muted/40" />
              <UPopover
                v-model:open="shareOpen"
                :content="{ align: 'end', sideOffset: 8 }"
                @open-auto-focus.prevent
              >
                <UButton
                  :icon="activeNote?.isPublic ? 'i-lucide-globe' : 'i-lucide-share-2'"
                  size="xs"
                  :color="activeNote?.isPublic ? 'primary' : 'neutral'"
                  variant="ghost"
                  aria-label="Share note"
                >
                  <span class="hidden sm:inline">Share</span>
                </UButton>

                <template #content>
                  <div class="w-80 p-3 space-y-3">
                    <div class="flex items-start gap-2">
                      <div class="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
                        <UIcon
                          name="i-lucide-globe-2"
                          class="size-4"
                        />
                      </div>
                      <div>
                        <p class="text-sm font-medium text-default">
                          Share this note
                        </p>
                        <p class="text-xs text-muted">
                          {{ activeNote?.isPublic ? 'Anyone with the link can view it.' : 'Create a view-only public link.' }}
                        </p>
                      </div>
                    </div>

                    <UFormField
                      label="End date"
                      hint="Optional"
                    >
                      <UInput
                        v-model="shareEndDate"
                        type="date"
                        :min="new Date().toISOString().slice(0, 10)"
                        class="w-full"
                      />
                      <template #hint>
                        <span class="text-xs text-muted">Leave empty to share indefinitely</span>
                      </template>
                    </UFormField>

                    <div
                      v-if="activeNote?.isPublic"
                      class="rounded-md bg-elevated px-2.5 py-2"
                    >
                      <p class="text-xs font-medium text-default">
                        Link is active
                      </p>
                      <p class="mt-0.5 text-xs text-muted truncate">
                        {{ publicLink() }}
                      </p>
                      <p class="mt-1 text-xs text-muted">
                        {{ shareExpiryLabel(activeNote?.publicUntil ?? null) }}
                      </p>
                    </div>

                    <div class="flex gap-2">
                      <UButton
                        :label="activeNote?.isPublic ? 'Save changes' : 'Share note'"
                        icon="i-lucide-send"
                        size="sm"
                        class="flex-1 justify-center"
                        :loading="sharing"
                        @click="saveSharing(true)"
                      />
                      <UButton
                        v-if="activeNote?.isPublic"
                        label="Copy link"
                        icon="i-lucide-copy"
                        size="sm"
                        color="neutral"
                        variant="soft"
                        @click="copyPublicLink"
                      />
                    </div>

                    <UButton
                      v-if="activeNote?.isPublic"
                      label="Stop sharing"
                      icon="i-lucide-lock"
                      size="sm"
                      color="error"
                      variant="ghost"
                      block
                      :loading="sharing"
                      @click="saveSharing(false)"
                    />
                  </div>
                </template>
              </UPopover>
              <div class="w-px h-4 bg-muted/40" />
              <UButton
                icon="i-lucide-clipboard-copy"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="copyToMarkdown"
              >
                <span class="hidden sm:inline">Copy</span>
              </UButton>
            </div>
          </div>

          <!-- Slash commands (type /) -->
          <UEditorSuggestionMenu
            :editor="editor"
            :items="suggestionItems"
          />

          <!-- Bubble toolbar (appears on text selection) -->
          <UEditorToolbar
            :editor="editor"
            :items="bubbleToolbarItems"
            layout="bubble"
            :ui="{ root: 'z-50' }"
            :should-show="({ editor: e, view, state }) => {
              const { selection } = state
              return view.hasFocus() && !selection.empty && !e.isActive('image')
            }"
          />

          <!-- Table controls (appears when the cursor is in a table) -->
          <UEditorToolbar
            :editor="editor"
            :items="tableToolbarItems"
            layout="bubble"
            plugin-key="table-toolbar"
            :should-show="({ editor: e, view, state }) => shouldShowTableToolbar(e, view, state)"
          />

          <!-- Drag handle (hover any block) -->
          <UEditorDragHandle
            v-slot="{ ui }"
            :editor="editor"
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
      </div>
    </template>

    <UModal
      v-model:open="aiPromptOpen"
      title="Ask AI"
      description="Describe what you want to add at the current cursor position. You can optionally include the current note as context."
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
              label="Include current note as context"
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
  </div>
</template>
