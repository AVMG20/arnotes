<script setup lang="ts">
import { ref, watch } from 'vue'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import CodeBlockView from '~/components/CodeBlockView.vue'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { createLowlight, common } from 'lowlight'
import { DateMention } from '~/composables/useDateMention'
import { ResizableImage } from '~/utils/resizable-image'

// Editor HTML rendered the way it was written, minus the editing. The public
// pages use this: the content is parsed into the same schema the editor uses,
// so what a reader sees matches the note or task exactly and nothing is
// injected straight into the DOM.
// `flush` drops the editor's own padding and tightens the block spacing, for
// containers that already provide both.
const props = defineProps<{
  content: string
  flush?: boolean
}>()

const lowlight = createLowlight(common)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extensions: any[] = [
  CodeBlockLowlight.configure({ lowlight }).extend({
    addNodeView: () => VueNodeViewRenderer(CodeBlockView)
  }),
  Highlight.configure({ multicolor: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  DateMention,
  ResizableImage
]

// The editor owns its document; the prop is copied in rather than bound, so a
// live update replaces the content without the editor writing back.
const content = ref(props.content)

watch(() => props.content, (value) => {
  content.value = value
})
</script>

<template>
  <UEditor
    v-model="content"
    content-type="html"
    :editable="false"
    :starter-kit="{ codeBlock: false }"
    :image="false"
    :extensions="extensions"
    :ui="props.flush ? { base: 'prose-flush *:my-3' } : undefined"
  />
</template>
