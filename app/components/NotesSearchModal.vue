<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const recentTasks = computed(() => allTasks.value.slice(0, 3))

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

// ─── Keyboard navigation ─────────────────────────────────────

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Tab' && tagSuggestions.value.length > 0) {
    e.preventDefault()
    completeTag(tagSuggestions.value[0]!)
  }
}

const itemCount = computed(() =>
  noteResults.value.length
  + boardResults.value.tasks.length
  + boardResults.value.projects.length
  + (hasQuery.value ? 1 : 0)
)

// Flat cursor over [notes, tasks, projects, create] so arrows/Enter work across
// every section.
function itemAt(i: number): { kind: 'note', id: string } | { kind: 'task', projectId: string, taskId: string } | { kind: 'project', projectId: string } | { kind: 'create' } | null {
  const n = noteResults.value.length
  const t = boardResults.value.tasks.length
  const p = boardResults.value.projects.length
  if (i < n) return { kind: 'note', id: noteResults.value[i]!.id }
  if (i < n + t) {
    const row = boardResults.value.tasks[i - n]!
    return { kind: 'task', projectId: row.projectId, taskId: row.id }
  }
  if (i < n + t + p) return { kind: 'project', projectId: boardResults.value.projects[i - n - t]!.id }
  if (i === n + t + p && hasQuery.value) return { kind: 'create' }
  return null
}

function handleListKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlighted.value = (highlighted.value + 1) % Math.max(itemCount.value, 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlighted.value = (highlighted.value - 1 + Math.max(itemCount.value, 1)) % Math.max(itemCount.value, 1)
  } else if (e.key === 'Enter') {
    const item = itemAt(highlighted.value)
    if (item?.kind === 'note') selectNote(item.id)
    else if (item?.kind === 'task') openTask(item.projectId, item.taskId)
    else if (item?.kind === 'project') openProject(item.projectId)
    else if (item?.kind === 'create' || item === null) handleCreateNote()
  }
}

// ─── Global shortcut ─────────────────────────────────────────
// The modal is mounted once by the app layout, so owning ⌘K here keeps it
// working on every view — including ones that run their own key handling.
// Capture phase, so an editor or a dialog further down cannot swallow the
// combo first.

function onGlobalKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return
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
  if (!q) return text.slice(0, 220)

  const terms = q.split(/\s+/).filter(t => t.length >= 2)
  let matchIdx = -1
  for (const term of terms) {
    const i = text.toLowerCase().indexOf(term.toLowerCase())
    if (i >= 0 && (matchIdx < 0 || i < matchIdx)) matchIdx = i
  }

  if (matchIdx < 0) return text.slice(0, 260)
  const start = Math.max(0, matchIdx - 80)
  const end = Math.min(text.length, start + 340)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :close="false"
    :ui="{ content: 'p-0 overflow-hidden gap-0 sm:max-w-2xl' }"
  >
    <template #content>
      <div @keydown="handleListKey">
        <!-- Search input -->
        <div class="flex items-center gap-3 px-5 py-4 border-b border-default">
          <UIcon
            name="i-lucide-search"
            class="size-5 text-muted shrink-0"
          />
          <input
            v-model="query"
            autofocus
            placeholder="Search notes, tasks, projects… (# for tags)"
            class="flex-1 bg-transparent outline-none text-base text-default placeholder:text-muted"
            @keydown="onInputKeydown"
          >
          <div class="hidden shrink-0 items-center gap-0.5 rounded-lg bg-elevated/70 p-0.5 sm:flex">
            <button
              v-for="option in scopes"
              :key="option.value"
              class="cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors"
              :class="scope === option.value
                ? 'bg-default text-default shadow-sm'
                : 'text-muted hover:text-default'"
              @click="scope = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <UKbd size="sm">
            Esc
          </UKbd>
        </div>

        <!-- #tag autocomplete -->
        <div
          v-if="tagSuggestions.length > 0"
          class="flex items-center gap-1.5 px-5 py-2 border-b border-default bg-elevated/30 overflow-x-auto scrollbar-hidden"
        >
          <span class="text-xs text-muted shrink-0 mr-0.5">Complete tag:</span>
          <button
            v-for="tag in tagSuggestions"
            :key="tag"
            class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0 cursor-pointer"
            @click="completeTag(tag)"
          >
            <span class="opacity-70">#</span>{{ tag }}
            <UIcon
              name="i-lucide-corner-down-left"
              class="size-2.5 opacity-50"
            />
          </button>
        </div>

        <!-- Empty state: what was touched last, within the chosen scope -->
        <template v-if="!isFiltered">
          <div class="overflow-y-auto max-h-[34rem]">
            <!-- Recent notes (top 5) -->
            <div
              v-if="wantsNotes"
              class="px-5 pt-3 pb-1"
            >
              <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                Recent Notes
              </p>
            </div>
            <button
              v-for="note in wantsNotes ? searchNotes('').slice(0, 5) : []"
              :key="note.id"
              class="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-elevated/70"
              @click="selectNote(note.id)"
            >
              <UIcon
                name="i-lucide-file-text"
                class="size-4 shrink-0 text-dimmed group-hover:text-muted"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-default">{{ note.title || 'Untitled' }}</span>
              <div
                v-if="note.tags.length"
                class="hidden shrink-0 gap-1 sm:flex"
              >
                <span
                  v-for="tag in note.tags.slice(0, 2)"
                  :key="tag"
                  class="text-xs text-primary-500 dark:text-primary-400"
                >#{{ tag }}</span>
              </div>
              <span class="shrink-0 text-xs text-dimmed">{{ relativeTime(note.updatedAt) }}</span>
            </button>

            <!-- Recent tasks (top 3) -->
            <template v-if="wantsTasks && recentTasks.length > 0">
              <div class="px-5 pt-3 pb-1">
                <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                  Recent Tasks
                </p>
              </div>
              <button
                v-for="task in recentTasks"
                :key="task.id"
                class="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-elevated/70"
                @click="openTask(task.projectId, task.id)"
              >
                <UIcon
                  name="i-lucide-square-kanban"
                  class="size-4 shrink-0 text-dimmed group-hover:text-muted"
                />
                <span class="min-w-0 flex-1 truncate text-sm font-medium text-default">{{ task.title }}</span>
                <span class="shrink-0 truncate text-xs text-dimmed max-w-32">{{ task.projectName }}</span>
                <span class="shrink-0 text-xs text-dimmed">{{ relativeTime(task.updatedAt) }}</span>
              </button>
            </template>

            <!-- Create new note (no query) -->
            <div class="border-t border-default/50 mt-1">
              <button
                class="flex items-center gap-3 w-full px-5 py-3 text-sm text-muted hover:bg-elevated/70 transition-colors"
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
          <div class="overflow-y-auto max-h-[34rem]">
            <!-- No results -->
            <div
              v-if="noteResults.length === 0 && boardResults.tasks.length === 0 && boardResults.projects.length === 0"
              class="flex flex-col items-center justify-center py-10 gap-2"
            >
              <UIcon
                name="i-lucide-file-search"
                class="size-7 text-muted"
              />
              <p class="text-sm text-muted">
                Nothing found
              </p>
            </div>

            <!-- Notes -->
            <div
              v-if="noteResults.length > 0"
              class="px-5 pt-3 pb-1"
            >
              <p class="text-xs font-semibold text-muted uppercase tracking-wider">
                Notes
              </p>
            </div>
            <button
              v-for="(note, i) in noteResults"
              :key="note.id"
              class="flex w-full gap-3 border-b border-l-2 border-b-default/40 px-5 py-3 text-left transition-colors"
              :class="i === highlighted
                ? 'border-l-primary-500 bg-elevated'
                : 'border-l-transparent hover:bg-elevated/60'"
              @click="selectNote(note.id)"
              @mouseenter="highlighted = i"
            >
              <UIcon
                name="i-lucide-file-text"
                class="mt-0.5 size-4 shrink-0"
                :class="i === highlighted ? 'text-primary-500' : 'text-dimmed'"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex items-baseline gap-3">
                  <span
                    class="min-w-0 flex-1 truncate text-sm font-medium leading-snug text-default"
                    v-html="highlight(note.title || 'Untitled')"
                  />
                  <span class="shrink-0 text-xs text-dimmed">{{ relativeTime(note.updatedAt) }}</span>
                </div>
                <p
                  v-if="smartSnippet(note.content)"
                  class="line-clamp-2 text-sm leading-relaxed text-muted"
                  v-html="highlight(smartSnippet(note.content))"
                />
                <div
                  v-if="note.tags.length"
                  class="mt-0.5 flex flex-wrap gap-1.5"
                >
                  <span
                    v-for="tag in note.tags.slice(0, 5)"
                    :key="tag"
                    class="text-xs transition-colors"
                    :class="matchedTags.has(tag)
                      ? 'text-primary-600 dark:text-primary-400 font-semibold'
                      : 'text-primary-500/70 dark:text-primary-500/70'"
                  >#{{ tag }}</span>
                </div>
              </div>
            </button>

            <!-- Tasks -->
            <template v-if="boardResults.tasks.length > 0">
              <div class="px-5 pt-3 pb-1">
                <p class="text-xs font-semibold text-muted uppercase tracking-wider">
                  Tasks
                </p>
              </div>
              <button
                v-for="(task, i) in boardResults.tasks"
                :key="task.id"
                class="flex w-full gap-3 border-b border-l-2 border-b-default/40 px-5 py-3 text-left transition-colors"
                :class="noteResults.length + i === highlighted
                  ? 'border-l-primary-500 bg-elevated'
                  : 'border-l-transparent hover:bg-elevated/60'"
                @click="openTask(task.projectId, task.id)"
                @mouseenter="highlighted = noteResults.length + i"
              >
                <UIcon
                  name="i-lucide-square-kanban"
                  class="mt-0.5 size-4 shrink-0"
                  :class="noteResults.length + i === highlighted ? 'text-primary-500' : 'text-dimmed'"
                />
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <div class="flex items-baseline gap-3">
                    <span
                      class="min-w-0 flex-1 truncate text-sm font-medium leading-snug text-default"
                      v-html="highlight(task.title)"
                    />
                    <span class="shrink-0 text-xs text-dimmed">{{ relativeTime(task.updatedAt) }}</span>
                  </div>
                  <p
                    v-if="smartSnippet(task.description)"
                    class="line-clamp-2 text-sm leading-relaxed text-muted"
                    v-html="highlight(smartSnippet(task.description))"
                  />
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-dimmed">
                      <UIcon
                        name="i-lucide-kanban"
                        class="mr-0.5 size-3 align-[-1px]"
                      />{{ task.projectName }}
                    </span>
                    <span
                      v-for="tag in task.tags.slice(0, 4)"
                      :key="tag"
                      class="rounded px-1.5 py-0.5 text-[0.6875rem] font-medium ring-1 ring-inset"
                      :class="tagChipClass(tag)"
                    >{{ tag }}</span>
                  </div>
                </div>
              </button>
            </template>

            <!-- Projects -->
            <template v-if="boardResults.projects.length > 0">
              <div class="px-5 pt-3 pb-1">
                <p class="text-xs font-semibold text-muted uppercase tracking-wider">
                  Projects
                </p>
              </div>
              <button
                v-for="(project, i) in boardResults.projects"
                :key="project.id"
                class="flex w-full items-center gap-3 border-b border-l-2 border-b-default/40 px-5 py-2.5 text-left transition-colors"
                :class="noteResults.length + boardResults.tasks.length + i === highlighted
                  ? 'border-l-primary-500 bg-elevated'
                  : 'border-l-transparent hover:bg-elevated/60'"
                @click="openProject(project.id)"
                @mouseenter="highlighted = noteResults.length + boardResults.tasks.length + i"
              >
                <UIcon
                  name="i-lucide-kanban"
                  class="size-4 shrink-0"
                  :class="noteResults.length + boardResults.tasks.length + i === highlighted ? 'text-primary-500' : 'text-dimmed'"
                />
                <span
                  class="min-w-0 flex-1 truncate text-sm font-medium text-default"
                  v-html="highlight(project.name)"
                />
                <UIcon
                  name="i-lucide-arrow-right"
                  class="size-3.5 shrink-0 text-dimmed"
                />
              </button>
            </template>

            <!-- Create note from query -->
            <button
              v-if="hasQuery"
              class="flex w-full items-center gap-3 border-l-2 px-5 py-3 text-sm transition-colors"
              :class="highlighted === noteResults.length + boardResults.tasks.length + boardResults.projects.length
                ? 'border-l-primary-500 bg-elevated text-default'
                : 'border-l-transparent text-muted hover:bg-elevated/60'"
              @click="handleCreateNote"
              @mouseenter="highlighted = noteResults.length + boardResults.tasks.length + boardResults.projects.length"
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
        <div class="flex items-center gap-4 px-5 py-2 border-t border-default bg-muted/30 text-xs text-muted">
          <span class="flex items-center gap-1.5"><UKbd size="sm">↑↓</UKbd> navigate</span>
          <span class="flex items-center gap-1.5"><UKbd size="sm">↵</UKbd> open</span>
          <span class="hidden items-center gap-1.5 sm:flex"><UKbd size="sm">Tab</UKbd> complete #tag</span>
          <span class="hidden items-center gap-1.5 md:flex"><UKbd size="sm">#</UKbd> partial tags match too</span>
          <span class="hidden items-center gap-1.5 sm:flex"><UKbd size="sm">Esc</UKbd> close</span>
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
