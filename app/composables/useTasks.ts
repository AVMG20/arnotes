import { computed, ref } from 'vue'
import type { Note } from '~/composables/useNotes'

export type TaskStatusFilter = 'open' | 'done' | 'all'
export type TaskSort = 'updated' | 'created' | 'due'

// Module-level singleton state
const _statusFilter = ref<TaskStatusFilter>('open')
const _sort = ref<TaskSort>('updated')
const _query = ref('')
const _selectedTaskId = ref<string | null>(null)

// ─── Query parsing ("#tag1 #tag2 free text") ────────────────

export function parseTaskQuery(query: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  return {
    tags: tokens.filter(t => t.startsWith('#') && t.length > 1).map(t => t.slice(1).toLowerCase()),
    text: tokens.filter(t => !t.startsWith('#')).join(' ').toLowerCase()
  }
}

const SORTERS: Record<TaskSort, (a: Note, b: Note) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  due: (a, b) =>
    (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY)
    || b.updatedAt - a.updatedAt
}

export function useTasks() {
  const { notes, getNote, createTask, updateTaskMeta, renameNote, deleteNote, restoreNote } = useNotes()

  const tasks = computed(() => notes.value.filter(n => n.isTask && !n.deletedAt))

  const openTasks = computed(() => tasks.value.filter(t => t.taskStatus !== 'done'))
  const openCount = computed(() => openTasks.value.length)
  const doneCount = computed(() => tasks.value.length - openCount.value)
  const overdueCount = computed(() => {
    const now = Date.now()
    return openTasks.value.filter(t => t.dueAt !== null && t.dueAt < now).length
  })

  // Every tag used by a task, most used first — drives the filter autocomplete.
  const taskTags = computed(() => {
    const counts = new Map<string, number>()
    for (const t of tasks.value) {
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag)
  })

  const filteredTasks = computed(() => {
    const { tags, text } = parseTaskQuery(_query.value)
    let list = tasks.value

    if (_statusFilter.value !== 'all') {
      const wantDone = _statusFilter.value === 'done'
      list = list.filter(t => (t.taskStatus === 'done') === wantDone)
    }
    if (tags.length > 0) list = list.filter(t => tags.every(tag => t.tags.includes(tag)))
    if (text) list = list.filter(t => t.title.toLowerCase().includes(text))

    const sorter = SORTERS[_sort.value]
    // In the "All" tab completed work sinks below whatever is still open.
    return [...list].sort((a, b) =>
      Number(a.taskStatus === 'done') - Number(b.taskStatus === 'done') || sorter(a, b)
    )
  })

  const selectedTask = computed(() => {
    const task = getNote(_selectedTaskId.value)
    return task && task.isTask && !task.deletedAt ? task : null
  })

  function selectTask(id: string | null) {
    _selectedTaskId.value = id
  }

  async function toggleTask(id: string) {
    const task = getNote(id)
    if (!task) return
    await updateTaskMeta(id, { taskStatus: task.taskStatus === 'done' ? 'open' : 'done' })
  }

  function hasTagFilter(tag: string) {
    return parseTaskQuery(_query.value).tags.includes(tag.toLowerCase())
  }

  function toggleTagFilter(tag: string) {
    const tokens = _query.value.split(/\s+/).filter(Boolean)
    const token = '#' + tag
    _query.value = (tokens.includes(token) ? tokens.filter(t => t !== token) : [...tokens, token]).join(' ')
  }

  return {
    tasks,
    openCount,
    doneCount,
    overdueCount,
    taskTags,
    filteredTasks,
    statusFilter: _statusFilter,
    sort: _sort,
    query: _query,
    selectedTaskId: _selectedTaskId,
    selectedTask,
    selectTask,
    createTask,
    updateTaskMeta,
    renameNote,
    deleteNote,
    restoreNote,
    toggleTask,
    hasTagFilter,
    toggleTagFilter
  }
}

// ─── Due date display helper ────────────────────────────────

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export type BadgeColor = 'error' | 'warning' | 'primary' | 'neutral'

const DUE_TONE_COLOR: Record<DueTone, BadgeColor> = {
  overdue: 'error',
  today: 'warning',
  soon: 'primary',
  later: 'neutral'
}

export function dueInfo(dueAt: number | null): { label: string, tone: DueTone, color: BadgeColor } | null {
  if (!dueAt) return null
  const date = new Date(dueAt)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)

  const withColor = (label: string, tone: DueTone) => ({ label, tone, color: DUE_TONE_COLOR[tone] })

  if (days < 0) return withColor(days === -1 ? 'Yesterday' : `${Math.abs(days)}d overdue`, 'overdue')
  if (days === 0) return withColor('Today', 'today')
  if (days === 1) return withColor('Tomorrow', 'soon')
  if (days < 7) return withColor(`${days}d`, 'soon')
  return withColor(
    date.getFullYear() === now.getFullYear()
      ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    'later'
  )
}

// ─── Date helpers shared by the drawer and the quick-add box ─

// Tasks are due at the end of their day, so "today" stays open all day.
export function endOfDay(date: Date | string): number | null {
  const value = typeof date === 'string'
    ? (date ? new Date(`${date}T23:59:59.999`) : null)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
  if (!value) return null
  const ts = value.getTime()
  return Number.isNaN(ts) ? null : ts
}

export function toDateInputValue(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

export function daysFromToday(days: number): number {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return endOfDay(d)!
}
