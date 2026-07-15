<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { VueNodeViewRenderer, type Editor } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMSerializer } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CodeBlockView from '~/components/CodeBlockView.vue'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createLowlight, common } from 'lowlight'
import { DateMention } from '~/composables/useDateMention'

const { activeNote, activeNoteId, autoFocus, updateNote, togglePublic } = useNotes()
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

const aiGenerateItems = computed(() => [
  generateActions.map(action => ({
    label: action.label,
    icon: action.icon,
    onSelect: () => runGenerate(action.id)
  }))
])

async function runGenerate(action: string) {
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
  const contextHtml = editor.getHTML()
  const context = htmlToMarkdown(contextHtml).trim()
  if (!context) {
    toast.add({ title: 'Note is empty', icon: 'i-lucide-info', color: 'neutral', duration: 2000 })
    return
  }
  aiLoading.value = true
  const { from } = editor.state.selection
  setAiPending(editor, { kind: 'generate', from, to: from })
  try {
    const { result } = await runAi(action, '', context)
    const html = markdownToHtml(normalizeAiOutput(result))
    const pending = aiPendingKey.getState(editor.state)
    if (pending?.kind === 'generate') {
      editor.chain().focus().insertContentAt(pending.from, html).run()
    }
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
  setAiPending(editor, { kind: 'transform', from, to })
  try {
    const { result } = await runAi(action, text, '')
    const html = markdownToHtml(normalizeAiOutput(result))
    const pending = aiPendingKey.getState(editor.state)
    if (pending?.kind === 'transform') {
      editor.chain().focus().insertContentAt({ from: pending.from, to: pending.to }, html).run()
    }
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
  setAiPending(editor, { kind: 'generate', from: position, to: position })
  try {
    const { result } = await runCustomAi(instruction, context)
    const html = markdownToHtml(normalizeAiOutput(result))
    const pending = aiPendingKey.getState(editor.state)
    if (pending?.kind === 'generate') {
      editor.chain().focus().insertContentAt(pending.from, html).run()
      aiPrompt.value = ''
      aiPromptPosition.value = null
    }
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

async function handleTogglePublic() {
  if (!activeNoteId.value) return
  const updated = await togglePublic(activeNoteId.value)
  if (updated.isPublic) {
    const url = `${window.location.origin}/public/${updated.id}`
    await navigator.clipboard.writeText(url)
    toast.add({ title: 'Note is now public', description: 'Public link copied to clipboard', icon: 'i-lucide-globe', duration: 3000 })
  } else {
    toast.add({ title: 'Note is now private', icon: 'i-lucide-lock', duration: 2000 })
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
            if (event.clipboardData?.getData('text/html')) return false
            const text = event.clipboardData?.getData('text/plain') ?? ''
            if (!text.trim()) return false
            editor.commands.insertContent(markdownToHtml(text))
            return true
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
  DateMention,
  ImagePaste,
  AiPendingDecoration,
  HashtagHighlight,
  MarkdownPaste
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
    content: { modal: false },
    items: aiBubbleItems
  }
]]

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
              <UDropdownMenu
                :items="aiGenerateItems"
                :content="{ align: 'end', sideOffset: 4 }"
                :popper="{ placement: 'bottom-end' }"
              >
                <UButton
                  icon="i-lucide-sparkles"
                  size="xs"
                  color="primary"
                  variant="soft"
                  :loading="aiLoading"
                  aria-label="AI writing tools"
                >
                  <span class="hidden sm:inline">AI</span>
                </UButton>
              </UDropdownMenu>
              <UButton
                :icon="activeNote?.isPublic ? 'i-lucide-globe' : 'i-lucide-lock'"
                size="xs"
                :color="activeNote?.isPublic ? 'primary' : 'neutral'"
                variant="ghost"
                @click="handleTogglePublic"
              >
                <span class="hidden sm:inline">{{ activeNote?.isPublic ? 'Public' : 'Private' }}</span>
              </UButton>
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
            :should-show="({ editor: e, view, state }) => {
              const { selection } = state
              return view.hasFocus() && !selection.empty && !e.isActive('image')
            }"
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
