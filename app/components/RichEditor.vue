<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { CHART_TEMPLATE, MERMAID_TEMPLATE } from '~/utils/chart'
import { transformActions } from '~/composables/useAi'
import { useEditorAi } from '~/composables/useEditorAi'
import { createContentExtensions } from '~/utils/editor/extensions'
import { SmartClipboard, imageFiles, insertImages } from '~/utils/editor/clipboard'
import { BlockShortcuts } from '~/utils/editor/blocks'
import { AiPendingDecoration, BlurredSelection, HashtagHighlight } from '~/utils/editor/decorations'
import {
  CODE_BLOCK_ITEM,
  DIAGRAM_ITEMS,
  DIVIDER_ITEM,
  HISTORY_ITEMS,
  LIST_ITEMS,
  MARK_ITEMS,
  MOD,
  QUOTE_ITEM,
  SHIFT,
  TEXT_STYLE_ITEMS,
  asButton,
  type EditorItem
} from '~/utils/editor/items'
import TableGridPicker from '~/components/TableGridPicker.vue'
import TableControls from '~/components/TableControls.vue'
import EditorBubbleMenu from '~/components/editor/EditorBubbleMenu.vue'
import EditorBlockHandle from '~/components/editor/EditorBlockHandle.vue'
import EditorHighlightPicker from '~/components/editor/EditorHighlightPicker.vue'
import EditorAiPrompt from '~/components/editor/EditorAiPrompt.vue'

// Shared rich text editor: the exact editing surface used by notes, reusable
// for task descriptions. Parents own persistence via v-model; this component
// only edits. `uploadImage` opts into image support: the parent supplies the
// upload (notes and tasks each have an attachment endpoint). The #toolbar-right
// slot hosts context actions.
//
// This file wires the parts together. The parts themselves live next door:
// the schema, clipboard, block and decoration extensions in `utils/editor`,
// the command lists in `utils/editor/items`, the floating UI in
// `components/editor`, and the AI calls in `useEditorAi`.
const props = defineProps<{
  modelValue: string
  placeholder?: string
  uploadImage?: (file: File) => Promise<string | null>
}>()

const emit = defineEmits<{ 'update:modelValue': [html: string] }>()

const editorRef = ref()
const editor = computed(() => editorRef.value?.editor as Editor | undefined)

const content = computed({
  get: () => props.modelValue,
  set: (html: string) => emit('update:modelValue', html)
})

const ai = useEditorAi(editor)

const bubble = ref<InstanceType<typeof EditorBubbleMenu>>()

function editLink(): boolean {
  return bubble.value?.editLink() ?? false
}

function focusEditor() {
  editor.value?.commands.focus('start')
}

defineExpose({ focusEditor })

// ─── Table creation picker ───────────────────────────────────

const tablePickerOpen = ref(false)

// The slash-menu picker has no button to hang off, so it is anchored to a
// virtual element at the caret. It is a real popover rather than a hand-rolled
// teleport: inside a modal panel (the task drawer) only registered layers get
// pointer events and keep focus, and a plain fixed div is neither.
const slashTablePicker = reactive({ open: false, rect: { x: 0, y: 0, width: 0, height: 0 } })
const slashTablePickerReference = {
  getBoundingClientRect: () => {
    const { x, y, width, height } = slashTablePicker.rect
    return new DOMRect(x, y, width, height)
  }
}
let tablePickerEditor: Editor | null = null

function insertTableOfSize(ed: Editor, size: { rows: number, cols: number }) {
  ed.chain().focus().insertTable({ rows: size.rows, cols: size.cols, withHeaderRow: true }).run()
}

function onToolbarTablePick(ed: Editor, size: { rows: number, cols: number }) {
  tablePickerOpen.value = false
  insertTableOfSize(ed, size)
}

function onSlashTablePick(size: { rows: number, cols: number }) {
  const ed = tablePickerEditor
  tablePickerEditor = null
  slashTablePicker.open = false
  if (ed && !ed.isDestroyed) insertTableOfSize(ed, size)
}

// Closed without a pick (Escape, click elsewhere): the caret goes back where
// the slash command was typed so the user is not left with nothing focused.
watch(() => slashTablePicker.open, (open) => {
  if (open) return
  const ed = tablePickerEditor
  tablePickerEditor = null
  if (ed && !ed.isDestroyed) ed.commands.focus()
})

// The caret stays in the editor while the picker is up, and the editor swallows
// Escape before it can reach the popover's own listener — so the key is taken
// here first. Claiming it also keeps it from a surrounding modal panel, which
// would otherwise read the same press as "close everything".
const SlashTablePickerKeys = Extension.create({
  name: 'slashTablePickerKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        if (!slashTablePicker.open) return false
        slashTablePicker.open = false
        return true
      }
    }
  }
})

// ─── Extensions ──────────────────────────────────────────────

const extensions = [
  ...createContentExtensions({ editable: true }),
  SmartClipboard.configure({ getUploader: () => props.uploadImage }),
  BlockShortcuts.configure({ onLink: editLink }),
  HashtagHighlight,
  BlurredSelection,
  AiPendingDecoration,
  SlashTablePickerKeys
]

// Dropped image files go where they were dropped. This sits on the wrapper
// rather than in a plugin so the drag handle cannot intercept the drop.
function onFileDrop(event: DragEvent) {
  const ed = editor.value
  const files = imageFiles(event.dataTransfer)
  if (!ed || !props.uploadImage || !files.length) return
  const position = ed.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
  void insertImages(ed, files, props.uploadImage, position)
}

function pickImage(ed: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length && props.uploadImage) void insertImages(ed, files, props.uploadImage)
  }
  input.click()
}

// ─── Handlers ────────────────────────────────────────────────

// A diagram is a code block in the `chart` or `mermaid` language, seeded with
// a small example so the shape of the language is in front of the writer.
function insertDiagram(ed: Editor, language: 'chart' | 'mermaid') {
  const text = language === 'chart' ? CHART_TEMPLATE : MERMAID_TEMPLATE
  ed.chain().focus().insertContent({
    type: 'codeBlock',
    attrs: { language },
    content: [{ type: 'text', text }]
  }).run()
  // The caret lands after the new block; it belongs at the end of the
  // example source instead, which is what opens the source for editing.
  const { doc, selection } = ed.state
  let end: number | null = null
  doc.nodesBetween(0, selection.from, (node, pos) => {
    if (node.type.name === 'codeBlock' && node.attrs.language === language) end = pos + 1 + node.content.size
  })
  if (end !== null) ed.commands.focus(end)
  return ed.chain()
}

// Handlers for the `kind`s Nuxt UI does not know. Each opens something rather
// than changing the document, so they hand back an empty chain to run.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customHandlers: any = {
  chart: {
    canExecute: () => true,
    execute: (ed: Editor) => insertDiagram(ed, 'chart'),
    isActive: (ed: Editor) => ed.isActive('codeBlock', { language: 'chart' })
  },
  mermaid: {
    canExecute: () => true,
    execute: (ed: Editor) => insertDiagram(ed, 'mermaid'),
    isActive: (ed: Editor) => ed.isActive('codeBlock', { language: 'mermaid' })
  },
  aiPrompt: {
    canExecute: () => !ai.loading.value,
    execute: (ed: Editor) => {
      ai.openPrompt(ed)
      return ed.chain()
    },
    isActive: () => false
  },
  image: {
    canExecute: () => !!props.uploadImage,
    execute: (ed: Editor) => {
      pickImage(ed)
      return ed.chain()
    },
    isActive: () => false
  },
  table: {
    canExecute: () => true,
    execute: (ed: Editor) => {
      const { state, view } = ed
      try {
        const coords = view.coordsAtPos(state.selection.from)
        slashTablePicker.rect = { x: coords.left, y: coords.top, width: 0, height: coords.bottom - coords.top }
      } catch {
        slashTablePicker.rect = { x: window.innerWidth / 2, y: window.innerHeight / 2, width: 0, height: 0 }
      }
      tablePickerEditor = ed
      slashTablePicker.open = true
      return ed.chain()
    },
    isActive: () => false
  }
}

// ─── Toolbar & menu items ─────────────────────────────────────

const IMAGE_ITEM: EditorItem = { kind: 'image', label: 'Image', icon: 'i-lucide-image' }
const AI_ITEM: EditorItem = { kind: 'aiPrompt', label: 'Ask AI', description: 'Generate anything from a custom prompt', icon: 'i-lucide-sparkles' }

const fixedToolbarItems = computed<EditorItem[][]>(() => [
  HISTORY_ITEMS.map(asButton),
  [{
    'icon': 'i-lucide-type',
    'label': 'Text',
    'trailingIcon': 'i-lucide-chevron-down',
    'aria-label': 'Text style',
    'tooltip': { text: 'Text style' },
    'ui': { label: 'hidden md:inline', trailingIcon: 'size-3.5 text-dimmed' },
    'content': { align: 'start' },
    'items': [TEXT_STYLE_ITEMS, [QUOTE_ITEM, CODE_BLOCK_ITEM]]
  }],
  [...MARK_ITEMS.map(asButton), { slot: 'highlight' }, { slot: 'link' }],
  LIST_ITEMS.map(asButton),
  [
    { slot: 'table' },
    ...(props.uploadImage ? [asButton(IMAGE_ITEM)] : []),
    {
      'icon': 'i-lucide-plus',
      'aria-label': 'Insert',
      'tooltip': { text: 'Insert' },
      'content': { align: 'start' },
      'items': [[CODE_BLOCK_ITEM, QUOTE_ITEM, DIVIDER_ITEM], DIAGRAM_ITEMS, [AI_ITEM]]
    }
  ]
])

const aiItems: EditorItem[] = transformActions.map(action => ({
  label: action.label,
  icon: action.icon,
  onSelect: () => ai.transformSelection(action.id)
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suggestionItems = computed<any[][]>(() => [
  [AI_ITEM],
  [
    { type: 'label', label: 'Style' },
    ...TEXT_STYLE_ITEMS,
    ...LIST_ITEMS,
    QUOTE_ITEM,
    CODE_BLOCK_ITEM
  ].map(item => ({ ...item, kbds: undefined })),
  [
    { type: 'label', label: 'Insert' },
    { kind: 'table', label: 'Table', description: 'Pick a size and insert a table', icon: 'i-lucide-table' },
    ...(props.uploadImage ? [IMAGE_ITEM] : []),
    { kind: 'mention', label: 'Date', description: 'Today, next Friday, in two weeks…', icon: 'i-lucide-calendar' },
    DIVIDER_ITEM
  ],
  [
    { type: 'label', label: 'Diagrams' },
    ...DIAGRAM_ITEMS
  ]
])
</script>

<template>
  <div
    class="relative flex h-full min-h-0 flex-col"
    @dragover.prevent
    @drop.prevent="onFileDrop"
  >
    <UEditor
      ref="editorRef"
      v-slot="{ editor: ed, handlers }"
      :model-value="content"
      content-type="html"
      :placeholder="placeholder ?? 'Start writing… (/ for commands, @ for dates, # for tags)'"
      :starter-kit="{ codeBlock: false, horizontalRule: {}, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }"
      :image="false"
      :extensions="extensions"
      :handlers="customHandlers"
      class="rich-editor flex min-h-0 flex-1 flex-col overflow-y-auto"
      @update:model-value="content = $event"
    >
      <!-- Fixed toolbar. The commands scroll sideways when the editor is
           narrow (the task drawer, a phone); the context actions stay put. -->
      <div class="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-default bg-default px-3 py-2">
        <div class="scrollbar-hidden min-w-0 flex-1 overflow-x-auto">
          <UEditorToolbar
            :editor="ed"
            :items="fixedToolbarItems"
            class="w-max"
          >
            <template #highlight>
              <EditorHighlightPicker :editor="ed" />
            </template>

            <template #link>
              <UTooltip
                text="Link"
                :kbds="[MOD, SHIFT, 'K']"
              >
                <UButton
                  icon="i-lucide-link"
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  active-color="primary"
                  active-variant="soft"
                  :active="ed.isActive('link')"
                  :disabled="ed.state.selection.empty && !ed.isActive('link')"
                  aria-label="Link"
                  @click="editLink()"
                />
              </UTooltip>
            </template>

            <template #table>
              <UPopover
                v-model:open="tablePickerOpen"
                :content="{ align: 'start', sideOffset: 8 }"
              >
                <UTooltip
                  text="Table"
                  :disabled="tablePickerOpen"
                >
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
        </div>

        <div
          v-if="$slots['toolbar-right']"
          class="flex shrink-0 items-center gap-1"
        >
          <slot name="toolbar-right" />
        </div>
      </div>

      <!-- Slash commands (type /) -->
      <UEditorSuggestionMenu
        :editor="ed"
        :items="suggestionItems"
      />

      <!-- Selection bubble: formatting, links, AI -->
      <EditorBubbleMenu
        ref="bubble"
        :editor="ed"
        :ai-items="aiItems"
        :ai-loading="ai.loading.value"
      />

      <!-- Table handles: row, column, corner, "+" edges, cell selection -->
      <TableControls :editor="ed" />

      <!-- Block handle (hover any block): add below, drag, block menu -->
      <EditorBlockHandle
        :editor="ed"
        :handlers="handlers"
      />
    </UEditor>

    <EditorAiPrompt
      v-model:open="ai.promptOpen.value"
      :generate="ai.generate"
    />

    <!-- Table size picker (opened from the slash menu), anchored at the caret -->
    <UPopover
      v-model:open="slashTablePicker.open"
      :reference="slashTablePickerReference"
      :content="{ side: 'bottom', align: 'start', sideOffset: 8, collisionPadding: 8 }"
    >
      <template #content>
        <TableGridPicker @select="onSlashTablePick" />
      </template>
    </UPopover>
  </div>
</template>
