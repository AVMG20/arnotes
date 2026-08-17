import { computed, ref } from 'vue'

// Module-level singleton state
const _statusFilter = ref<'open' | 'done' | 'all'>('open')
const _sort = ref<'updated' | 'created' | 'due'>('updated')
const _query = ref('')
const _selectedTaskId = ref<string | null>(null)

export function useTasks() {
  const { notes, createTask, updateTaskMeta, deleteNote } = useNotes()

  const tasks = computed(() => notes.value.filter(n => n.isTask && !n.deletedAt))

  const openCount = computed(() => tasks.value.filter(t => t.taskStatus !== 'done').length)
  const doneCount = computed(() => tasks.value.filter(t => t.taskStatus === 'done').length)

  const filteredTasks = computed(() => {
    let list = tasks.value
    if (_statusFilter.value !== 'all') {
      list = list.filter(t => _statusFilter.value === 'open' ? t.taskStatus !== 'done' : t.taskStatus === 'done')
    }
    // Query syntax: "#tag1 #tag2 search text" — # tokens filter tags, the rest matches titles.
    const tokens = _query.value.trim().split(/\s+/).filter(Boolean)
    const tagTokens = tokens.filter(t => t.startsWith('#') && t.length > 1).map(t => t.slice(1).toLowerCase())
    const text = tokens.filter(t => !t.startsWith('#')).join(' ').toLowerCase()
    if (tagTokens.length > 0) {
      list = list.filter(t => tagTokens.every(tag => t.tags.includes(tag)))
    }
    if (text) {
      list = list.filter(t => t.title.toLowerCase().includes(text))
    }
    const sorters: Record<typeof _sort.value, (a: typeof list[number], b: typeof list[number]) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      due: (a, b) => (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) || b.updatedAt - a.updatedAt
    }
    return [...list].sort(sorters[_sort.value])
  })

  const selectedTask = computed(() =>
    tasks.value.find(t => t.id === _selectedTaskId.value) ?? null
  )

  function selectTask(id: string | null) {
    _selectedTaskId.value = id
  }

  async function toggleTask(id: string) {
    const task = tasks.value.find(t => t.id === id)
    if (!task) return
    await updateTaskMeta(id, { taskStatus: task.taskStatus === 'done' ? 'open' : 'done' })
  }

  return {
    tasks,
    openCount,
    doneCount,
    filteredTasks,
    statusFilter: _statusFilter,
    sort: _sort,
    query: _query,
    selectedTaskId: _selectedTaskId,
    selectedTask,
    selectTask,
    createTask,
    updateTaskMeta,
    deleteNote,
    toggleTask
  }
}

// ─── Due date display helper ────────────────────────────────

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export function dueInfo(dueAt: number | null): { label: string, tone: DueTone } | null {
  if (!dueAt) return null
  const date = new Date(dueAt)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)

  if (days < 0) return { label: days === -1 ? 'Yesterday' : `${Math.abs(days)}d overdue`, tone: 'overdue' }
  if (days === 0) return { label: 'Today', tone: 'today' }
  if (days === 1) return { label: 'Tomorrow', tone: 'soon' }
  if (days < 7) return { label: `${days}d`, tone: 'soon' }
  return {
    label: date.getFullYear() === now.getFullYear()
      ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    tone: 'later'
  }
}
