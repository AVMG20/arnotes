<script setup lang="ts">
import { computed, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { escapeInlineMarkdown, renderInlineMarkdown } from '#shared/utils/inlineMarkdown'

// The update box: one line of text that happens to be a real editor. There is
// no toolbar and no chrome — typing `**done**` turns bold as you type it, and
// what leaves the component is the Markdown, so the update is stored as text
// an agent can read over MCP rather than as editor HTML.
const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [markdown: string]
  'submit': []
}>()

const WRAPPERS: Record<string, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  highlight: '=='
}

// Markers have to sit against the text they mark, so any space at the edge of a
// marked run is moved outside it.
function wrap(text: string, marker: string): string {
  const [, lead = '', body = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? []
  return body ? `${lead}${marker}${body}${marker}${trail}` : text
}

function inlineToMarkdown(block: ProseMirrorNode): string {
  let out = ''

  block.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      out += '\n'
      return
    }
    if (!child.isText) return

    const marks = new Set(child.marks.map(mark => mark.type.name))
    // Code is literal: its content is never escaped and never re-marked.
    let text = marks.has('code')
      ? `\`${child.text ?? ''}\``
      : escapeInlineMarkdown(child.text ?? '')

    if (!marks.has('code')) {
      for (const name of ['highlight', 'strike', 'italic', 'bold']) {
        if (marks.has(name)) text = wrap(text, WRAPPERS[name]!)
      }
    }

    const link = child.marks.find(mark => mark.type.name === 'link')
    if (link) text = `[${text}](${link.attrs.href})`

    out += text
  })

  return out
}

// Enter posts the update; Shift-Enter is the line break, as it already is
// everywhere else in the app.
const submitOnEnter = Extension.create({
  name: 'submitOnEnter',
  // Above the starter kit, whose Enter would split the paragraph before this
  // ever ran.
  priority: 1000,
  addKeyboardShortcuts: () => ({
    Enter: () => {
      emit('submit')
      return true
    }
  })
})

const editor = useEditor({
  content: props.modelValue ? renderInlineMarkdown(props.modelValue) : '',
  extensions: [
    StarterKit.configure({
      // Everything that would open a block is off: an update is a line.
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      codeBlock: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      trailingNode: false,
      underline: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
    }),
    Highlight.configure({ multicolor: false }),
    submitOnEnter
  ],
  editorProps: {
    attributes: {
      class: 'inline-md inline-editor w-full',
      'aria-label': 'Update'
    }
  },
  onUpdate: ({ editor: instance }) => {
    const markdown = instance.state.doc.content.content
      .map(inlineToMarkdown)
      .join('\n')
      .trim()
    if (markdown !== props.modelValue) emit('update:modelValue', markdown)
  }
})

const isEmpty = computed(() => editor.value?.isEmpty ?? true)

// The parent clears the draft after posting, and may fill it from elsewhere.
// The editor only follows when the value is not the one it just produced.
watch(() => props.modelValue, (value) => {
  const instance = editor.value
  if (!instance) return
  const current = instance.state.doc.content.content.map(inlineToMarkdown).join('\n').trim()
  if (value === current) return
  instance.commands.setContent(value ? renderInlineMarkdown(value) : '', { emitUpdate: false })
})

function focus() {
  editor.value?.commands.focus('end')
}

defineExpose({ focus })
</script>

<template>
  <!-- The whole box takes the click, not just the line of text: an editor one
       line tall inside a taller row leaves dead space that looks clickable. -->
  <div
    class="relative min-w-0 flex-1 cursor-text"
    @click="focus"
  >
    <EditorContent
      :editor="editor"
      class="w-full text-sm text-default"
    />
    <p
      v-if="isEmpty"
      class="pointer-events-none absolute inset-0 select-none text-sm text-dimmed"
    >
      {{ props.placeholder ?? 'Add an update…' }}
    </p>
  </div>
</template>
