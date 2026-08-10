import { computed, effectScope, ref, shallowRef, watch, type Ref } from 'vue'
import {
  decodeVector,
  embeddingHash,
  encodeVector,
  noteEmbeddingText,
  similarity,
  type ScoredId
} from '~/utils/embedding'
import { resolveEmbeddingModel } from '~/utils/embedding-models'
import type { EmbedderRequest, EmbedderResponse } from '~/workers/embedder.worker'
import type { Note } from '~/composables/useNotes'

/**
 * Client-side semantic index.
 *
 * Vectors are produced in the browser by `workers/embedder.worker.ts` and stored
 * on the note row, so a note is embedded once and reused across devices and
 * sessions. This module owns the worker, the in-memory index and the queue that
 * keeps the two in sync; it never reads the note store directly, so `useNotes`
 * stays the single owner of note state.
 */

export type EmbeddingStatus
  = | 'disabled'
    | 'idle'
    | 'loading-model'
    | 'indexing'
    | 'ready'
    | 'error'

interface IndexedVector {
  vector: Float32Array
  hash: string
}

/** Notes handed to the worker per round trip. */
const EMBED_BATCH = 8
/** How many semantic hits are fused into the keyword ranking. */
const SEMANTIC_LIMIT = 30
/** Query embeddings are cheap to keep and users retype the same searches. */
const QUERY_CACHE_SIZE = 32

// ─── Module-level singleton state ───────────────────────────

const _status = ref<EmbeddingStatus>('idle')
const _error = ref<string | null>(null)
const _download = ref<{ file: string, progress: number } | null>(null)
const _pending = ref(0)
const _indexedCount = ref(0)
/** Bumped whenever the index changes so search computeds re-evaluate. */
const _version = ref(0)

const vectors = new Map<string, IndexedVector>()
const queryCache = new Map<string, Float32Array>()

let worker: Worker | null = null
let workerReady: Promise<void> | null = null
let requestCounter = 0
const inflight = new Map<number, { resolve: (v: Float32Array[]) => void, reject: (e: Error) => void }>()

/** Notes waiting to be embedded, keyed by id so repeated saves collapse. */
const queue = new Map<string, Note>()
let draining = false
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

// ─── Worker plumbing ────────────────────────────────────────

function activeModel() {
  return resolveEmbeddingModel(useRuntimeConfig().public.embeddingModel)
}

/**
 * Where the ONNX runtime's WebAssembly is served from. Built from the app's base
 * URL so a deployment mounted on a sub-path still finds it. See
 * `modules/onnx-runtime.ts` for why this is self-hosted rather than left to the
 * library's CDN default.
 */
function runtimeAssetPath(): string {
  const base = useRuntimeConfig().app.baseURL || '/'
  return `${base.endsWith('/') ? base : base + '/'}ort/`
}

function send(message: EmbedderRequest, transfer?: Transferable[]) {
  worker?.postMessage(message, transfer ?? [])
}

function handleMessage(event: MessageEvent<EmbedderResponse>) {
  const message = event.data
  switch (message.type) {
    case 'download':
      _download.value = { file: message.file, progress: message.progress }
      break
    case 'result': {
      inflight.get(message.requestId)?.resolve(message.vectors)
      inflight.delete(message.requestId)
      break
    }
    case 'error': {
      inflight.get(message.requestId)?.reject(new Error(message.message))
      inflight.delete(message.requestId)
      break
    }
  }
}

/**
 * Boots the worker on first use. The model is a few hundred megabytes, so this is
 * never called speculatively — only when there is something to embed or a search
 * to answer.
 */
function ensureWorker(): Promise<void> {
  if (workerReady) return workerReady

  const model = activeModel()
  _status.value = 'loading-model'
  _error.value = null

  workerReady = new Promise<void>((resolve, reject) => {
    worker = new Worker(new URL('../workers/embedder.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', handleMessage)

    const onReady = (event: MessageEvent<EmbedderResponse>) => {
      if (event.data.type === 'ready') {
        worker?.removeEventListener('message', onReady)
        _download.value = null
        _status.value = 'ready'
        resolve()
      } else if (event.data.type === 'init-error') {
        worker?.removeEventListener('message', onReady)
        reject(new Error(event.data.message))
      }
    }
    worker.addEventListener('message', onReady)
    worker.addEventListener('error', event => reject(new Error(event.message || 'Embedding worker failed to start')))

    send({ type: 'init', model: model.id, dtype: model.dtype, wasmPaths: runtimeAssetPath() })
  }).catch((error: Error) => {
    _status.value = 'error'
    _error.value = error.message
    teardownWorker()
    throw error
  })

  return workerReady
}

function teardownWorker() {
  worker?.terminate()
  worker = null
  workerReady = null
  for (const { reject } of inflight.values()) reject(new Error('Embedding worker stopped'))
  inflight.clear()
}

async function runEmbed(texts: string[], prefix: string): Promise<Float32Array[]> {
  await ensureWorker()
  const requestId = ++requestCounter
  return new Promise<Float32Array[]>((resolve, reject) => {
    inflight.set(requestId, { resolve, reject })
    send({ type: 'embed', requestId, texts, prefix })
  })
}

// ─── Persistence ────────────────────────────────────────────

interface StoredEmbedding {
  id: string
  embedding: string | null
  model: string | null
  hash: string | null
}

/**
 * Pulls previously stored vectors into memory. Vectors written by a different
 * model are dropped rather than trusted — cosine between two model families is
 * meaningless — which also makes switching models a self-healing re-index.
 */
async function loadStoredVectors() {
  if (storedVectorsLoaded) return
  storedVectorsLoaded = true

  const model = activeModel()
  let stored: StoredEmbedding[] = []
  try {
    stored = await $fetch<StoredEmbedding[]>('/api/embeddings')
  } catch {
    return
  }

  for (const row of stored) {
    if (!row.embedding || !row.hash || row.model !== model.id) continue
    try {
      vectors.set(row.id, { vector: decodeVector(row.embedding), hash: row.hash })
    } catch {
      // A corrupt vector just means this note gets re-embedded.
    }
  }
  _indexedCount.value = vectors.size
  _version.value++
}

async function persist(items: Array<{ id: string, embedding: string, model: string, hash: string }>) {
  if (items.length === 0) return
  await $fetch('/api/embeddings', { method: 'PUT', body: { items } })
}

// ─── Queue ──────────────────────────────────────────────────

/**
 * Embeds queued notes a batch at a time and writes the vectors back. Runs as a
 * single background drain so a large backfill never floods the worker or the API.
 */
async function drain() {
  if (draining) return
  draining = true
  const model = activeModel()

  try {
    while (queue.size > 0) {
      const batch = [...queue.values()].slice(0, EMBED_BATCH)
      _status.value = 'indexing'

      const texts = batch.map(note => noteEmbeddingText(note))
      let produced: Float32Array[]
      try {
        produced = await runEmbed(texts, model.passagePrefix)
      } catch (error) {
        // Leave the queue intact: the notes are retried on the next app load.
        _status.value = 'error'
        _error.value = error instanceof Error ? error.message : String(error)
        return
      }

      const toPersist: Array<{ id: string, embedding: string, model: string, hash: string }> = []
      batch.forEach((note, index) => {
        const vector = produced[index]
        queue.delete(note.id)
        if (!vector || vector.length === 0) return

        const hash = embeddingHash(texts[index]!, model.id)
        vectors.set(note.id, { vector, hash })
        toPersist.push({ id: note.id, embedding: encodeVector(vector), model: model.id, hash })
      })

      _indexedCount.value = vectors.size
      _pending.value = queue.size
      _version.value++

      try {
        await persist(toPersist)
      } catch {
        // The vectors are usable this session; a failed write just means the
        // notes are embedded again next time.
      }
    }
    _status.value = 'ready'
  } finally {
    draining = false
  }
}

// ─── Index maintenance ──────────────────────────────────────

/** Clears the index, for a workspace switch or when the feature is turned off. */
function reset() {
  queue.clear()
  vectors.clear()
  queryCache.clear()
  storedVectorsLoaded = false
  _pending.value = 0
  _indexedCount.value = 0
  _version.value++
}

/**
 * Queues every note whose text no longer matches its stored vector. Covers three
 * cases with one pass: notes written before semantic search existed, notes edited
 * on another device, and a change of embedding model.
 */
async function syncNotes(notes: Note[]) {
  lastSyncedNotes = notes
  if (!isEnabled()) return
  await loadStoredVectors()

  const modelId = activeModel().id
  const live = new Set<string>()

  for (const note of notes) {
    if (note.deletedAt) continue
    live.add(note.id)
    const hash = embeddingHash(noteEmbeddingText(note), modelId)
    if (vectors.get(note.id)?.hash !== hash) queue.set(note.id, note)
  }

  // Drop vectors for notes that no longer exist in this workspace.
  for (const id of [...vectors.keys()]) {
    if (!live.has(id)) vectors.delete(id)
  }

  _indexedCount.value = vectors.size
  _pending.value = queue.size
  _version.value++
  if (queue.size > 0) void drain()
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
      teardownWorker()
      reset()
      _status.value = 'idle'
      _error.value = null
      _download.value = null
    })
  })
}

// ─── Public composable ──────────────────────────────────────

export function useEmbeddings() {
  const config = useRuntimeConfig()

  const enabled = computed(isEnabled)
  const model = computed(() => resolveEmbeddingModel(config.public.embeddingModel))
  const status = computed<EmbeddingStatus>(() => enabled.value ? _status.value : 'disabled')

  installEnabledWatcher()

  /** Re-embeds a single note after a save, if its text actually changed. */
  function queueNote(note: Note) {
    if (!enabled.value || note.deletedAt) return
    const hash = embeddingHash(noteEmbeddingText(note), model.value.id)
    if (vectors.get(note.id)?.hash === hash) return
    queue.set(note.id, note)
    _pending.value = queue.size
    void drain()
  }

  function forgetNote(id: string) {
    queue.delete(id)
    if (vectors.delete(id)) {
      _indexedCount.value = vectors.size
      _version.value++
    }
    _pending.value = queue.size
  }

  async function embedQuery(query: string): Promise<Float32Array | null> {
    const text = query.trim()
    if (!text) return null

    const cached = queryCache.get(text)
    if (cached) return cached

    const [vector] = await runEmbed([text], model.value.queryPrefix)
    if (!vector || vector.length === 0) return null

    if (queryCache.size >= QUERY_CACHE_SIZE) {
      queryCache.delete(queryCache.keys().next().value!)
    }
    queryCache.set(text, vector)
    return vector
  }

  /**
   * Ranks the index against a query vector, in two stages.
   *
   * `minScore` answers "does this library contain anything about the query at
   * all", so a search with no answer returns nothing rather than the closest
   * unrelated note. `rankBand` then trims the tail, because within a query that
   * does have an answer the relevant and irrelevant scores overlap and only the
   * distance to the best hit distinguishes them.
   */
  function rank(queryVector: Float32Array): ScoredId[] {
    const { minScore, rankBand } = model.value

    const hits: ScoredId[] = []
    for (const [id, entry] of vectors) {
      const score = similarity(queryVector, entry.vector)
      if (score >= minScore) hits.push({ id, score })
    }
    if (hits.length === 0) return hits

    hits.sort((a, b) => b.score - a.score)
    const cutoff = hits[0]!.score - rankBand
    return hits.filter(hit => hit.score >= cutoff).slice(0, SEMANTIC_LIMIT)
  }

  /**
   * Semantic hits for a live query box. Debounced because embedding a query costs
   * a worker round trip, and keeps the last result visible while the next one is
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
        } catch {
          if (run === generation) hits.value = []
        } finally {
          if (run === generation) pending.value = false
        }
      }, debounceMs)
    }, { immediate: true })

    return { hits, pending }
  }

  return {
    enabled,
    model,
    status,
    error: _error,
    download: _download,
    pending: _pending,
    indexedCount: _indexedCount,
    syncNotes,
    queueNote,
    forgetNote,
    reset,
    useSemanticQuery
  }
}
