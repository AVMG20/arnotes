<script setup lang="ts">
import { computed, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { htmlToMarkdown } from '~/utils/markdown'

// Archive's input line. A real editor, but a deliberately small one: lists,
// emphasis, code and links — no headings, tables or images, because a chat
// message is not a document. What leaves here is Markdown, since it goes
// straight to the model.
const props = defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [markdown: string]
  'submit': []
}>()

// Enter sends, except where it plainly means something else: inside a list it
// makes the next item, and inside a code block the next line.
const submitOnEnter = Extension.create({
  name: 'archiveSubmit',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (editor.isActive('listItem') || editor.isActive('codeBlock')) return false
        emit('submit')
        return true
      }
    }
  }
})

const editor = useEditor({
  content: props.modelValue,
  editable: !props.disabled,
  extensions: [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
    }),
    submitOnEnter
  ],
  editorProps: {
    attributes: {
      'class': 'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
      'aria-label': 'Message Archive'
    }
  },
  onUpdate: ({ editor: instance }) => {
    const markdown = htmlToMarkdown(instance.getHTML()).trim()
    if (markdown !== props.modelValue) emit('update:modelValue', markdown)
  }
})

const isEmpty = computed(() => editor.value?.isEmpty ?? true)

// The page clears the draft after sending; the editor only follows when the
// value is not the one it just produced.
watch(() => props.modelValue, (value) => {
  const instance = editor.value
  if (!instance) return
  if (value === htmlToMarkdown(instance.getHTML()).trim()) return
  instance.commands.setContent(value || '', { emitUpdate: false })
})

watch(() => props.disabled, (disabled) => {
  editor.value?.setEditable(!disabled)
})

function focus() {
  editor.value?.commands.focus('end')
}

defineExpose({ focus })
</script>

<template>
  <div
    class="relative min-w-0 flex-1 cursor-text"
    @click="focus"
  >
    <EditorContent
      :editor="editor"
      class="max-h-52 w-full overflow-y-auto text-sm text-default"
    />
    <p
      v-if="isEmpty"
      class="pointer-events-none absolute inset-0 select-none text-sm text-dimmed"
    >
      {{ props.placeholder ?? 'Tell Archive something, or ask it anything…' }}
    </p>
  </div>
</template>
