import { computed, ref } from 'vue'
import { extractCardIds } from '#shared/utils/archiveCards'

// Archive's client half. One rolling conversation, plus a live cache of the
// rows its cards point at.
//
// The cache is what makes cards editable: a card renders whatever is in here
// under its id, so an edit is a PATCH and a local merge — never a model call,
// and never a re-render of the whole transcript.

export interface ArchiveMemory {
  id: string
  title: string
  body: string
  tags: string[]
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface ArchiveTodo {
  id: string
  memoryId: string | null
  title: string
  done: boolean
  doneAt: number | null
  dueAt: number | null
  tags: string[]
  position: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface ArchiveAction {
  name: string
  label: string
}

export interface ArchiveChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions: ArchiveAction[]
  createdAt: number
  /** The assistant is still writing this one. */
  pending?: boolean
  error?: string
}

type StreamEvent
  = | { type: 'delta', text?: string }
    | { type: 'tool', name?: string, label?: string }
    | { type: 'rows', memories?: ArchiveMemory[], todos?: ArchiveTodo[] }
    | { type: 'saved', message?: ArchiveChatMessage, userMessage?: ArchiveChatMessage }
    | { type: 'ping' | 'done' }
    | { type: 'error', message?: string }

// ─── Singleton state ──────────────────────────────────────────────────────────

const _messages = ref<ArchiveChatMessage[]>([])
const _memories = ref<Record<string, ArchiveMemory>>({})
const _todos = ref<Record<string, ArchiveTodo>>({})
const _busy = ref(false)
const _ready = ref(false)
const _loadingMore = ref(false)
const _cursor = ref<string | null>(null)

let _abort: AbortController | null = null
let _loaded = false

function tempId() {
  return `tmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function mergeRows(memories?: ArchiveMemory[], todos?: ArchiveTodo[]) {
  for (const row of memories ?? []) _memories.value[row.id] = row
  for (const row of todos ?? []) _todos.value[row.id] = row
}

/**
 * Fetches the rows behind any card in `text` that this tab has not seen. Called
 * when older messages are paged in — a reply's own rows arrive with its stream.
 */
async function ensureRowsFor(texts: string[]) {
  const memoryIds = new Set<string>()
  const todoIds = new Set<string>()

  for (const text of texts) {
    const found = extractCardIds(text)
    for (const id of found.memoryIds) if (!_memories.value[id]) memoryIds.add(id)
    for (const id of found.todoIds) if (!_todos.value[id]) todoIds.add(id)
  }
  if (!memoryIds.size && !todoIds.size) return

  try {
    const data = await $fetch<{ memories: ArchiveMemory[], todos: ArchiveTodo[] }>('/api/archive/rows', {
      query: { memories: [...memoryIds].join(','), todos: [...todoIds].join(',') }
    })
    mergeRows(data.memories, data.todos)
  } catch {
    // A card with no row draws as "no longer stored", which is the truth.
  }
}

export function useArchive() {
  async function load(force = false) {
    if (_loaded && !force) return
    _loaded = true
    try {
      const data = await $fetch<{ messages: ArchiveChatMessage[], hasMore: boolean, cursor: string | null }>(
        '/api/archive/messages'
      )
      _messages.value = data.messages
      _cursor.value = data.hasMore ? data.cursor : null
      await ensureRowsFor(data.messages.map(m => m.content))
    } catch {
      // Not signed in yet, or the endpoint is unreachable; the page shows empty.
    } finally {
      _ready.value = true
    }
  }

  async function loadMore() {
    if (!_cursor.value || _loadingMore.value) return
    _loadingMore.value = true
    try {
      const data = await $fetch<{ messages: ArchiveChatMessage[], hasMore: boolean, cursor: string | null }>(
        '/api/archive/messages',
        { query: { before: _cursor.value } }
      )
      _messages.value = [...data.messages, ..._messages.value]
      _cursor.value = data.hasMore ? data.cursor : null
      await ensureRowsFor(data.messages.map(m => m.content))
    } catch {
      // Leave the cursor in place so the button can be tried again.
    } finally {
      _loadingMore.value = false
    }
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || _busy.value) return

    _busy.value = true

    _messages.value.push(
      { id: tempId(), role: 'user', content: message, actions: [], createdAt: Date.now() },
      { id: tempId(), role: 'assistant', content: '', actions: [], createdAt: Date.now(), pending: true }
    )

    // Read the pushed rows back out of the array. A ref holds the raw objects
    // and hands out reactive proxies on access — writing to the originals would
    // change the data without ever telling the view, so the whole reply would
    // appear at once when the turn ended instead of streaming.
    const userMessage = _messages.value[_messages.value.length - 2]!
    const reply = _messages.value[_messages.value.length - 1]!

    _abort = new AbortController()

    try {
      const res = await fetch('/api/archive/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, today: new Date().toLocaleDateString('en-CA') }),
        signal: _abort.signal
      })

      if (!res.ok || !res.body) {
        const problem = await res.json().catch(() => null) as { statusMessage?: string, message?: string } | null
        throw new Error(problem?.statusMessage || problem?.message || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let event: StreamEvent
          try {
            event = JSON.parse(line) as StreamEvent
          } catch {
            continue
          }

          if (event.type === 'delta' && event.text) {
            reply.content += event.text
          } else if (event.type === 'tool') {
            reply.actions.push({ name: event.name ?? '', label: event.label ?? '' })
          } else if (event.type === 'rows') {
            mergeRows(event.memories, event.todos)
          } else if (event.type === 'saved') {
            // Swap the optimistic rows for the stored ones, so a later reload
            // shows exactly what is on screen now.
            if (event.userMessage) Object.assign(userMessage, event.userMessage)
            if (event.message) {
              Object.assign(reply, event.message, { pending: true })
            }
          } else if (event.type === 'error') {
            reply.error = event.message || 'Something went wrong.'
          }
        }
      }

      if (!reply.content.trim() && !reply.error) {
        reply.error = 'The assistant returned nothing. Try again.'
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        reply.error = reply.content.trim() ? '' : 'Stopped.'
      } else {
        reply.error = error instanceof Error ? error.message : 'Something went wrong.'
      }
    } finally {
      reply.pending = false
      _busy.value = false
      _abort = null
    }
  }

  function stop() {
    _abort?.abort()
  }

  async function clear() {
    await $fetch('/api/archive/messages', { method: 'DELETE' })
    _messages.value = []
    _cursor.value = null
  }

  // ─── Card edits ─────────────────────────────────────────────────────────────

  async function saveMemory(id: string, patch: { title?: string, body?: string, tags?: string[] }) {
    const current = _memories.value[id]
    const row = await $fetch<ArchiveMemory>(`/api/archive/memories/${id}`, {
      method: 'PATCH',
      body: { ...patch, updatedAt: current?.updatedAt }
    })
    _memories.value[id] = row
    return row
  }

  async function forgetMemory(id: string) {
    const row = await $fetch<ArchiveMemory>(`/api/archive/memories/${id}`, { method: 'DELETE' })
    _memories.value[id] = row
  }

  async function saveTodo(id: string, patch: { title?: string, done?: boolean, dueAt?: number | null }) {
    const current = _todos.value[id]
    const row = await $fetch<ArchiveTodo>(`/api/archive/todos/${id}`, {
      method: 'PATCH',
      body: { ...patch, updatedAt: current?.updatedAt }
    })
    _todos.value[id] = row
    return row
  }

  async function dropTodo(id: string) {
    const row = await $fetch<ArchiveTodo>(`/api/archive/todos/${id}`, { method: 'DELETE' })
    _todos.value[id] = row
  }

  /** Replaces a cached row after a 409, so the card can redraw on the truth. */
  function adoptConflict(kind: 'memory' | 'todo', row: ArchiveMemory | ArchiveTodo) {
    if (kind === 'memory') _memories.value[row.id] = row as ArchiveMemory
    else _todos.value[row.id] = row as ArchiveTodo
  }

  return {
    messages: _messages,
    memories: _memories,
    todos: _todos,
    busy: _busy,
    ready: _ready,
    loadingMore: _loadingMore,
    hasMore: computed(() => _cursor.value !== null),
    load,
    loadMore,
    send,
    stop,
    clear,
    saveMemory,
    forgetMemory,
    saveTodo,
    dropTodo,
    adoptConflict
  }
}
