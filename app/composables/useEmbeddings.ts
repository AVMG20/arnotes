import { computed, effectScope, ref, shallowRef, watch, type Ref } from 'vue'
import {
  decodeVector,
  noteEmbeddingHash,
  similarity,
  type ScoredId
} from '#shared/utils/embedding'
import { EMBEDDING_MIN_SCORE, EMBEDDING_MODEL_LABEL, EMBEDDING_RANK_BAND } from '#shared/utils/embedding-model'
import type { Note } from '~/composables/useNotes'

/**
 * The client half of semantic search.
 *
 * The encoder itself runs on the server (`server/utils/embedder.ts`), which also
 * writes a vector for every note as it is saved. This module holds those vectors
 * in memory and does the ranking: a cosine over a few thousand 768-dimension
 * vectors is a millisecond of work, so keeping it here means search reacts to
 * keystrokes without a request per keystroke. The only thing it asks the server
 * for is the vector of the query itself.
 *
 * Nothing here downloads or runs a model. An earlier version did, and the tab
 * grew from ~200 MB to ~1.3 GB for the privilege.
 */

export type EmbeddingStatus
  = | 'disabled'
    | 'idle'
    /** The server still owes vectors for some notes. */
    | 'indexing'
    | 'ready'
    | 'error'

interface IndexedVector {
  vector: Float32Array
  hash: string
}

/** How many semantic hits are fused into the keyword ranking. */
const SEMANTIC_LIMIT = 30
/** Query embeddings are cheap to keep and users retype the same searches. */
const QUERY_CACHE_SIZE = 32
/** Above this, asking for specific ids costs more than refetching the lot. */
const MAX_ID_REFRESH = 100
/** Poll schedule while waiting on the server to catch up, in milliseconds. */
const REFRESH_BACKOFF = [1500, 3000, 6000, 12000, 30000]
/** Fruitless polls before giving up until something changes. Roughly two minutes. */
const MAX_REFRESH_ATTEMPTS = 8

// ─── Module-level singleton state ───────────────────────────

const _status = ref<EmbeddingStatus>('idle')
const _error = ref<string | null>(null)
const _pending = ref(0)
const _indexedCount = ref(0)
/** Bumped whenever the index changes so search computeds re-evaluate. */
const _version = ref(0)

const vectors = new Map<string, IndexedVector>()
const queryCache = new Map<string, Float32Array>()

/**
 * The hash each note's vector should have, from the note text the client is
 * holding. A note whose entry here does not match `vectors` is one the server has
 * not finished embedding — the same comparison the server makes, which is why the
 * hash lives in `shared/`.
 */
const expected = new Map<string, string>()

let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshAttempt = 0
/** Whether the last poll found the server still had notes queued. */
let lastServerBusy = false
let storedVectorsLoaded = false
let enabledWatcherInstalled = false
/**
 * The last note list handed to `syncNotes`, kept so the index can be rebuilt when
 * the feature is switched back on without waiting for a reload.
 */
let lastSyncedNotes: Note[] = []

/** Both the instance switch and the account preference have to be on. */
function isEnabled(): boolean {
  return useRuntimeConfig().public.embeddingsEnabled !== false
    && useUserSettings().semanticSearchEnabled.value
}

// ─── Persistence ────────────────────────────────────────────

interface StoredEmbedding {
  id: string
  embedding: string | null
  hash: string | null
}

interface EmbeddingsResponse {
  items: StoredEmbedding[]
  /** Notes the server still has queued, across the whole instance. */
  pending: number
}

/**
 * Folds fetched vectors into the index. Returns how many actually changed, so a
 * poll that came back with the same vectors it already had is not mistaken for
 * progress.
 */
function ingest(items: StoredEmbedding[]): number {
  let changed = 0
  for (const row of items) {
    if (!row.embedding || !row.hash) continue
    if (vectors.get(row.id)?.hash === row.hash) continue
    try {
      vectors.set(row.id, { vector: decodeVector(row.embedding), hash: row.hash })
      changed++
    } catch {
      // A corrupt vector just means this note stays unranked until it is rewritten.
    }
  }

  if (changed > 0) {
    _indexedCount.value = vectors.size
    _version.value++
  }
  return changed
}

/** Ids whose stored vector is older than the note text the client is showing. */
function staleIds(): string[] {
  const stale: string[] = []
  for (const [id, hash] of expected) {
    if (vectors.get(id)?.hash !== hash) stale.push(id)
  }
  return stale
}

function updatePending() {
  _pending.value = staleIds().length
  if (_status.value !== 'error') _status.value = _pending.value > 0 ? 'indexing' : 'ready'
}

async function fetchVectors(ids?: string[]): Promise<{ changed: number, serverBusy: boolean }> {
  const query = ids && ids.length > 0 && ids.length <= MAX_ID_REFRESH
    ? `?ids=${ids.map(encodeURIComponent).join(',')}`
    : ''
  try {
    const response = await $fetch<EmbeddingsResponse>(`/api/embeddings${query}`)
    return { changed: ingest(response.items), serverBusy: response.pending > 0 }
  } catch {
    return { changed: 0, serverBusy: false }
  }
}

async function loadStoredVectors() {
  if (storedVectorsLoaded) return
  storedVectorsLoaded = true
  await fetchVectors()
}

// ─── Waiting on the server ──────────────────────────────────

/**
 * Polls for vectors the server has not written yet.
 *
 * A note is embedded a moment after it is saved, and nothing pushes that back to
 * the client, so the index would otherwise stay stale until the next reload. The
 * interval backs off because the common case is one note finishing in a second or
 * two and the uncommon case is a first-run backfill of the whole library, which
 * should not be polled at a fixed short interval for minutes on end.
 *
 * Polling stops after `MAX_REFRESH_ATTEMPTS` fruitless rounds. At that point the
 * server is either still chewing through a large backfill or has given up on
 * these notes, and neither is worth a request every thirty seconds for the rest
 * of the session — the next save, or the next reload, starts it again.
 */
function scheduleRefresh(immediate = false) {
  if (!isEnabled() || refreshTimer) return
  // A server that still reports queued work is worth waiting on, however long a
  // first-run backfill takes; the interval has already backed off to its cap.
  if (refreshAttempt >= MAX_REFRESH_ATTEMPTS && !lastServerBusy) return

  const stale = staleIds()
  if (stale.length === 0) {
    refreshAttempt = 0
    return
  }

  const delay = immediate ? 0 : REFRESH_BACKOFF[Math.min(refreshAttempt, REFRESH_BACKOFF.length - 1)]!
  refreshTimer = setTimeout(async () => {
    refreshTimer = null
    if (!isEnabled()) return

    // No new vectors means the server is still working, so wait longer next time.
    const { changed, serverBusy } = await fetchVectors(stale)
    refreshAttempt = changed > 0 ? 0 : refreshAttempt + 1
    lastServerBusy = serverBusy

    updatePending()
    scheduleRefresh()
  }, delay)
}

function cancelRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  refreshAttempt = 0
  lastServerBusy = false
}

// ─── Index maintenance ──────────────────────────────────────

/** Clears the index, for a workspace switch or when the feature is turned off. */
function reset() {
  cancelRefresh()
  vectors.clear()
  expected.clear()
  queryCache.clear()
  storedVectorsLoaded = false
  _pending.value = 0
  _indexedCount.value = 0
  _version.value++
}

/**
 * Points the index at the current set of notes and pulls in whatever vectors the
 * server already has for them.
 */
async function syncNotes(notes: Note[]) {
  lastSyncedNotes = notes
  if (!isEnabled()) return

  expected.clear()
  const live = new Set<string>()
  for (const note of notes) {
    if (note.deletedAt) continue
    live.add(note.id)
    expected.set(note.id, noteEmbeddingHash(note))
  }

  // Drop vectors for notes that no longer exist in this workspace.
  for (const id of [...vectors.keys()]) {
    if (!live.has(id)) vectors.delete(id)
  }

  await loadStoredVectors()
  updatePending()
  scheduleRefresh()
}

/**
 * Reacts to the feature being switched on or off at runtime. Lives in a detached
 * effect scope: `useEmbeddings()` is called from many components, and this
 * watcher belongs to the shared index rather than to whichever component happened
 * to call first.
 */
function installEnabledWatcher() {
  if (enabledWatcherInstalled) return
  enabledWatcherInstalled = true

  effectScope(true).run(() => {
    watch(isEnabled, (on) => {
      if (on) {
        // Rebuild from the notes already in memory rather than making the user reload.
        void syncNotes(lastSyncedNotes)
        return
      }
      reset()
      _status.value = 'idle'
      _error.value = null
    })
  })
}

// ─── Public composable ──────────────────────────────────────

export function useEmbeddings() {
  const enabled = computed(isEnabled)
  const status = computed<EmbeddingStatus>(() => enabled.value ? _status.value : 'disabled')

  installEnabledWatcher()

  /**
   * Records that a note's text changed. The server embeds it as part of the save;
   * this only starts watching for the result.
   *
   * The previous vector is kept in place while the new one is produced — slightly
   * out of date beats missing from search entirely for the few seconds involved.
   */
  function queueNote(note: Note) {
    if (!enabled.value || note.deletedAt) return
    const hash = noteEmbeddingHash(note)
    if (expected.get(note.id) === hash && vectors.get(note.id)?.hash === hash) return

    expected.set(note.id, hash)
    updatePending()
    refreshAttempt = 0
    scheduleRefresh(true)
  }

  function forgetNote(id: string) {
    expected.delete(id)
    if (vectors.delete(id)) {
      _indexedCount.value = vectors.size
      _version.value++
    }
    updatePending()
  }

  async function embedQuery(query: string): Promise<Float32Array | null> {
    const text = query.trim()
    if (!text) return null

    const cached = queryCache.get(text)
    if (cached) return cached

    const { embedding } = await $fetch<{ embedding: string }>('/api/embeddings/query', {
      method: 'POST',
      body: { query: text }
    })
    const vector = decodeVector(embedding)
    if (vector.length === 0) return null

    if (queryCache.size >= QUERY_CACHE_SIZE) {
      queryCache.delete(queryCache.keys().next().value!)
    }
    queryCache.set(text, vector)
    return vector
  }

  /**
   * Ranks the index against a query vector, in two stages.
   *
   * `EMBEDDING_MIN_SCORE` answers "does this library contain anything about the
   * query at all", so a search with no answer returns nothing rather than the
   * closest unrelated note. `EMBEDDING_RANK_BAND` then trims the tail, because
   * within a query that does have an answer the relevant and irrelevant scores
   * overlap and only the distance to the best hit distinguishes them.
   */
  function rank(queryVector: Float32Array): ScoredId[] {
    const hits: ScoredId[] = []
    for (const [id, entry] of vectors) {
      const score = similarity(queryVector, entry.vector)
      if (score >= EMBEDDING_MIN_SCORE) hits.push({ id, score })
    }
    if (hits.length === 0) return hits

    hits.sort((a, b) => b.score - a.score)
    const cutoff = hits[0]!.score - EMBEDDING_RANK_BAND
    return hits.filter(hit => hit.score >= cutoff).slice(0, SEMANTIC_LIMIT)
  }

  /**
   * Semantic hits for a live query box. Debounced because embedding a query is a
   * request to the server, and keeps the last result visible while the next one is
   * computed so results do not flicker between keystrokes.
   */
  function useSemanticQuery(query: Ref<string>, debounceMs = 250) {
    const hits = shallowRef<ScoredId[]>([])
    const pending = ref(false)
    let timer: ReturnType<typeof setTimeout> | null = null
    let generation = 0

    watch([query, enabled, _version], () => {
      if (timer) clearTimeout(timer)
      const text = query.value.trim()

      if (!enabled.value || !text || vectors.size === 0) {
        hits.value = []
        pending.value = false
        return
      }

      pending.value = true
      const run = ++generation
      timer = setTimeout(async () => {
        try {
          const vector = await embedQuery(text)
          if (run !== generation) return
          hits.value = vector ? rank(vector) : []
          _error.value = null
          if (_status.value === 'error') updatePending()
        } catch (error) {
          // Keyword results are still on screen; this only explains why nothing
          // was added to them.
          if (run === generation) {
            hits.value = []
            _status.value = 'error'
            _error.value = error instanceof Error ? error.message : String(error)
          }
        } finally {
          if (run === generation) pending.value = false
        }
      }, debounceMs)
    }, { immediate: true })

    return { hits, pending }
  }

  return {
    enabled,
    modelLabel: EMBEDDING_MODEL_LABEL,
    status,
    error: _error,
    pending: _pending,
    indexedCount: _indexedCount,
    syncNotes,
    queueNote,
    forgetNote,
    reset,
    useSemanticQuery
  }
}
