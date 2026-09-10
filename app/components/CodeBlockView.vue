<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { NodeViewWrapper, NodeViewContent, nodeViewProps } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)

const LANGUAGES = [
  { label: 'Auto-detect', value: '' },
  { label: 'Bash', value: 'bash' },
  { label: 'C', value: 'c' },
  { label: 'C++', value: 'cpp' },
  { label: 'C#', value: 'csharp' },
  { label: 'CSS', value: 'css' },
  { label: 'Dockerfile', value: 'dockerfile' },
  { label: 'Go', value: 'go' },
  { label: 'GraphQL', value: 'graphql' },
  { label: 'HTML', value: 'xml' },
  { label: 'HTTP', value: 'http' },
  { label: 'Java', value: 'java' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'JSON', value: 'json' },
  { label: 'Kotlin', value: 'kotlin' },
  { label: 'Lua', value: 'lua' },
  { label: 'Makefile', value: 'makefile' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'PHP', value: 'php' },
  { label: 'Python', value: 'python' },
  { label: 'R', value: 'r' },
  { label: 'Ruby', value: 'ruby' },
  { label: 'Rust', value: 'rust' },
  { label: 'Scala', value: 'scala' },
  { label: 'SCSS', value: 'scss' },
  { label: 'Shell', value: 'shell' },
  { label: 'SQL', value: 'sql' },
  { label: 'Swift', value: 'swift' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'YAML', value: 'yaml' }
]

const language = computed(() => props.node.attrs.language ?? '')
const displayLabel = computed(
  () => LANGUAGES.find(l => l.value === language.value)?.label ?? (language.value || 'Auto-detect')
)

const open = ref(false)
const search = ref('')
const searchRef = ref<HTMLInputElement | null>(null)

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  return q ? LANGUAGES.filter(l => l.label.toLowerCase().includes(q) || l.value.includes(q)) : LANGUAGES
})

// The picker is a real popover rather than a hand-rolled teleport. Inside a
// modal panel (the task drawer) only registered overlay layers receive pointer
// events and are allowed to hold focus; a plain fixed div is neither, so it
// could be seen but not used there.
watch(open, (isOpen) => {
  if (!isOpen) {
    search.value = ''
    return
  }
  nextTick(() => searchRef.value?.focus())
})

function select(value: string) {
  props.updateAttributes({ language: value || null })
  open.value = false
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && filtered.value.length > 0) {
    e.preventDefault()
    select(filtered.value[0]!.value)
  }
}
</script>

<template>
  <NodeViewWrapper class="code-block-node not-prose">
    <!-- Header: contenteditable=false keeps the editor from treating it as content -->
    <div
      contenteditable="false"
      class="code-block-header"
    >
      <span class="text-xs text-muted font-mono select-none leading-none">{ }</span>

      <!-- `mousedown.prevent` keeps the editor's selection where it is while
           the button takes the click. -->
      <UPopover
        v-model:open="open"
        :content="{ side: 'bottom', align: 'end', sideOffset: 4, collisionPadding: 8 }"
        :ui="{ content: 'w-52 overflow-hidden p-0' }"
      >
        <button
          class="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-muted hover:text-default bg-accented hover:bg-elevated transition-colors select-none"
          @mousedown.prevent
        >
          {{ displayLabel }}
          <svg
            class="size-3 opacity-50"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
          </svg>
        </button>

        <template #content>
          <div class="p-2 border-b border-default">
            <input
              ref="searchRef"
              v-model="search"
              placeholder="Search language…"
              class="w-full px-2 py-1.5 text-xs rounded-md bg-elevated border border-default outline-none text-default placeholder:text-muted"
              @keydown="onSearchKey"
            >
          </div>

          <div class="max-h-56 overflow-y-auto py-1">
            <div
              v-if="filtered.length === 0"
              class="px-3 py-2 text-xs text-muted"
            >
              No match
            </div>
            <button
              v-for="lang in filtered"
              :key="lang.value"
              class="w-full text-left px-3 py-1.5 text-sm transition-colors"
              :class="lang.value === language
                ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/60 font-medium'
                : 'text-default hover:bg-elevated'"
              @click="select(lang.value)"
            >
              {{ lang.label }}
            </button>
          </div>
        </template>
      </UPopover>
    </div>

    <!-- Code content -->
    <pre class="code-block-pre"><NodeViewContent
as="code"
                                                 :class="language ? `language-${language}` : ''"
    /></pre>
  </NodeViewWrapper>
</template>
