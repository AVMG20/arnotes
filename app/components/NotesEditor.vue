<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CodeBlockView from '~/components/CodeBlockView.vue'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createLowlight, common } from 'lowlight'
import TurndownService from 'turndown'
import { marked } from 'marked'
import { DateMention } from '~/composables/useDateMention'

const { activeNote, activeNoteId, autoFocus, updateNote } = useNotes()
const toast = useToast()
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
            uploadImage(file).then(url => {
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
  urls.forEach(url => {
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

function markdownToHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  if (!import.meta.client) return raw
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  doc.querySelectorAll('ul > li').forEach((li) => {
    const input = li.querySelector('input[type="checkbox"]')
    if (!input) return
    const checked = (input as HTMLInputElement).checked
    li.closest('ul')!.setAttribute('data-type', 'taskList')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String(checked))
    input.remove()
    const content = li.innerHTML.trim()
    li.innerHTML = `<label><input type="checkbox"${checked ? ' checked' : ''}></label><div><p>${content}</p></div>`
  })
  return doc.body.innerHTML
}

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
  HashtagHighlight,
  MarkdownPaste
]

// ─── Handlers ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const customHandlers: any = {
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
const bubbleToolbarItems: any[][] = [[
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } },
  { kind: 'mark', mark: 'highlight', icon: 'i-lucide-highlighter', tooltip: { text: 'Highlight' } },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Code' } }
]]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suggestionItems: any[][] = [[
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
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
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
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  td.addRule('taskItem', {
    filter(node) {
      return node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-type') === 'taskItem'
    },
    replacement(_content, node) {
      const el = node as HTMLElement
      const checked = el.getAttribute('data-checked') === 'true'
      const text = (el.querySelector('div, p')?.textContent ?? '').trim()
      return `- [${checked ? 'x' : ' '}] ${text}\n`
    }
  })
  td.addRule('fencedCode', {
    filter(node) {
      return node.nodeName === 'PRE' && !!node.firstChild && (node.firstChild as HTMLElement).nodeName === 'CODE'
    },
    replacement(_content, node) {
      const code = (node as HTMLElement).querySelector('code')
      const lang = (code?.className ?? '').match(/language-(\w+)/)?.[1] ?? ''
      return `\n\`\`\`${lang}\n${code?.textContent ?? ''}\n\`\`\`\n\n`
    }
  })
  td.addRule('highlight', {
    filter: ['mark'],
    replacement: (content) => content
  })
  navigator.clipboard.writeText(td.turndown(editorContent.value)).then(() => {
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
        <UIcon name="i-lucide-notebook-pen" class="size-12 text-muted" />
        <p class="text-muted text-sm">Select a note or create a new one</p>
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
      <div class="flex-1 overflow-y-auto" @dragover.prevent @drop.prevent="onFileDrop">
        <UEditor
          ref="editorRef"
          v-slot="{ editor, handlers }"
          v-model="editorContent"
          content-type="html"
          placeholder="Start writing… (@ for dates, # for tags)"
          :starter-kit="{ codeBlock: false }"
          :extensions="extensions"
          :handlers="customHandlers"
          class="min-h-full"
        >
          <!-- Fixed toolbar -->
          <div class="flex items-center gap-2 px-3 py-3 border-b border-default sticky top-0 bg-default z-10 overflow-x-auto">
            <UEditorToolbar :editor="editor" :items="fixedToolbarItems" />
            <div class="flex items-center gap-2 shrink-0 ml-auto">
              <span v-if="tagCount > 0" class="flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-tag" class="size-3" />
                {{ tagCount }}
              </span>
              <div class="w-px h-4 bg-muted/40" />
              <UButton
                icon="i-lucide-clipboard-copy"
                label="Copy"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="copyToMarkdown"
              />
            </div>
          </div>

          <!-- Slash commands (type /) -->
          <UEditorSuggestionMenu :editor="editor" :items="suggestionItems" />

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
          <UEditorDragHandle v-slot="{ ui }" :editor="editor">
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
  </div>
</template>
