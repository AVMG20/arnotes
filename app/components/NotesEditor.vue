<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CodeBlockView from '~/components/CodeBlockView.vue'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { createLowlight, common } from 'lowlight'
import { Extension } from '@tiptap/core'
import Placeholder from '@tiptap/extension-placeholder'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import TurndownService from 'turndown'
import { marked } from 'marked'
import { DateMention } from '~/composables/useDateMention'

const { activeNote, activeNoteId, updateNote } = useNotes()
const toast = useToast()

// ─── Hashtag decoration extension ───────────────────────────

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

// ─── Markdown paste conversion ──────────────────────────────

function markdownToHtml(text: string): string {
  const raw = marked.parse(text, { async: false }) as string
  if (!import.meta.client) return raw

  // Post-process: convert marked's checkbox lists to Tiptap's taskList format
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

// ─── Editor setup ───────────────────────────────────────────

const lowlight = createLowlight(common)

let saveTimer: ReturnType<typeof setTimeout> | null = null
const isDirty = ref(false)

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

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const id = activeNoteId.value
  if (id && editor.value && isDirty.value) {
    updateNote(id, editor.value.getHTML())
    isDirty.value = false
  }
}

const editor = useEditor({
  content: '',
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight }).extend({
      addNodeView: () => VueNodeViewRenderer(CodeBlockView)
    }),
    Highlight.configure({ multicolor: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    DateMention,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Placeholder.configure({ placeholder: 'Start writing… (@ for dates, # for tags)' }) as any,
    HashtagHighlight
  ],
  editorProps: {
    attributes: { class: 'tiptap-editor focus:outline-none' },
    handlePaste(_view, event) {
      // If the clipboard already carries HTML (copy from browser/app), let Tiptap handle it
      const clipHtml = event.clipboardData?.getData('text/html')
      if (clipHtml) return false

      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return false

      const html = markdownToHtml(text)
      editor.value?.commands.insertContent(html)
      return true
    }
  },
  onUpdate({ editor: e }) {
    isDirty.value = true
    scheduleAutoSave(e.getHTML())
  }
})

// Initial load: fires once when Tiptap creates the Editor instance
watch(() => editor.value, (e) => {
  if (!e) return
  e.commands.setContent(activeNote.value?.content ?? '', { emitUpdate: false })
  isDirty.value = false
})

// Note switch: only save if the user actually edited, then load the new note
watch(activeNoteId, (newId, oldId) => {
  if (!editor.value) return
  if (oldId) {
    if (isDirty.value) {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
      updateNote(oldId, editor.value.getHTML())
    }
    else if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    isDirty.value = false
  }
  if (newId) {
    editor.value.commands.setContent(activeNote.value?.content ?? '', { emitUpdate: false })
    isDirty.value = false
  }
})

onBeforeUnmount(flushSave)

// ─── Copy to Markdown ────────────────────────────────────────

function copyToMarkdown() {
  const html = editor.value?.getHTML() ?? ''
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })

  // Task list items
  td.addRule('taskItem', {
    filter(node) {
      return node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-type') === 'taskItem'
    },
    replacement(_content, node) {
      const el = node as HTMLElement
      const checked = el.getAttribute('data-checked') === 'true'
      const div = el.querySelector('div, p')
      const text = (div?.textContent ?? '').trim()
      return `- [${checked ? 'x' : ' '}] ${text}\n`
    }
  })

  // Fenced code blocks with language tag
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

  // Strip highlight marks — keep text
  td.addRule('highlight', {
    filter: ['mark'],
    replacement: (content) => content
  })

  const markdown = td.turndown(html)
  navigator.clipboard.writeText(markdown).then(() => {
    toast.add({ title: 'Copied as Markdown', icon: 'i-lucide-clipboard-check', duration: 2000 })
  })
}

// ─── Toolbar ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = () => editor.value?.chain().focus() as any

const toolbarGroups = [
  [
    { icon: 'i-lucide-heading-1', label: 'H1', action: () => cmd()?.toggleHeading({ level: 1 }).run(), active: () => editor.value?.isActive('heading', { level: 1 }) },
    { icon: 'i-lucide-heading-2', label: 'H2', action: () => cmd()?.toggleHeading({ level: 2 }).run(), active: () => editor.value?.isActive('heading', { level: 2 }) },
    { icon: 'i-lucide-heading-3', label: 'H3', action: () => cmd()?.toggleHeading({ level: 3 }).run(), active: () => editor.value?.isActive('heading', { level: 3 }) }
  ],
  [
    { icon: 'i-lucide-bold', label: 'Bold', action: () => cmd()?.toggleBold().run(), active: () => editor.value?.isActive('bold') },
    { icon: 'i-lucide-italic', label: 'Italic', action: () => cmd()?.toggleItalic().run(), active: () => editor.value?.isActive('italic') },
    { icon: 'i-lucide-strikethrough', label: 'Strike', action: () => cmd()?.toggleStrike().run(), active: () => editor.value?.isActive('strike') },
    { icon: 'i-lucide-highlighter', label: 'Highlight', action: () => cmd()?.toggleHighlight().run(), active: () => editor.value?.isActive('highlight') },
    { icon: 'i-lucide-code', label: 'Code', action: () => cmd()?.toggleCode().run(), active: () => editor.value?.isActive('code') }
  ],
  [
    { icon: 'i-lucide-list', label: 'Bullet list', action: () => cmd()?.toggleBulletList().run(), active: () => editor.value?.isActive('bulletList') },
    { icon: 'i-lucide-list-ordered', label: 'Ordered list', action: () => cmd()?.toggleOrderedList().run(), active: () => editor.value?.isActive('orderedList') },
    { icon: 'i-lucide-list-checks', label: 'Task list', action: () => cmd()?.toggleTaskList().run(), active: () => editor.value?.isActive('taskList') },
    { icon: 'i-lucide-square-code', label: 'Code block', action: () => cmd()?.toggleCodeBlock().run(), active: () => editor.value?.isActive('codeBlock') },
    { icon: 'i-lucide-quote', label: 'Blockquote', action: () => cmd()?.toggleBlockquote().run(), active: () => editor.value?.isActive('blockquote') }
  ]
]

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
      <!-- Toolbar -->
      <div class="flex items-center gap-1.5 px-3 py-2 border-b border-default shrink-0 overflow-x-auto">
        <template v-for="(group, gi) in toolbarGroups" :key="gi">
          <div v-if="gi > 0" class="w-px h-4 bg-muted/40 shrink-0" />
          <UButton
            v-for="btn in group"
            :key="btn.label"
            :icon="btn.icon"
            :aria-label="btn.label"
            size="xs"
            color="neutral"
            :variant="btn.active?.() ? 'soft' : 'ghost'"
            class="shrink-0"
            @click="btn.action()"
          />
        </template>

        <!-- Right side -->
        <div class="ml-auto flex items-center gap-2 shrink-0">
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

      <!-- Editor -->
      <div class="flex-1 overflow-y-auto">
        <EditorContent :editor="editor" class="min-h-full" />
      </div>
    </template>
  </div>
</template>
