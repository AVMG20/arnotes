import { computed, ref } from 'vue'
import type MiniSearch from 'minisearch'
import { markdownToHtml } from '~/utils/markdown'
import { realtimeHeaders } from '~/composables/useRealtime'

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  attachments: string[]
  isPublic: boolean
  publicUntil: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

type SearchDoc = Note & { tagsText: string, contentText: string }

// Module-level singleton state
const _notes = ref<Note[]>([])
const _activeNoteId = ref<string | null>(null)
const _activeTag = ref<string | null>(null)
const _showTrash = ref(false)
const _showShared = ref(false)
const _searchQuery = ref('')
const _ready = ref(false)
const _recentTags = ref<string[]>([])
const _autoFocus = ref(false)

let _search: MiniSearch<SearchDoc> | null = null

// ─── helpers ────────────────────────────────────────────────

const notesById = computed(() =>
  new Map(_notes.value.map(n => [n.id, n]))
)

export function extractTags(html: string): string[] {
  const cleaned = html
    .replace(/<pre[\s\S]*?<\/pre>/gi, '')
    .replace(/<code[\s\S]*?<\/code>/gi, '')
    .replace(/<[^>]+>/g, ' ')
  const matches = cleaned.match(/#([a-zA-Z][a-zA-Z0-9_]*)/g) ?? []
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))]
}

export function extractTitle(html: string): string {
  if (!html || !import.meta.client) return 'Untitled'
  const el = document.createElement('div')
  el.innerHTML = html
  const first = el.querySelector('h1,h2,h3,h4,p,li,blockquote,pre')
  const text = ((first ?? el).textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 80) || 'Untitled'
}

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Rewrites the leading heading of a note so a rename stays in sync with the
// body: titles are always derived from content, never stored independently.
export function setTitleInContent(html: string, title: string): string {
  if (!import.meta.client) return html
  const el = document.createElement('div')
  el.innerHTML = html
  const heading = el.querySelector('h1,h2,h3,h4')
  if (heading) heading.textContent = title
  else el.insertAdjacentHTML('afterbegin', `<h1>${escapeHtmlText(title)}</h1>`)
  return el.innerHTML
}

function toSearchDoc(note: Note) {
  return {
    ...note,
    tagsText: note.tags.join(' '),
    contentText: note.content.replace(/<[^>]+>/g, ' ')
  }
}

function reindex(note: Note) {
  if (!_search) return
  if (_search.has(note.id)) _search.discard(note.id)
  _search.add(toSearchDoc(note))
}

function unindex(id: string) {
  if (_search?.has(id)) _search.discard(id)
}

// Single place where a note row is swapped in the store, so the search index
// never drifts from the list.
function upsertNote(note: Note) {
  const idx = _notes.value.findIndex(n => n.id === note.id)
  if (idx < 0) _notes.value = [note, ..._notes.value]
  else {
    const next = [..._notes.value]
    next[idx] = note
    _notes.value = next
  }
  reindex(note)
}

function removeNote(id: string) {
  _notes.value = _notes.value.filter(n => n.id !== id)
  unindex(id)
}

// ─── init (called from plugin) ──────────────────────────────

export function initNotesStore(notes: Note[], search: MiniSearch<SearchDoc>) {
  _search = search
  _notes.value = notes
  _search.addAll(notes.map(toSearchDoc))
  _activeNoteId.value = notes.find(n => !n.deletedAt)?.id ?? null
  _ready.value = true
}

// ─── composable ─────────────────────────────────────────────

export function useNotes() {
  const activeNotes = computed(() => _notes.value.filter(n => !n.deletedAt))
  const trashedNotes = computed(() => _notes.value.filter(n => n.deletedAt !== null))
  const sharedNotes = computed(() => activeNotes.value.filter(note =>
    note.isPublic && (note.publicUntil === null || note.publicUntil > Date.now())
  ))

  const allTags = computed(() => {
    const counts = new Map<string, number>()
    const latest = new Map<string, number>()
    for (const n of activeNotes.value) {
      for (const t of n.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
        if (n.updatedAt > (latest.get(t) ?? 0)) latest.set(t, n.updatedAt)
      }
    }
    return [...counts.keys()]
      .map(tag => ({ tag, count: counts.get(tag)!, latestUpdatedAt: latest.get(tag)! }))
      .sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt)
  })

  const filteredNotes = computed(() => {
    if (_searchQuery.value.trim() && _search) {
      const hits = _search.search(_searchQuery.value)
      return hits
        .map(h => notesById.value.get(String(h.id)))
        .filter((n): n is Note => !!n && !n.deletedAt)
    }
    const pool = _showTrash.value
      ? trashedNotes.value
      : _showShared.value
        ? sharedNotes.value
        : _activeTag.value
          ? activeNotes.value.filter(n => n.tags.includes(_activeTag.value!))
          : activeNotes.value
    return [...pool].sort((a, b) => b.updatedAt - a.updatedAt)
  })

  const activeNote = computed(() =>
    _notes.value.find(n => n.id === _activeNoteId.value) ?? null
  )

  function getNote(id: string | null | undefined): Note | null {
    return id ? notesById.value.get(id) ?? null : null
  }

  function trackTagClick(tag: string) {
    _recentTags.value = [tag, ..._recentTags.value.filter(t => t !== tag)].slice(0, 5)
  }

  async function createNote(options?: { title?: string, content?: string, tags?: string[], select?: boolean }) {
    const titleText = options?.title?.trim()
    const tags = options?.tags ?? (_activeTag.value ? [_activeTag.value] : [])

    let content = `<h1>${escapeHtmlText(titleText ?? '')}</h1>`
    for (const tag of tags) content += `<p>#${tag}</p>`
    if (options?.content) content += markdownToHtml(options.content)

    const note = await $fetch<Note>('/api/notes', {
      method: 'POST', headers: realtimeHeaders(),
      body: { title: titleText || 'Untitled', content, tags }
    })
    upsertNote(note)
    // Background creation (AI chat) must not steal the user's current note.
    if (options?.select !== false) {
      _activeNoteId.value = note.id
      _searchQuery.value = ''
      _autoFocus.value = true
    }
    return note
  }

  async function updateNote(id: string, content: string) {
    if (!notesById.value.has(id)) return
    const updated = await $fetch<Note>(`/api/notes/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { content, tags: extractTags(content), title: extractTitle(content) }
    })
    upsertNote(updated)
    return updated
  }

  // Renames by rewriting the note's leading heading — titles are derived from
  // content, so patching the title column alone would be undone by the next
  // content save.
  async function renameNote(id: string, title: string) {
    const note = getNote(id)
    if (!note) return
    const trimmed = title.trim()
    if (trimmed === note.title) return
    return updateNote(id, setTitleInContent(note.content, trimmed))
  }

  function searchNotes(query: string, filterTags: string[] = []): Note[] {
    let pool: Note[]
    if (query.trim() && _search) {
      const hits = _search.search(query, {
        filter: result => filterTags.length === 0
          || filterTags.every(t => (result.tags as string[] | undefined)?.includes(t))
      })
      pool = hits.map(h => notesById.value.get(String(h.id))).filter((n): n is Note => !!n)
    } else {
      pool = _notes.value.filter(n => !n.deletedAt)
      if (filterTags.length > 0) {
        pool = pool.filter(n => filterTags.every(t => n.tags.includes(t)))
      }
    }
    return pool.filter(n => !n.deletedAt)
  }

  async function updateSharing(id: string, isPublic: boolean, publicUntil: number | null): Promise<Note> {
    if (!notesById.value.has(id)) throw new Error('Note not found')
    const updated = await $fetch<Note>(`/api/notes/${id}`, {
      method: 'PUT', headers: realtimeHeaders(),
      body: { isPublic, publicUntil }
    })
    upsertNote(updated)
    return updated
  }

  async function deleteNote(id: string) {
    const res = await $fetch<{ ok: boolean, permanent: boolean, note?: Note }>(
      `/api/notes/${id}`,
      { method: 'DELETE', headers: realtimeHeaders() }
    )

    if (!res.permanent && res.note) {
      upsertNote(res.note)
    } else {
      removeNote(id)
    }
    if (_activeNoteId.value === id) {
      _activeNoteId.value = activeNotes.value[0]?.id ?? null
    }
    return res
  }

  async function restoreNote(id: string) {
    const restored = await $fetch<Note>(`/api/notes/${id}/restore`, { method: 'POST', headers: realtimeHeaders() })
    upsertNote(restored)
    return restored
  }

  // Reloads the note list for whatever workspace is now active. Filters are reset
  // because tags and trash from the previous workspace do not carry over.
  async function refreshNotes() {
    let freshNotes: Note[] = []
    try {
      freshNotes = await $fetch<Note[]>('/api/notes')
    } catch {
      freshNotes = []
    }

    _notes.value = freshNotes
    if (_search) {
      _search.removeAll()
      _search.addAll(freshNotes.map(toSearchDoc))
    }
    _activeNoteId.value = freshNotes.find(n => !n.deletedAt)?.id ?? null
    _activeTag.value = null
    _searchQuery.value = ''
    _showTrash.value = false
    _showShared.value = false
  }

  // Pulls the server's copy of the list in without moving the user: the open
  // note, the tag filter and the trash view all stay put. This is what the
  // realtime feed calls when someone else — an agent over MCP, a teammate,
  // another tab — writes to this workspace.
  async function syncNotes() {
    const fresh = await $fetch<Note[]>('/api/notes')
    _notes.value = fresh
    if (_search) {
      _search.removeAll()
      _search.addAll(fresh.map(toSearchDoc))
    }
  }

  return {
    ready: _ready,
    notes: _notes,
    activeNotes,
    trashedNotes,
    sharedNotes,
    activeNote,
    activeNoteId: _activeNoteId,
    activeTag: _activeTag,
    showTrash: _showTrash,
    showShared: _showShared,
    searchQuery: _searchQuery,
    recentTags: _recentTags,
    allTags,
    filteredNotes,
    trackTagClick,
    autoFocus: _autoFocus,
    getNote,
    createNote,
    updateNote,
    renameNote,
    updateSharing,
    deleteNote,
    restoreNote,
    searchNotes,
    refreshNotes,
    syncNotes
  }
}
