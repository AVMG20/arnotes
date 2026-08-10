import { computed, ref, shallowRef, type Ref } from 'vue'
import type MiniSearch from 'minisearch'
import { reciprocalRankFusion, type ScoredId } from '~/utils/embedding'

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

/**
 * Semantic hits for the sidebar's search box. Populated by `initNotesStore` once
 * the app is running; stays empty when semantic search is off, which makes every
 * fusion below collapse back to plain keyword results.
 */
let _sidebarSemanticHits: Ref<ScoredId[]> = shallowRef([])

/**
 * How much a vector hit is worth against a keyword hit of the same rank. Below 1
 * so that an exact keyword match still wins when both engines find a note, while
 * a note that only matches in meaning can still surface.
 */
const SEMANTIC_WEIGHT = 0.8

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

export function initNotesStore(notes: Note[], search: MiniSearch<SearchDoc>) {
  _search = search
  _notes.value = notes
  _search.addAll(notes.map(toSearchDoc))
  _activeNoteId.value = notes.find(n => !n.deletedAt)?.id ?? null
  _ready.value = true

  const { useSemanticQuery, syncNotes } = useEmbeddings()
  _sidebarSemanticHits = useSemanticQuery(_searchQuery).hits
  // Backfills notes that predate semantic search, were edited elsewhere, or were
  // embedded with a different model. Runs in the background — nothing waits on it.
  void syncNotes(notes)
}

// ─── composable ─────────────────────────────────────────────

export function useNotes() {
  const { queueNote, forgetNote, reset: resetEmbeddings, syncNotes } = useEmbeddings()

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
      return searchNotes(_searchQuery.value, [], _sidebarSemanticHits.value)
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
    queueNote(note)
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
      if (_search.has(id)) _search.discard(id)
      _search.add(toSearchDoc(updated))
    }
    queueNote(updated)
  }

  /**
   * Keyword search, optionally fused with semantic hits for the same query.
   *
   * `semanticHits` comes from `useEmbeddings().useSemanticQuery()`, which resolves
   * asynchronously — passing an empty list (or none at all) simply yields the
   * keyword ranking, so callers never have to wait on the encoder.
   */
  function searchNotes(query: string, filterTags: string[] = [], semanticHits: ScoredId[] = []): Note[] {
    if (!query.trim() || !_search) {
      let pool = activeNotes.value
      if (filterTags.length > 0) {
        pool = pool.filter(n => filterTags.every(t => n.tags.includes(t)))
      }
      return pool
    }

    const matchesTags = (note: Note) =>
      filterTags.length === 0 || filterTags.every(t => note.tags.includes(t))

    const lexicalIds = _search.search(query, {
      filter: result => filterTags.length === 0
        || filterTags.every(t => (result.tags as string[] | undefined)?.includes(t))
    }).map(hit => String(hit.id))

    if (semanticHits.length === 0) {
      return lexicalIds.map(id => notesById.value.get(id)).filter(Boolean) as Note[]
    }

    // The vector index only covers live notes, so semantic hits are filtered
    // against the same tag selection the keyword query already honours.
    const semanticIds = semanticHits
      .map(hit => hit.id)
      .filter((id) => {
        const note = notesById.value.get(id)
        return Boolean(note) && matchesTags(note!)
      })

    return reciprocalRankFusion([
      { ids: lexicalIds, weight: 1 },
      { ids: semanticIds, weight: SEMANTIC_WEIGHT }
    ])
      .map(hit => notesById.value.get(hit.id))
      .filter(Boolean) as Note[]
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
    const res = await $fetch<{ ok: boolean, permanent: boolean, note?: Note }>(
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
          if (_search.has(id)) _search.discard(id)
          _search.add(toSearchDoc(res.note))
        }
      }
      // Trashed notes drop out of the vector index; restoring re-embeds them.
      forgetNote(id)
    } else {
      _notes.value = _notes.value.filter(n => n.id !== id)
      if (_search?.has(id)) _search.discard(id)
      forgetNote(id)
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
        if (_search.has(id)) _search.discard(id)
        _search.add(toSearchDoc(restored))
      }
      queueNote(restored)
    }
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

    // Vectors are per workspace, so the index is rebuilt rather than merged.
    resetEmbeddings()
    void syncNotes(freshNotes)
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
    searchNotes,
    refreshNotes
  }
}
