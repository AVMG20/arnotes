import { computed, ref } from 'vue'
import type MiniSearch from 'minisearch'
import { realtimeHeaders } from '~/composables/useRealtime'
import { matchesTagRequirements, type TagRequirement } from '#shared/utils/tags'

export interface Project {
  id: string
  name: string
  // Colours pinned to this board's task labels, keyed by the label. A label
  // with no entry falls back to the colour derived from its own text.
  labelColors?: Record<string, string>
  isPublic: boolean
  publicUntil: number | null
  createdAt: number
  updatedAt: number
  // Which of the board's columns read as finished, so the sidebar can say how
  // much of it is still open without loading it. Empty when the board has no
  // ending to measure against. Only the list and create endpoints answer with
  // this; a rename or a share toggle sends the row back on its own.
  terminalColumnIds?: string[]
}

export interface ProjectColumn {
  id: string
  projectId: string
  name: string
  // A colour the user picked; null means the dot follows the column's name.
  color?: string | null
  position: number
  createdAt: number
  // Set only on trashed rows, and only present when the board was asked for
  // with `?trashed=1`. Everywhere else the server has already filtered them out.
  deletedAt?: number | null
  deletedVia?: DeletionSource | null
}

/** Where a delete came from, so the trash can name it. */
export type DeletionSource = 'ui' | 'mcp' | 'ai'

export interface ProjectTask {
  id: string
  projectId: string
  columnId: string
  title: string
  description: string
  tags: string[]
  position: number
  createdAt: number
  updatedAt: number
  deletedAt?: number | null
  deletedVia?: DeletionSource | null
}

export interface TaskComment {
  id: string
  taskId: string
  userId: string
  body: string
  createdAt: number
  userName: string | null
  // How the update was posted, and — when that was an agent over MCP — the name
  // of the key it used, which is what the thread signs it with.
  createdVia?: DeletionSource | null
  keyName?: string | null
}

// Lightweight row used by global search; not the full task.
export interface TaskSearchRow {
  id: string
  projectId: string
  projectName: string
  columnId: string
  title: string
  description: string
  tags: string[]
  updatedAt: number
}

interface BoardPayload {
  columns: ProjectColumn[]
  tasks: ProjectTask[]
  commentCounts: Record<string, number>
  // How much is in this board's trash. Sent whether or not the trashed rows
  // themselves were asked for — the header has to be able to say there is
  // something to look at before the user has gone looking.
  trashedCount: number
}

// Module-level singleton state, same pattern as useNotes.
const _projects = ref<Project[]>([])
const _allTasks = ref<TaskSearchRow[]>([])
const _activeProjectId = ref<string | null>(null)
const _board = ref<{ columns: ProjectColumn[], tasks: ProjectTask[] } | null>(null)
// Update counts live beside the board: task PUT responses do not carry them, so
// folding them into the task would wipe the badge on every edit.
const _commentCounts = ref<Record<string, number>>({})
const _boardLoading = ref(false)
const _ready = ref(false)
const _comments = ref<TaskComment[]>([])
const _commentsTaskId = ref<string | null>(null)
// Label filter for the open board. Kanban labels annotate tasks (priority,
// workstream, …) rather than group boards, so they act as a board-level filter
// and reset whenever another board is opened.
const _activeTags = ref<string[]>([])

// Whether the open board is drawing its trash. Off by default and per board:
// opening another one starts clean, the same way the label filter does.
const _showTrashed = ref(false)
const _trashedCount = ref(0)

// Search over projects and tasks; owned by the init plugin like the notes index.
type ProjectSearchDoc = { id: string, type: 'project' | 'task', name: string, title: string, descriptionText: string }
let _search: MiniSearch<ProjectSearchDoc> | null = null

function toSearchDoc(row: TaskSearchRow): ProjectSearchDoc {
  return {
    id: `task:${row.id}`,
    type: 'task',
    name: row.projectName,
    title: row.title,
    descriptionText: row.description.replace(/<[^>]+>/g, ' ')
  }
}

function reindexSearch() {
  if (!_search) return
  _search.removeAll()
  _search.addAll(_projects.value.map(p => ({
    id: `project:${p.id}`,
    type: 'project' as const,
    name: p.name,
    title: p.name,
    descriptionText: ''
  })))
  _search.addAll(_allTasks.value.map(toSearchDoc))
}

// ─── helpers ────────────────────────────────────────────────

function upsertProject(project: Project) {
  const idx = _projects.value.findIndex(p => p.id === project.id)
  if (idx < 0) {
    _projects.value = [project, ..._projects.value]
  } else {
    // Merged rather than replaced: an endpoint that answers with the row alone
    // should not blank the board shape that came with the list.
    const merged = { ..._projects.value[idx]!, ...project }
    _projects.value = [..._projects.value.slice(0, idx), merged, ..._projects.value.slice(idx + 1)]
  }
  reindexSearch()
}

function upsertBoardTask(task: ProjectTask) {
  if (!_board.value || task.projectId !== _activeProjectId.value) return
  const tasks = [..._board.value.tasks]
  const idx = tasks.findIndex(t => t.id === task.id)
  if (idx < 0) tasks.push(task)
  else tasks[idx] = task
  _board.value = { ..._board.value, tasks }
}

function removeBoardTask(id: string) {
  if (!_board.value) return
  _board.value = { ..._board.value, tasks: _board.value.tasks.filter(t => t.id !== id) }
}

function upsertSearchRow(task: ProjectTask) {
  const project = _projects.value.find(p => p.id === task.projectId)
  const row: TaskSearchRow = {
    id: task.id,
    projectId: task.projectId,
    projectName: project?.name ?? '',
    columnId: task.columnId,
    title: task.title,
    description: task.description,
    tags: task.tags ?? [],
    updatedAt: task.updatedAt
  }
  const idx = _allTasks.value.findIndex(t => t.id === row.id)
  if (idx < 0) _allTasks.value = [row, ..._allTasks.value]
  else _allTasks.value = [..._allTasks.value.slice(0, idx), row, ..._allTasks.value.slice(idx + 1)]
  reindexSearch()
}

function removeSearchRow(id: string) {
  _allTasks.value = _allTasks.value.filter(t => t.id !== id)
  reindexSearch()
}

function touchProject(projectId: string) {
  const project = _projects.value.find(p => p.id === projectId)
  if (project) {
    project.updatedAt = Date.now()
    _projects.value = [..._projects.value].sort((a, b) => b.updatedAt - a.updatedAt)
  }
}

// ─── init (called from plugin) ──────────────────────────────

export function initProjectsStore(
  projects: Project[],
  tasks: TaskSearchRow[],
  search: MiniSearch<ProjectSearchDoc>
) {
  _search = search
  _projects.value = projects
  _allTasks.value = tasks
  reindexSearch()
  _ready.value = true
}

// ─── composable ─────────────────────────────────────────────

export function useProjects() {
  const activeProject = computed(() =>
    _projects.value.find(p => p.id === _activeProjectId.value) ?? null
  )

  async function load() {
    const [projects, tasks] = await Promise.all([
      $fetch<Project[]>('/api/projects'),
      $fetch<TaskSearchRow[]>('/api/tasks')
    ])
    _projects.value = projects
    _allTasks.value = tasks
    reindexSearch()
    _ready.value = true
  }

  // Same idea as the notes sync: refresh the board list and the flat task index
  // without dropping the open board or its label filter.
  async function syncProjects() {
    const [projects, tasks] = await Promise.all([
      $fetch<Project[]>('/api/projects'),
      $fetch<TaskSearchRow[]>('/api/tasks')
    ])
    _projects.value = projects
    _allTasks.value = tasks
    reindexSearch()
  }

  async function refresh() {
    // Team switch: drop per-project board state, filters do not carry over.
    _board.value = null
    _commentCounts.value = {}
    _activeTags.value = []
    _showTrashed.value = false
    _trashedCount.value = 0
    _activeProjectId.value = null
    await load()
  }

  async function createProject(name: string) {
    const project = await $fetch<Project>('/api/projects', {
      method: 'POST', headers: realtimeHeaders(),
      body: { name }
    })
    upsertProject(project)
    return project
  }

  async function renameProject(id: string, name: string) {
    const updated = await $fetch<Project>(`/api/projects/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { name }
    })
    upsertProject(updated)
    return updated
  }

  // Sharing a board hands out a read-only link, optionally until a date, the
  // same deal a shared note gets.
  async function updateProjectSharing(id: string, isPublic: boolean, publicUntil: number | null) {
    const updated = await $fetch<Project>(`/api/projects/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { isPublic, publicUntil }
    })
    upsertProject(updated)
    return updated
  }

  async function deleteProject(id: string) {
    await $fetch(`/api/projects/${id}`, { method: 'DELETE', headers: realtimeHeaders() })
    _projects.value = _projects.value.filter(p => p.id !== id)
    _allTasks.value = _allTasks.value.filter(t => t.projectId !== id)
    reindexSearch()
    if (_activeProjectId.value === id) {
      _activeProjectId.value = null
      _board.value = null
      _commentCounts.value = {}
    }
  }

  // The board endpoint only sends trashed rows when asked, so the store needs no
  // partitioning of its own: when the trash is hidden there is nothing trashed
  // in state to begin with, and when it is shown the rows arrive holding the
  // column and position they had, which is exactly where they should be drawn.
  function boardUrl(id: string) {
    return _showTrashed.value ? `/api/projects/${id}/board?trashed=1` : `/api/projects/${id}/board`
  }

  // ─── Label colours ────────────────────────────────────────

  const labelColors = computed(() => activeProject.value?.labelColors ?? {})

  function labelColor(tag: string): string | null {
    return labelColors.value[tag] ?? null
  }

  // One label at a time: the server merges rather than taking the whole map, so
  // two boards open side by side cannot undo each other's colours.
  async function setLabelColor(tag: string, color: string | null) {
    const projectId = _activeProjectId.value
    if (!projectId) return
    const updated = await $fetch<Project>(`/api/projects/${projectId}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { labelColor: { label: tag, color } }
    })
    upsertProject(updated)
    return updated
  }

  async function loadBoard(id: string) {
    _boardLoading.value = true
    try {
      if (_activeProjectId.value !== id) {
        _activeTags.value = []
        // A board is opened with its trash closed, however the last one was left.
        _showTrashed.value = false
      }
      _activeProjectId.value = id
      const board = await $fetch<BoardPayload>(boardUrl(id))
      // A board opened for a project that was deleted mid-flight should not stick.
      if (_activeProjectId.value === id) {
        _board.value = { columns: board.columns, tasks: board.tasks }
        _commentCounts.value = board.commentCounts ?? {}
        _trashedCount.value = board.trashedCount ?? 0
      }
      return board
    } finally {
      _boardLoading.value = false
    }
  }

  // Turning the trash on or off is a different read of the same board.
  async function toggleShowTrashed() {
    _showTrashed.value = !_showTrashed.value
    if (_activeProjectId.value) await reloadBoardQuiet(_activeProjectId.value)
  }

  // Columns keep a sparse 1000-gap ordering; local sort mirrors the server's.
  const boardColumns = computed(() =>
    _board.value ? [..._board.value.columns].sort((a, b) => a.position - b.position) : []
  )

  function columnTasks(columnId: string) {
    return (_board.value?.tasks ?? [])
      .filter(t => t.columnId === columnId)
      .sort((a, b) => a.position - b.position)
  }

  function commentCount(taskId: string) {
    return _commentCounts.value[taskId] ?? 0
  }

  // ─── Label filter ─────────────────────────────────────────

  const boardTagCounts = computed(() => {
    const counts = new Map<string, number>()
    for (const task of _board.value?.tasks ?? []) {
      for (const tag of task.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })

  // A task must carry every selected label, so stacking labels narrows down.
  function visibleColumnTasks(columnId: string) {
    const selected = _activeTags.value
    const tasks = columnTasks(columnId)
    return selected.length === 0
      ? tasks
      : tasks.filter(t => selected.every(tag => t.tags.includes(tag)))
  }

  function toggleTagFilter(tag: string) {
    _activeTags.value = _activeTags.value.includes(tag)
      ? _activeTags.value.filter(t => t !== tag)
      : [..._activeTags.value, tag]
  }

  function clearTagFilter() {
    _activeTags.value = []
  }

  async function addColumn(projectId: string, name: string) {
    const column = await $fetch<ProjectColumn>(`/api/projects/${projectId}/columns`, {
      method: 'POST', headers: realtimeHeaders(),
      body: { name }
    })
    if (_board.value && _activeProjectId.value === projectId) {
      _board.value = { ..._board.value, columns: [..._board.value.columns, column] }
    }
    touchProject(projectId)
    // Which columns read as finished is a fact about the column names, so any
    // change to them re-asks for the board shapes the sidebar counts against.
    await syncProjects()
    return column
  }

  // Colours the column's dot, or clears it back to the one its name implies.
  async function setColumnColor(id: string, color: string | null) {
    const updated = await $fetch<ProjectColumn>(`/api/columns/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { color }
    })
    patchBoardColumn(updated)
    return updated
  }

  async function renameColumn(id: string, name: string) {
    const updated = await $fetch<ProjectColumn>(`/api/columns/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { name }
    })
    patchBoardColumn(updated)
    await syncProjects()
    return updated
  }

  async function moveColumn(id: string, beforeId: string | null, afterId: string | null) {
    const updated = await $fetch<ProjectColumn>(`/api/columns/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { beforeId, afterId }
    })
    patchBoardColumn(updated)
    // Positions were possibly renumbered server-side; cheap reload keeps truth.
    if (updated.projectId) await reloadBoardQuiet(updated.projectId)
    await syncProjects()
    return updated
  }

  // Moves a column to the board's trash; calling it again on a column already
  // in the trash is what removes it for good. The server relocates its tasks to
  // a neighbour on the way out, so the board is re-read rather than patched —
  // guessing at which cards moved where is how the two fall out of step.
  async function deleteColumn(id: string) {
    const res = await $fetch<{ ok: boolean, permanent: boolean, movedToColumnId: string | null }>(`/api/columns/${id}`, {
      method: 'DELETE', headers: realtimeHeaders()
    })
    if (_activeProjectId.value) await reloadBoardQuiet(_activeProjectId.value)
    await syncProjects()
    return res
  }

  async function restoreColumn(id: string) {
    const res = await $fetch<{ ok: boolean, restoredTasks: number }>(`/api/columns/${id}/restore`, {
      method: 'POST', headers: realtimeHeaders()
    })
    if (_activeProjectId.value) await reloadBoardQuiet(_activeProjectId.value)
    await syncProjects()
    return res
  }

  function patchBoardColumn(column: ProjectColumn) {
    if (!_board.value) return
    const columns = [..._board.value.columns]
    const idx = columns.findIndex(c => c.id === column.id)
    if (idx >= 0) columns[idx] = column
    _board.value = { ..._board.value, columns }
  }

  // Reads a board without making it the open one. The AI chat inspects boards
  // the user is not looking at, and loadBoard would swap the board under them
  // while the route still points at the old one.
  function fetchBoard(projectId: string) {
    return $fetch<BoardPayload>(`/api/projects/${projectId}/board`)
  }

  function isTrashed(row: { deletedAt?: number | null }) {
    return row.deletedAt != null
  }

  async function reloadBoardQuiet(projectId: string) {
    try {
      const board = await $fetch<BoardPayload>(boardUrl(projectId))
      if (_activeProjectId.value === projectId) {
        _board.value = { columns: board.columns, tasks: board.tasks }
        _commentCounts.value = board.commentCounts ?? {}
        _trashedCount.value = board.trashedCount ?? 0
      }
    } catch { /* board may be gone; leave state as-is */ }
  }

  async function createTask(projectId: string, columnId: string, title: string, description = '', tags: string[] = []) {
    const task = await $fetch<ProjectTask>(`/api/projects/${projectId}/tasks`, {
      method: 'POST', headers: realtimeHeaders(),
      body: { columnId, title, description, tags }
    })
    upsertBoardTask(task)
    upsertSearchRow(task)
    touchProject(projectId)
    return task
  }

  async function updateTask(id: string, patch: { title?: string, description?: string, tags?: string[] }) {
    const task = await $fetch<ProjectTask>(`/api/tasks/${id}`, { method: 'PUT', headers: realtimeHeaders(), body: patch })
    upsertBoardTask(task)
    upsertSearchRow(task)
    touchProject(task.projectId)
    return task
  }

  async function moveTask(id: string, columnId: string, beforeId: string | null, afterId: string | null) {
    const task = await $fetch<ProjectTask>(`/api/tasks/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { columnId, beforeId, afterId }
    })
    upsertBoardTask(task)
    upsertSearchRow(task)
    touchProject(task.projectId)
    // The server may have spread the column's positions to make room, which
    // moves siblings this response says nothing about.
    await reloadBoardQuiet(task.projectId)
    return task
  }

  // First call trashes the card, second removes it for good — the same two
  // stages a note has. The card leaves the search index either way: a trashed
  // task is not something a global search should be able to open.
  async function deleteTask(id: string) {
    const res = await $fetch<{ ok: boolean, permanent: boolean }>(`/api/tasks/${id}`, {
      method: 'DELETE', headers: realtimeHeaders()
    })
    removeSearchRow(id)

    if (_showTrashed.value && !res.permanent) {
      // The trash is on screen, so the card stays put and goes grey instead of
      // vanishing — a re-read is the cheapest way to get its deletedAt stamp.
      if (_activeProjectId.value) await reloadBoardQuiet(_activeProjectId.value)
      return res
    }

    removeBoardTask(id)
    if (!res.permanent) _trashedCount.value += 1
    else _trashedCount.value = Math.max(0, _trashedCount.value - 1)
    const { [id]: _dropped, ...rest } = _commentCounts.value
    _commentCounts.value = rest
    return res
  }

  async function restoreTask(id: string) {
    const res = await $fetch<{ ok: boolean, task: ProjectTask, restoredColumn: string | null }>(
      `/api/tasks/${id}/restore`,
      { method: 'POST', headers: realtimeHeaders() }
    )
    if (res.task) upsertSearchRow(res.task)
    if (_activeProjectId.value) await reloadBoardQuiet(_activeProjectId.value)
    return res
  }

  async function loadComments(taskId: string) {
    _commentsTaskId.value = taskId
    const comments = await $fetch<TaskComment[]>(`/api/tasks/${taskId}/comments`)
    if (_commentsTaskId.value === taskId) {
      _comments.value = comments
      _commentCounts.value = { ..._commentCounts.value, [taskId]: comments.length }
    }
    return comments
  }

  async function addComment(taskId: string, body: string) {
    const comment = await $fetch<TaskComment>(`/api/tasks/${taskId}/comments`, {
      method: 'POST', headers: realtimeHeaders(),
      body: { body }
    })
    _comments.value = [..._comments.value, comment]
    _commentCounts.value = { ..._commentCounts.value, [taskId]: (_commentCounts.value[taskId] ?? 0) + 1 }
    return comment
  }

  function clearComments() {
    _comments.value = []
    _commentsTaskId.value = null
  }

  // Merged hits for the global search modal: tasks first (title boost), then
  // projects. Resolved back to rows by prefixed id (`task:` / `project:`).
  // What a `#tag` in the search box can match on a board. Boards do not carry
  // note tags, so a task answers with its labels plus the words of its board's
  // name — which is how `#sanitairkamer` finds the Sanitairkamer board's work.
  function taskTagPool(row: TaskSearchRow): string[] {
    return [...row.tags, ...row.projectName.toLowerCase().split(/[^\w]+/).filter(Boolean)]
  }

  function projectTagPool(project: Project): string[] {
    return project.name.toLowerCase().split(/[^\w]+/).filter(Boolean)
  }

  function searchBoards(
    query: string,
    filterTags: TagRequirement[] = []
  ): { tasks: TaskSearchRow[], projects: Project[] } {
    // Tags on their own are a filter, not a search: with no words to match,
    // every task the tags allow is a hit, newest first.
    if (!query.trim()) {
      if (filterTags.length === 0) return { tasks: [], projects: [] }
      return {
        tasks: _allTasks.value.filter(row => matchesTagRequirements(taskTagPool(row), filterTags)).slice(0, 5),
        projects: _projects.value.filter(p => matchesTagRequirements(projectTagPool(p), filterTags)).slice(0, 3)
      }
    }
    if (!_search) return { tasks: [], projects: [] }

    const hits = _search.search(query, { prefix: true, fuzzy: 0.2 })
    const tasks: TaskSearchRow[] = []
    const projectIds: string[] = []
    for (const hit of hits) {
      if (hit.id.startsWith('task:')) {
        const row = _allTasks.value.find(t => `task:${t.id}` === hit.id)
        if (row && matchesTagRequirements(taskTagPool(row), filterTags)) tasks.push(row)
      } else {
        const id = hit.id.slice('project:'.length)
        const project = _projects.value.find(p => p.id === id)
        if (project && matchesTagRequirements(projectTagPool(project), filterTags)) projectIds.push(id)
      }
    }
    return {
      tasks: tasks.slice(0, 5),
      projects: projectIds.map(id => _projects.value.find(p => p.id === id)!).filter(Boolean).slice(0, 3)
    }
  }

  return {
    ready: _ready,
    projects: _projects,
    allTasks: _allTasks,
    activeProject,
    activeProjectId: _activeProjectId,
    board: _board,
    boardColumns,
    boardLoading: _boardLoading,
    comments: _comments,
    commentsTaskId: _commentsTaskId,
    load,
    refresh,
    syncProjects,
    reloadBoardQuiet,
    createProject,
    renameProject,
    updateProjectSharing,
    deleteProject,
    loadBoard,
    fetchBoard,
    columnTasks,
    visibleColumnTasks,
    commentCount,
    activeTags: _activeTags,
    boardTagCounts,
    toggleTagFilter,
    clearTagFilter,
    labelColors,
    labelColor,
    setLabelColor,
    showTrashed: _showTrashed,
    trashedCount: _trashedCount,
    toggleShowTrashed,
    isTrashed,
    addColumn,
    renameColumn,
    setColumnColor,
    moveColumn,
    deleteColumn,
    restoreColumn,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    restoreTask,
    loadComments,
    addComment,
    clearComments,
    searchBoards
  }
}
