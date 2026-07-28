<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'

const { activeNoteId, activeTag, searchQuery, allTags, searchNotes, createNote } = useNotes()

const open = useSearchModal()
const query = ref('')
const highlighted = ref(0)
const selectedTags = ref<string[]>([])

const hasQuery = computed(() => query.value.trim().length > 0)
const isFiltered = computed(() => hasQuery.value || selectedTags.value.length > 0)
const results = computed(() => searchNotes(query.value, selectedTags.value).slice(0, 8))

// Selected tags first, then the rest in last-modified order (allTags is already sorted)
const filterTagOptions = computed(() => {
  const sel = selectedTags.value
  const rest = allTags.value.map(t => t.tag).filter(t => !sel.includes(t))
  return [...sel, ...rest]
})

watch(query, () => {
  highlighted.value = 0
})
watch(selectedTags, () => {
  highlighted.value = 0
})
watch(open, (v) => {
  if (v) {
    query.value = ''
    highlighted.value = 0
    selectedTags.value = []
  }
})

// ─── Tag filter ──────────────────────────────────────────────

function toggleTag(tag: string) {
  const idx = selectedTags.value.indexOf(tag)
  selectedTags.value = idx >= 0
    ? selectedTags.value.filter(t => t !== tag)
    : [...selectedTags.value, tag]
}

// ─── Actions ─────────────────────────────────────────────────

function selectNote(id: string) {
  activeNoteId.value = id
  activeTag.value = null
  searchQuery.value = ''
  open.value = false
}

async function handleCreateNote() {
  await createNote({ title: hasQuery.value ? query.value.trim() : undefined })
  open.value = false
}

// ─── Keyboard navigation ─────────────────────────────────────

const itemCount = computed(() => results.value.length + (hasQuery.value ? 1 : 0))

function handleListKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlighted.value = (highlighted.value + 1) % Math.max(itemCount.value, 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlighted.value = (highlighted.value - 1 + Math.max(itemCount.value, 1)) % Math.max(itemCount.value, 1)
  } else if (e.key === 'Enter') {
    if (hasQuery.value && highlighted.value === results.value.length) {
      handleCreateNote()
    } else {
      const note = results.value[highlighted.value]
      if (note) selectNote(note.id)
    }
  }
}

// ─── Snippet & highlighting ───────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text: string): string {
  const q = query.value.trim()
  const safe = escapeHtml(text)
  if (!q) return safe
  const terms = q.split(/\s+/).filter(t => t.length >= 2).map(escapeRegex)
  if (!terms.length) return safe
  const re = new RegExp(`(${terms.join('|')})`, 'gi')
  return safe.replace(re, '<mark>$1</mark>')
}

function smartSnippet(html: string): string {
  if (!html || !import.meta.client) return ''
  const el = document.createElement('div')
  el.innerHTML = html
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const q = query.value.trim()
  if (!q) return text.slice(0, 120)

  const terms = q.split(/\s+/).filter(t => t.length >= 2)
  let matchIdx = -1
  for (const term of terms) {
    const i = text.toLowerCase().indexOf(term.toLowerCase())
    if (i >= 0 && (matchIdx < 0 || i < matchIdx)) matchIdx = i
  }

  if (matchIdx < 0) return text.slice(0, 160)
  const start = Math.max(0, matchIdx - 60)
  const end = Math.min(text.length, start + 200)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :close="false"
    :ui="{ content: 'p-0 overflow-hidden gap-0 max-w-2xl' }"
  >
    <template #content>
      <div @keydown="handleListKey">
        <!-- Search input -->
        <div class="flex items-center gap-3 px-4 py-3 border-b border-default">
          <UIcon
            name="i-lucide-search"
            class="size-4 text-muted shrink-0"
          />
          <input
            v-model="query"
            autofocus
            placeholder="Search or create a note…"
            class="flex-1 bg-transparent outline-none text-sm text-default placeholder:text-muted"
          >
          <UKbd size="sm">
            Esc
          </UKbd>
        </div>

        <!-- Tag filter chips -->
        <div
          v-if="filterTagOptions.length > 0"
          class="scrollbar-hidden flex items-center gap-1.5 px-4 py-2 border-b border-default overflow-x-auto"
        >
          <UIcon
            name="i-lucide-tag"
            class="size-3 text-muted shrink-0 mr-0.5"
          />
          <button
            v-for="tag in filterTagOptions"
            :key="tag"
            class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium shrink-0 transition-colors cursor-pointer"
            :class="selectedTags.includes(tag)
              ? 'bg-primary-500 text-white dark:bg-primary-500'
              : 'bg-elevated text-muted hover:text-default hover:bg-elevated/80'"
            @click="toggleTag(tag)"
          >
            <span class="opacity-70">#</span>{{ tag }}
            <UIcon
              v-if="selectedTags.includes(tag)"
              name="i-lucide-x"
              class="size-2.5 ml-0.5"
            />
          </button>
        </div>

        <!-- Empty state: recent tags + recent notes -->
        <template v-if="!isFiltered">
          <div class="overflow-y-auto max-h-104">
            <!-- Recent notes (top 5) -->
            <div class="px-4 pt-2.5 pb-1">
              <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                Recent Notes
              </p>
            </div>
            <button
              v-for="note in searchNotes('').slice(0, 5)"
              :key="note.id"
              class="flex items-center justify-between w-full px-4 py-2.5 text-left gap-4 hover:bg-elevated/70 transition-colors"
              @click="selectNote(note.id)"
            >
              <span class="font-medium text-sm text-default truncate">{{ note.title || 'Untitled' }}</span>
              <div class="flex items-center gap-3 shrink-0">
                <div
                  v-if="note.tags.length"
                  class="flex gap-1"
                >
                  <span
                    v-for="tag in note.tags.slice(0, 2)"
                    :key="tag"
                    class="text-xs text-primary-500 dark:text-primary-400"
                  >#{{ tag }}</span>
                </div>
                <span class="text-xs text-muted">{{ relativeTime(note.updatedAt) }}</span>
              </div>
            </button>

            <!-- Create new note (no query) -->
            <div class="border-t border-default/50 mt-1">
              <button
                class="flex items-center gap-3 w-full px-4 py-3 text-sm text-muted hover:bg-elevated/70 transition-colors"
                @click="handleCreateNote"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-4 shrink-0"
                />
                New note
                <UKbd
                  size="sm"
                  class="ml-auto"
                >
                  ⌘N
                </UKbd>
              </button>
            </div>
          </div>
        </template>

        <!-- Search results -->
        <template v-else>
          <div class="overflow-y-auto max-h-[26rem]">
            <!-- No results -->
            <div
              v-if="results.length === 0"
              class="flex flex-col items-center justify-center py-10 gap-2"
            >
              <UIcon
                name="i-lucide-file-search"
                class="size-7 text-muted"
              />
              <p class="text-sm text-muted">
                No notes found
              </p>
            </div>

            <button
              v-for="(note, i) in results"
              :key="note.id"
              class="flex flex-col gap-1 w-full px-4 py-3 text-left border-b border-default/40 last:border-0 transition-colors"
              :class="i === highlighted ? 'bg-elevated' : 'hover:bg-elevated/60'"
              @click="selectNote(note.id)"
              @mouseenter="highlighted = i"
            >
              <div class="flex items-start justify-between gap-4">
                <span
                  class="font-medium text-sm text-default leading-snug"
                  v-html="highlight(note.title || 'Untitled')"
                />
                <span class="text-xs text-muted shrink-0 mt-px">{{ relativeTime(note.updatedAt) }}</span>
              </div>
              <p
                v-if="smartSnippet(note.content)"
                class="text-xs text-muted line-clamp-2 leading-relaxed"
                v-html="highlight(smartSnippet(note.content))"
              />
              <div
                v-if="note.tags.length"
                class="flex flex-wrap gap-1.5 mt-0.5"
              >
                <span
                  v-for="tag in note.tags.slice(0, 5)"
                  :key="tag"
                  class="text-xs transition-colors"
                  :class="selectedTags.includes(tag)
                    ? 'text-primary-600 dark:text-primary-400 font-semibold'
                    : 'text-primary-500/70 dark:text-primary-500/70'"
                >#{{ tag }}</span>
              </div>
            </button>

            <!-- Create note from query -->
            <button
              v-if="hasQuery"
              class="flex items-center gap-3 w-full px-4 py-3 text-sm border-t border-default/40 transition-colors"
              :class="highlighted === results.length ? 'bg-elevated text-default' : 'text-muted hover:bg-elevated/60'"
              @click="handleCreateNote"
              @mouseenter="highlighted = results.length"
            >
              <UIcon
                name="i-lucide-plus"
                class="size-4 shrink-0 text-primary-500"
              />
              Create note
              <span class="font-medium text-default">"{{ query.trim() }}"</span>
            </button>
          </div>
        </template>

        <!-- Footer hints -->
        <div class="flex items-center gap-4 px-4 py-2 border-t border-default bg-muted/30 text-xs text-muted">
          <span class="flex items-center gap-1.5"><UKbd size="sm">↑↓</UKbd> navigate</span>
          <span class="flex items-center gap-1.5"><UKbd size="sm">↵</UKbd> open</span>
          <span class="flex items-center gap-1.5"><UKbd size="sm">Esc</UKbd> close</span>
          <span class="ml-auto flex items-center gap-1"><UKbd size="sm">⌘</UKbd><UKbd size="sm">K</UKbd></span>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style>
mark {
  background-color: #fef08a;
  color: #422006;
  border-radius: 2px;
  padding: 0 1px;
}

.dark mark {
  background-color: #713f12;
  color: #fef9c3;
}
</style>
