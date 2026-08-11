import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { notes } from '../db/schema'
import { embedPassages, embeddingsEnabled } from './embedder'
import { encodeVector, noteEmbeddingHash, noteEmbeddingText } from '#shared/utils/embedding'

/**
 * Keeps stored vectors in step with note text, in the background.
 *
 * Embedding is never awaited by the request that caused it: a note save must not
 * wait a few hundred milliseconds on the encoder, and a failed embed must not
 * fail the save. Notes are queued here instead and drained one batch at a time.
 * Anything missed — a crash mid-queue, a note written by an older version, a
 * process that was never up when the note changed — is caught by the boot scan in
 * `server/plugins/embedding-backfill.ts`, which compares the same hash.
 */

/** Notes handed to the encoder per round trip. */
const BATCH = 8

const queued = new Set<string>()
let draining = false

/** Marks a note as needing a vector. Cheap and idempotent; safe to call on every write. */
export function queueNoteEmbedding(id: string | undefined | null) {
  if (!id || !embeddingsEnabled()) return
  queued.add(id)
  void drain()
}

export function queueNoteEmbeddings(ids: string[]) {
  for (const id of ids) queueNoteEmbedding(id)
}

async function embedBatch(ids: string[]) {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      tags: notes.tags,
      hash: notes.embeddingHash
    })
    .from(notes)
    .where(and(inArray(notes.id, ids), isNull(notes.deletedAt)))

  // Only the notes whose text actually moved since the stored vector was written.
  const stale = rows
    .map(row => ({ row, text: noteEmbeddingText(row), hash: noteEmbeddingHash(row) }))
    .filter(item => item.row.hash !== item.hash)

  if (stale.length === 0) return

  const vectors = await embedPassages(stale.map(item => item.text))

  await Promise.all(stale.map(async (item, index) => {
    const vector = vectors[index]
    if (!vector || vector.length === 0) return

    // `updatedAt` is deliberately left alone: embedding is background bookkeeping,
    // and bumping the timestamp would reshuffle every client's note list.
    await db
      .update(notes)
      .set({ embedding: encodeVector(vector), embeddingHash: item.hash })
      .where(eq(notes.id, item.row.id))
  }))
}

async function drain() {
  if (draining) return
  draining = true

  try {
    while (queued.size > 0) {
      const batch = [...queued].slice(0, BATCH)
      for (const id of batch) queued.delete(id)

      try {
        await embedBatch(batch)
      } catch (error) {
        // Dropped rather than retried: the boot scan picks these up again, and a
        // model that cannot load would otherwise spin here forever.
        console.error('[embeddings] batch failed', error)
      }
    }
  } finally {
    draining = false
  }
}

/** How many notes are still waiting, for the status endpoint. */
export function pendingEmbeddingCount(): number {
  return queued.size
}

/**
 * Queues every note whose stored hash does not match its text. Covers notes that
 * predate the feature, notes written while the encoder was failing, and the whole
 * library after a model change, since the model id is part of the hash.
 *
 * Reads in pages: computing the hash needs the note body, and a large library
 * should not be held in memory all at once.
 */
export async function backfillStaleEmbeddings(pageSize = 200) {
  if (!embeddingsEnabled()) return

  for (let offset = 0; ; offset += pageSize) {
    const rows = await db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        tags: notes.tags,
        hash: notes.embeddingHash
      })
      .from(notes)
      .where(isNull(notes.deletedAt))
      .orderBy(notes.createdAt)
      .limit(pageSize)
      .offset(offset)

    if (rows.length === 0) return

    for (const row of rows) {
      if (row.hash !== noteEmbeddingHash(row)) queueNoteEmbedding(row.id)
    }
  }
}
