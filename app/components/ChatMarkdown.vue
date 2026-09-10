<script setup lang="ts">
import { computed } from 'vue'
import { renderChatMarkdown } from '~/utils/markdown'

// An assistant reply, drawn. The prose goes through the sanitised chat
// renderer as before; a ```chart or ```mermaid fence is lifted out and drawn
// by the same component the editor uses, so a diagram the assistant answers
// with looks the same as one it puts in a note. A fence that is still open
// (the reply is streaming) stays plain code until its closing line arrives,
// so a half-typed diagram never flashes a parse error.
const props = defineProps<{ text: string }>()

type Segment
  = { kind: 'html', html: string }
    | { kind: 'diagram', language: 'chart' | 'mermaid', code: string }

const FENCE_OPEN = /^\s*```\s*(chart|mermaid)\s*$/i
const FENCE_CLOSE = /^\s*```\s*$/

const segments = computed<Segment[]>(() => {
  const lines = props.text.split('\n')
  const out: Segment[] = []
  let prose: string[] = []

  const flushProse = () => {
    const text = prose.join('\n')
    if (text.trim()) out.push({ kind: 'html', html: renderChatMarkdown(text) })
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!)
    if (!open) {
      prose.push(lines[i]!)
      continue
    }
    const close = lines.findIndex((line, j) => j > i && FENCE_CLOSE.test(line))
    if (close === -1) {
      prose.push(lines[i]!)
      continue
    }
    flushProse()
    out.push({
      kind: 'diagram',
      language: open[1]!.toLowerCase() as 'chart' | 'mermaid',
      code: lines.slice(i + 1, close).join('\n')
    })
    i = close
  }
  flushProse()
  return out
})
</script>

<template>
  <div class="chat-markdown">
    <template
      v-for="(segment, index) in segments"
      :key="index"
    >
      <div
        v-if="segment.kind === 'html'"
        class="markdown-content"
        v-html="segment.html"
      />
      <div
        v-else
        class="code-block-node code-block-node--diagram chat-markdown-diagram"
      >
        <DiagramPreview
          :language="segment.language"
          :code="segment.code"
        />
      </div>
    </template>
  </div>
</template>
