<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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
  { label: 'YAML', value: 'yaml' },
]

const language = computed(() => props.node.attrs.language ?? '')
const displayLabel = computed(
  () => LANGUAGES.find(l => l.value === language.value)?.label ?? (language.value || 'Auto-detect')
)

const open = ref(false)
const search = ref('')
const triggerRef = ref<HTMLButtonElement | null>(null)
const pos = ref({ top: 0, right: 0 })
const searchRef = ref<HTMLInputElement | null>(null)

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  return q ? LANGUAGES.filter(l => l.label.toLowerCase().includes(q) || l.value.includes(q)) : LANGUAGES
})

function openDropdown(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  pos.value = { top: rect.bottom + 4, right: window.innerWidth - rect.right }
  open.value = true
  search.value = ''
  // Focus the search input on next tick
  setTimeout(() => searchRef.value?.focus(), 10)
}

function close() {
  open.value = false
  search.value = ''
}

function select(e: MouseEvent, value: string) {
  e.preventDefault()
  e.stopPropagation()
  props.updateAttributes({ language: value || null })
  close()
}

function onSearchKey(e: KeyboardEvent) {
  e.stopPropagation()
  if (e.key === 'Escape') close()
  if (e.key === 'Enter' && filtered.value.length > 0) {
    props.updateAttributes({ language: filtered.value[0]!.value || null })
    close()
  }
}

function onOutsideClick(e: MouseEvent) {
  if (!(e.target as HTMLElement)?.closest?.('.code-lang-dropdown')) close()
}

onMounted(() => document.addEventListener('mousedown', onOutsideClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onOutsideClick))
</script>

<template>
  <NodeViewWrapper class="code-block-node not-prose">
    <!-- Header: contenteditable=false keeps the editor from treating it as content -->
    <div contenteditable="false" class="code-block-header">
      <span class="text-xs text-muted font-mono select-none leading-none">{ }</span>

      <button
        ref="triggerRef"
        class="flex items-center gap-1 text-xs px-2 py-0.5 rounded text-muted hover:text-default bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors select-none"
        @mousedown="openDropdown"
      >
        {{ displayLabel }}
        <svg class="size-3 opacity-50" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
        </svg>
      </button>
    </div>

    <!-- Code content -->
    <pre class="code-block-pre"><NodeViewContent as="code" :class="language ? `language-${language}` : ''" /></pre>

    <!-- Teleported dropdown — outside the editor DOM entirely -->
    <Teleport to="body">
      <div
        v-if="open"
        class="code-lang-dropdown fixed z-[9999] w-52 rounded-lg border border-default bg-default shadow-xl overflow-hidden"
        :style="{ top: pos.top + 'px', right: pos.right + 'px' }"
        @mousedown.stop
      >
        <!-- Search -->
        <div class="p-2 border-b border-default">
          <input
            ref="searchRef"
            v-model="search"
            placeholder="Search language…"
            class="w-full px-2 py-1.5 text-xs rounded-md bg-elevated border border-default outline-none text-default placeholder:text-muted"
            @keydown="onSearchKey"
          />
        </div>

        <!-- List -->
        <div class="max-h-56 overflow-y-auto py-1">
          <div v-if="filtered.length === 0" class="px-3 py-2 text-xs text-muted">No match</div>
          <button
            v-for="lang in filtered"
            :key="lang.value"
            class="w-full text-left px-3 py-1.5 text-sm transition-colors"
            :class="lang.value === language
              ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-950/60 font-medium'
              : 'text-default hover:bg-elevated'"
            @mousedown="(e) => select(e, lang.value)"
          >
            {{ lang.label }}
          </button>
        </div>
      </div>
    </Teleport>
  </NodeViewWrapper>
</template>
