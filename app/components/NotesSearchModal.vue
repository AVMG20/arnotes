<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { relativeTime } from '~/composables/useRelativeTime'
import { tagChipClass } from '~/utils/tagColors'
import { expandTagToken, type TagRequirement } from '#shared/utils/tags'

const { activeNoteId, activeTag, searchQuery, allTags, searchNotes, createNote } = useNotes()
const { searchBoards, allTasks } = useProjects()

const open = useSearchModal()
const query = ref('')
const highlighted = ref(0)

// ─── Scope: everything, notes only, tasks only ───────────────

// Remembered, because which half of the workspace someone searches is a habit
// rather than a per-search decision.
type Scope = 'all' | 'notes' | 'tasks'

const scope = useCookie<Scope>('search-scope', { default: () => 'all' })

const scopes: { value: Scope, label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'notes', label: 'Notes' },
  { value: 'tasks', label: 'Tasks' }
]

const wantsNotes = computed(() => scope.value !== 'tasks')
const wantsTasks = computed(() => scope.value !== 'notes')

// ─── Query parsing: "#tag1 #tag2 search text" ────────────────

// Every tag the box knows about: the notes' own tags, plus what a board offers
// a `#tag` to match on — its labels and the words of its name.
const knownTags = computed(() => {
  const tags = new Set(allTags.value.map(t => t.tag))
  for (const task of allTasks.value) {
    for (const label of task.tags) tags.add(label.toLowerCase())
    for (const word of task.projectName.toLowerCase().split(/[^\w]+/)) if (word) tags.add(word)
  }
  return [...tags]
})

const parsed = computed(() => {
  const tokens = query.value.split(/\s+/).filter(Boolean)
  const tags = tokens.filter(t => t.startsWith('#') && t.length > 1).map(t => t.slice(1).toLowerCase())
  const text = tokens.filter(t => !t.startsWith('#')).join(' ')
  // Trailing "#par…" token drives the autocomplete suggestions.
  const trailing = /#([\w]*)$/.exec(query.value)
  return { tags, text, trailingToken: trailing?.[1] ?? null }
})

// A half-typed tag filters by everything it could still become, so `#sani`
// searches `#sanitairkamer` without anyone having to finish the word.
const tagFilters = computed<TagRequirement[]>(() =>
  parsed.value.tags.map(token => expandTagToken(token, knownTags.value))
)

// Whichever tags are actually doing the filtering, flattened — the result rows
// use this to pick out the tag that matched.
const matchedTags = computed(() => new Set(tagFilters.value.flat()))

const hasQuery = computed(() => parsed.value.text.trim().length > 0)
const isFiltered = computed(() => hasQuery.value || tagFilters.value.length > 0)

// Board hits ride along with note hits — one modal, whole workspace.
const noteResults = computed(() =>
  wantsNotes.value ? searchNotes(parsed.value.text, tagFilters.value).slice(0, 8) : []
)
const boardResults = computed(() =>
  wantsTasks.value ? searchBoards(parsed.value.text, tagFilters.value) : { tasks: [], projects: [] }
)

// Autocomplete for the trailing "#par" token. It is a shortcut now rather than
// a requirement — the partial already filters on its own.
const tagSuggestions = computed(() => {
  const partial = parsed.value.trailingToken
  if (partial === null) return []
  return knownTags.value
    .filter(tag => tag.startsWith(partial.toLowerCase()) && tag !== partial.toLowerCase())
    .slice(0, 6)
})

function completeTag(tag: string) {
  query.value = query.value.replace(/#([\w]*)$/, `#${tag} `)
}

watch(query, () => {
  highlighted.value = 0
})
watch(scope, () => {
  highlighted.value = 0
})
watch(open, (v) => {
  if (v) {
    query.value = ''
    highlighted.value = 0
  }
})

// ─── Actions ─────────────────────────────────────────────────

function selectNote(id: string) {
  activeNoteId.value = id
  activeTag.value = null
  searchQuery.value = ''
  open.value = false
  navigateTo(`/note/${id}`)
}

function openTask(projectId: string, taskId: string) {
  open.value = false
  navigateTo(`/projects/${projectId}?task=${taskId}`)
}

function openProject(projectId: string) {
  open.value = false
  navigateTo(`/projects/${projectId}`)
}

async function handleCreateNote() {
  const note = await createNote({ title: hasQuery.value ? parsed.value.text.trim() : undefined })
  open.value = false
  navigateTo(`/note/${note.id}`)
}

// ─── Rows ────────────────────────────────────────────────────

// Everything the modal lists is one flat run of rows, grouped under section
// headings: recent items before anything is typed, results after. One list
// means one cursor, so arrows and Enter work the same in both states.
interface Row {
  key: string
  section: string
  icon: string
  title: string
  snippet?: string
  meta?: string
  time?: string
  noteTags?: string[]
  labels?: string[]
  create?: boolean
  run: () => void
}

const rows = computed<Row[]>(() => {
  const list: Row[] = []
  const filtered = isFiltered.value

  const notes = filtered ? noteResults.value : (wantsNotes.value ? searchNotes('').slice(0, 6) : [])
  for (const note of notes) {
    list.push({
      key: `note-${note.id}`,
      section: filtered ? 'Notes' : 'Recent notes',
      icon: 'i-lucide-file-text',
      title: note.title || 'Untitled',
      snippet: hasQuery.value ? smartSnippet(note.content) : undefined,
      time: relativeTime(note.updatedAt),
      noteTags: note.tags.slice(0, 3),
      run: () => selectNote(note.id)
    })
  }

  const tasks = filtered ? boardResults.value.tasks : (wantsTasks.value ? allTasks.value.slice(0, 4) : [])
  for (const task of tasks) {
    list.push({
      key: `task-${task.id}`,
      section: filtered ? 'Tasks' : 'Recent tasks',
      icon: 'i-lucide-square-kanban',
      title: task.title,
      snippet: hasQuery.value ? smartSnippet(task.description) : undefined,
      meta: task.projectName,
      time: relativeTime(task.updatedAt),
      labels: task.tags.slice(0, 3),
      run: () => openTask(task.projectId, task.id)
    })
  }

  for (const project of filtered ? boardResults.value.projects : []) {
    list.push({
      key: `project-${project.id}`,
      section: 'Projects',
      icon: 'i-lucide-kanban',
      title: project.name,
      run: () => openProject(project.id)
    })
  }

  if (hasQuery.value || !filtered) {
    list.push({
      key: 'create',
      section: 'Actions',
      icon: 'i-lucide-plus',
      title: hasQuery.value ? `Create note “${parsed.value.text.trim()}”` : 'New note',
      create: true,
      run: handleCreateNote
    })
  }
  return list
})

const hasResults = computed(() => rows.value.some(row => !row.create))

// ─── Keyboard navigation ─────────────────────────────────────

const listEl = ref<HTMLElement | null>(null)

function move(step: number) {
  const count = rows.value.length
  if (!count) return
  highlighted.value = (highlighted.value + step + count) % count
  nextTick(() => listEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }))
}

function cycleScope(step: number) {
  const index = scopes.findIndex(option => option.value === scope.value)
  scope.value = scopes[(index + step + scopes.length) % scopes.length]!.value
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    rows.value[highlighted.value]?.run()
  } else if (e.key === 'Tab') {
    // Tab finishes a half-typed #tag; with none to finish it switches scope.
    e.preventDefault()
    if (tagSuggestions.value.length > 0) completeTag(tagSuggestions.value[0]!)
    else cycleScope(e.shiftKey ? -1 : 1)
  }
}

// ─── Global shortcut ─────────────────────────────────────────
// The modal is mounted once by the app layout, so owning ⌘K here keeps it
// working on every view — including ones that run their own key handling.
// Capture phase, so an editor or a dialog further down cannot swallow the
// combo first.

function onGlobalKeydown(e: KeyboardEvent) {
  // ⌘⇧K is the editor's link shortcut.
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
  if (e.key.toLowerCase() !== 'k') return
  e.preventDefault()
  e.stopPropagation()
  open.value = true
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown, true))

// ─── Snippet & highlighting ───────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text: string): string {
  const q = parsed.value.text.trim()
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
  const q = parsed.value.text.trim()
  if (!q) return text.slice(0, 160)

  const terms = q.split(/\s+/).filter(t => t.length >= 2)
  let matchIdx = -1
  for (const term of terms) {
    const i = text.toLowerCase().indexOf(term.toLowerCase())
    if (i >= 0 && (matchIdx < 0 || i < matchIdx)) matchIdx = i
  }

  if (matchIdx < 0) return text.slice(0, 160)
  const start = Math.max(0, matchIdx - 40)
  const end = Math.min(text.length, start + 200)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :close="false"
    :ui="{ content: 'p-0 overflow-hidden gap-0 sm:max-w-xl top-[12vh] translate-y-0 sm:top-[14vh]' }"
  >
    <template #content>
      <div
        class="search-modal flex flex-col"
        @keydown="onKeydown"
      >
        <!-- Search input -->
        <div class="flex items-center gap-2.5 px-4 py-3">
          <UIcon
            name="i-lucide-search"
            class="size-4.5 shrink-0 text-dimmed"
          />
          <input
            v-model="query"
            autofocus
            placeholder="Search notes and tasks…"
            class="min-w-0 flex-1 bg-transparent text-[15px] text-highlighted outline-none placeholder:text-dimmed"
          >
          <div class="flex shrink-0 items-center gap-0.5 rounded-md bg-elevated/70 p-0.5">
            <button
              v-for="option in scopes"
              :key="option.value"
              type="button"
              tabindex="-1"
              class="rounded px-2 py-0.5 text-xs font-medium transition-colors"
              :class="scope === option.value
                ? 'bg-default text-highlighted shadow-sm'
                : 'text-muted hover:text-default'"
              @click="scope = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- #tag autocomplete -->
        <div
          v-if="tagSuggestions.length > 0"
          class="scrollbar-hidden flex items-center gap-1 overflow-x-auto border-t border-default px-4 py-1.5"
        >
          <button
            v-for="(tag, i) in tagSuggestions"
            :key="tag"
            type="button"
            tabindex="-1"
            class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors"
            :class="i === 0 ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated hover:text-default'"
            @click="completeTag(tag)"
          >
            #{{ tag }}
            <UKbd
              v-if="i === 0"
              size="sm"
              value="Tab"
            />
          </button>
        </div>

        <!-- Rows -->
        <div
          ref="listEl"
          class="max-h-[min(28rem,60vh)] overflow-y-auto border-t border-default p-1.5"
        >
          <div
            v-if="isFiltered && !hasResults"
            class="px-3 py-6 text-center text-sm text-muted"
          >
            Nothing found for “{{ query.trim() }}”
          </div>

          <template
            v-for="(row, i) in rows"
            :key="row.key"
          >
            <p
              v-if="row.section !== rows[i - 1]?.section && !row.create"
              class="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-dimmed"
              :class="i === 0 ? 'pt-1.5' : 'pt-3'"
            >
              {{ row.section }}
            </p>
            <div
              v-else-if="row.create && i > 0"
              class="mx-2.5 my-1.5 border-t border-default"
            />

            <button
              type="button"
              tabindex="-1"
              class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left"
              :class="i === highlighted ? 'bg-elevated' : ''"
              :data-active="i === highlighted"
              @click="row.run()"
              @mousemove="highlighted = i"
            >
              <UIcon
                :name="row.icon"
                class="size-4 shrink-0"
                :class="i === highlighted || row.create ? 'text-primary' : 'text-dimmed'"
              />

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <!-- eslint-disable vue/no-v-html -- `highlight` escapes its input -->
                  <span
                    class="truncate text-sm"
                    :class="row.create ? 'text-muted' : 'font-medium text-highlighted'"
                    v-html="row.create ? escapeHtml(row.title) : highlight(row.title)"
                  />
                  <span
                    v-for="tag in row.noteTags"
                    :key="tag"
                    class="hidden shrink-0 text-xs sm:inline"
                    :class="matchedTags.has(tag) ? 'font-medium text-primary' : 'text-dimmed'"
                  >#{{ tag }}</span>
                  <span
                    v-for="label in row.labels"
                    :key="label"
                    class="hidden shrink-0 rounded px-1.5 py-px text-[0.6875rem] font-medium ring-1 ring-inset sm:inline"
                    :class="tagChipClass(label)"
                  >{{ label }}</span>
                </div>
                <p
                  v-if="row.snippet"
                  class="truncate text-xs text-muted"
                  v-html="highlight(row.snippet)"
                />
                <!-- eslint-enable vue/no-v-html -->
              </div>

              <span
                v-if="row.meta"
                class="hidden max-w-32 shrink-0 truncate text-xs text-dimmed sm:inline"
              >{{ row.meta }}</span>
              <span
                v-if="row.time"
                class="w-16 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-dimmed"
              >{{ row.time }}</span>
              <UIcon
                name="i-lucide-corner-down-left"
                class="size-3.5 shrink-0 text-dimmed"
                :class="i === highlighted ? '' : 'invisible'"
              />
            </button>
          </template>
        </div>

        <!-- Footer hints -->
        <div class="flex items-center gap-3 border-t border-default px-4 py-2 text-[11px] text-dimmed">
          <span class="flex items-center gap-1"><UKbd
            size="sm"
            value="↑"
          /><UKbd
            size="sm"
            value="↓"
          /> navigate</span>
          <span class="flex items-center gap-1"><UKbd
            size="sm"
            value="↵"
          /> open</span>
          <span class="hidden items-center gap-1 sm:flex"><UKbd
            size="sm"
            value="Tab"
          /> scope</span>
          <span class="hidden items-center gap-1 sm:flex"><UKbd
            size="sm"
            value="#"
          /> filter by tag</span>
          <span class="ml-auto flex items-center gap-1"><UKbd
            size="sm"
            value="Esc"
          /> close</span>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style>
/* Matched terms in a result. Scoped by hand to the modal: a bare `mark` rule
   would also restyle highlights in the editor. */
.search-modal mark {
  background-color: color-mix(in oklab, var(--ui-primary) 22%, transparent);
  color: inherit;
  border-radius: 2px;
}
</style>
