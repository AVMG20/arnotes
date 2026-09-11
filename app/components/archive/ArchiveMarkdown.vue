<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '~/utils/markdown'
import { parseArchiveSegments } from '#shared/utils/archiveCards'

// An Archive reply, drawn. Prose goes through the sanitised chat renderer;
// ```mermaid and ```chart fences are drawn by the same component the note editor
// uses; and a ```memory: or ```todos: fence becomes a live, editable card.
//
// Cards are why the reply is not just text: everything else here is the
// assistant talking, and only a card is the stored thing itself.
const props = defineProps<{ text: string }>()

type Item
  = { kind: 'prose', key: string, text: string }
    | { kind: 'memory', key: string, id: string }
    | { kind: 'todos', key: string, ids: string[] }
    | { kind: 'diagram', key: string, language: 'chart' | 'mermaid', code: string }

// A memory fence may name several memories; each gets its own card, so the
// segments are flattened into one item per card here rather than in the
// template, where a v-for beside a v-else-if would not be legal.
const items = computed<Item[]>(() => {
  const out: Item[] = []
  parseArchiveSegments(props.text).forEach((segment, i) => {
    if (segment.kind === 'prose') {
      out.push({ kind: 'prose', key: `p${i}`, text: segment.text })
    } else if (segment.kind === 'diagram') {
      out.push({ kind: 'diagram', key: `d${i}`, language: segment.language, code: segment.code })
    } else if (segment.card === 'todos') {
      out.push({ kind: 'todos', key: `t${i}`, ids: segment.ids })
    } else {
      for (const id of segment.ids) out.push({ kind: 'memory', key: `m${i}-${id}`, id })
    }
  })
  return out
})
</script>

<template>
  <div class="archive-markdown space-y-3">
    <template
      v-for="item in items"
      :key="item.key"
    >
      <div
        v-if="item.kind === 'prose'"
        class="markdown-content"
        v-html="renderChatMarkdown(item.text)"
      />

      <ArchiveMemoryCard
        v-else-if="item.kind === 'memory'"
        :memory-id="item.id"
      />

      <ArchiveTodoCard
        v-else-if="item.kind === 'todos'"
        :ids="item.ids"
      />

      <div
        v-else
        class="code-block-node code-block-node--diagram"
      >
        <DiagramPreview
          :language="item.language"
          :code="item.code"
        />
      </div>
    </template>
  </div>
</template>
