import { db } from '../db'
import { notes, MAX_EMBEDDING_BATCH, MAX_EMBEDDING_DIMENSIONS } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { getNoteAccessFilter } from '../utils/auth-helpers'

interface EmbeddingItem {
  id: string
  embedding: string
  model: string
  hash: string
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Rejects anything that is not base64 of a Float32Array of a plausible width.
 * Vectors are opaque to the server, so shape is the only thing worth checking.
 */
function isValidVector(base64: string): boolean {
  if (!base64 || base64.length % 4 !== 0 || !BASE64.test(base64)) return false
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = (base64.length / 4) * 3 - padding
  if (bytes % Float32Array.BYTES_PER_ELEMENT !== 0) return false
  const dimensions = bytes / Float32Array.BYTES_PER_ELEMENT
  return dimensions > 0 && dimensions <= MAX_EMBEDDING_DIMENSIONS
}

/**
 * Stores browser-generated vectors for notes in the caller's workspace.
 *
 * `updatedAt` is deliberately left alone: embedding a note is a background
 * bookkeeping write, and bumping the timestamp would reshuffle the note list
 * every time the backfill runs.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ items?: EmbeddingItem[] }>(event)
  const items = body?.items

  if (!Array.isArray(items) || items.length === 0) {
    throw createError({ statusCode: 400, message: 'items must be a non-empty array' })
  }
  if (items.length > MAX_EMBEDDING_BATCH) {
    throw createError({ statusCode: 400, message: `At most ${MAX_EMBEDDING_BATCH} embeddings per request` })
  }

  for (const item of items) {
    if (!item?.id || typeof item.id !== 'string') {
      throw createError({ statusCode: 400, message: 'Each item needs a note id' })
    }
    if (!item.model || typeof item.model !== 'string' || item.model.length > 200) {
      throw createError({ statusCode: 400, message: 'Each item needs a model identifier' })
    }
    if (!item.hash || typeof item.hash !== 'string' || item.hash.length > 200) {
      throw createError({ statusCode: 400, message: 'Each item needs a content hash' })
    }
    if (typeof item.embedding !== 'string' || !isValidVector(item.embedding)) {
      throw createError({ statusCode: 400, message: 'Each item needs a base64 float32 embedding' })
    }
  }

  const accessFilter = await getNoteAccessFilter(event)

  const written = await Promise.all(items.map(item =>
    db
      .update(notes)
      .set({ embedding: item.embedding, embeddingModel: item.model, embeddingHash: item.hash })
      .where(and(eq(notes.id, item.id), accessFilter))
      .returning({ id: notes.id })
  ))

  // Notes deleted or moved out of the workspace mid-backfill simply match nothing.
  return { updated: written.filter(rows => rows.length > 0).length }
})
