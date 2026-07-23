import {computed, ref} from 'vue'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _search: any = null

// ─── helpers ────────────────────────────────────────────────

// Build once, outside the function or memoized
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

function toSearchDoc(note: Note) {
  return {
    ...note,
    tagsText: note.tags.join(' '),
    contentText: note.content.replace(/<[^>]+>/g, ' ')
  }
}

// ─── init (called from plugin) ──────────────────────────────

export function initNotesStore(notes: Note[], search: unknown) {
  _search = search
  _notes.value = notes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(_search as any).addAll(notes.map(toSearchDoc))
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
          const hits = (_search as any).search(_searchQuery.value) as any[]
          return hits.map((h: any) => notesById.value.get(h.id)).filter(Boolean) as Note[]
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

  function trackTagClick(tag: string) {
    _recentTags.value = [tag, ..._recentTags.value.filter(t => t !== tag)].slice(0, 5)
  }

  async function createNote(options?: { title?: string }) {
    const titleText = options?.title?.trim()
    const activeTagVal = _activeTag.value

    let content = titleText ? `<h1>${titleText}</h1>` : '<h1></h1>'
    if (activeTagVal) content += `<p>#${activeTagVal}</p>`

    const tags = activeTagVal ? [activeTagVal] : []
    const title = titleText || 'Untitled'

    const note = await $fetch<Note>('/api/notes', {
      method: 'POST',
      body: { title, content, tags }
    })
    _notes.value = [note, ..._notes.value]
    _activeNoteId.value = note.id
    _searchQuery.value = ''
    _autoFocus.value = true
    _search?.add(toSearchDoc(note))
  }

  async function updateNote(id: string, content: string) {
    const idx = _notes.value.findIndex(n => n.id === id)
    if (idx < 0) return
    const tags = extractTags(content)
    const title = extractTitle(content)
    const updated = await $fetch<Note>(`/api/notes/${id}`, {
      method: 'PUT',
      body: { content, tags, title }
    })
    const next = [..._notes.value]
    next[idx] = updated
    _notes.value = next
    if (_search) {
      try { _search.discard(id) } catch {}
      _search.add(toSearchDoc(updated))
    }
  }

    function searchNotes(query: string, filterTags: string[] = []): Note[] {
        let pool: Note[]
        if (query.trim() && _search) {
            const options: Record<string, unknown> = {}
            if (filterTags.length > 0) {
                options.filter = (result: any) =>
                    filterTags.every(t => (result.tags as string[])?.includes(t))
            }
            const hits = (_search as any).search(query, options) as any[]
            pool = hits.map((h: any) => notesById.value.get(h.id)).filter(Boolean) as Note[]
        } else {
            pool = activeNotes.value
            if (filterTags.length > 0) {
                pool = pool.filter(n => filterTags.every(t => n.tags.includes(t)))
            }
        }
        return pool
    }

  async function updateSharing(id: string, isPublic: boolean, publicUntil: number | null): Promise<Note> {
    const idx = _notes.value.findIndex(n => n.id === id)
    if (idx < 0) throw new Error('Note not found')
    const updated = await $fetch<Note>(`/api/notes/${id}`, {
      method: 'PUT',
      body: { isPublic, publicUntil }
    })
    const next = [..._notes.value]
    next[idx] = updated
    _notes.value = next
    return updated
  }

  async function deleteNote(id: string) {
    const res = await $fetch<{ ok: boolean; permanent: boolean; note?: Note }>(
      `/api/notes/${id}`,
      { method: 'DELETE' }
    )

    if (!res.permanent && res.note) {
      const idx = _notes.value.findIndex(n => n.id === id)
      if (idx >= 0) {
        const next = [..._notes.value]
        next[idx] = res.note
        _notes.value = next
        if (_search) {
          try { _search.discard(id) } catch {}
          _search.add(toSearchDoc(res.note))
        }
      }
    } else {
      _notes.value = _notes.value.filter(n => n.id !== id)
      try { _search?.discard(id) } catch {}
      if (_activeNoteId.value === id) {
        _activeNoteId.value = activeNotes.value[0]?.id ?? null
      }
    }
  }

  async function restoreNote(id: string) {
    const restored = await $fetch<Note>(`/api/notes/${id}/restore`, { method: 'POST' })
    const idx = _notes.value.findIndex(n => n.id === id)
    if (idx >= 0) {
      const next = [..._notes.value]
      next[idx] = restored
      _notes.value = next
      if (_search) {
        try { _search.discard(id) } catch {}
        _search.add(toSearchDoc(restored))
      }
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
    createNote,
    updateNote,
    updateSharing,
    deleteNote,
    restoreNote,
    searchNotes
  }
}
