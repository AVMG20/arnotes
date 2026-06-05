import { ref, computed } from 'vue'

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  attachments: string[]
  isPublic: boolean
  createdAt: number
  updatedAt: number
}

// Module-level singleton state
const _notes = ref<Note[]>([])
const _activeNoteId = ref<string | null>(null)
const _activeTag = ref<string | null>(null)
const _searchQuery = ref('')
const _ready = ref(false)
const _recentTags = ref<string[]>([])
const _autoFocus = ref(false)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _search: any = null

// ─── helpers ────────────────────────────────────────────────

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

function persist() {
  // no-op — db is server-side; this is only needed to satisfy the helper signature
}
void persist

// ─── init (called from plugin) ──────────────────────────────

export function initNotesStore(notes: Note[], search: unknown) {
  _search = search
  _notes.value = notes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(_search as any).addAll(notes.map(toSearchDoc))
  _activeNoteId.value = notes[0]?.id ?? null
  _ready.value = true
}

// ─── composable ─────────────────────────────────────────────

export function useNotes() {
  const allTags = computed(() => {
    const counts = new Map<string, number>()
    for (const n of _notes.value)
      for (const t of n.tags)
        counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  })

  const filteredNotes = computed(() => {
    if (_searchQuery.value.trim() && _search) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hits = (_search as any).search(_searchQuery.value) as any[]
      return hits.map((h: any) => _notes.value.find(n => n.id === h.id)).filter(Boolean) as Note[]
    }
    const pool = _activeTag.value
      ? _notes.value.filter(n => n.tags.includes(_activeTag.value!))
      : [..._notes.value]
    return pool.sort((a, b) => b.updatedAt - a.updatedAt)
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

    // Always start with an H1 so the user lands on it immediately
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
      try { _search.discard(id) }
      catch {}
      _search.add(toSearchDoc(updated))
    }
  }

  function searchNotes(query: string): Note[] {
    if (!query.trim() || !_search) return [..._notes.value]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits = (_search as any).search(query) as any[]
    return hits.map((h: any) => _notes.value.find(n => n.id === h.id)).filter(Boolean) as Note[]
  }

  async function togglePublic(id: string): Promise<Note> {
    const idx = _notes.value.findIndex(n => n.id === id)
    if (idx < 0) throw new Error('Note not found')
    const current = _notes.value[idx]
    const updated = await $fetch<Note>(`/api/notes/${id}`, {
      method: 'PUT',
      body: { isPublic: !current.isPublic }
    })
    const next = [..._notes.value]
    next[idx] = updated
    _notes.value = next
    return updated
  }

  async function deleteNote(id: string) {
    await $fetch(`/api/notes/${id}`, { method: 'DELETE' })
    _notes.value = _notes.value.filter(n => n.id !== id)
    try { _search?.discard(id) }
    catch {}
    if (_activeNoteId.value === id) {
      _activeNoteId.value = _notes.value[0]?.id ?? null
    }
  }

  return {
    ready: _ready,
    notes: _notes,
    activeNote,
    activeNoteId: _activeNoteId,
    activeTag: _activeTag,
    searchQuery: _searchQuery,
    recentTags: _recentTags,
    allTags,
    filteredNotes,
    trackTagClick,
    autoFocus: _autoFocus,
    createNote,
    updateNote,
    togglePublic,
    deleteNote,
    searchNotes
  }
}
