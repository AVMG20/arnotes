import { db } from '../db'
import { notes } from '../db/schema'
import { isNotNull, and } from 'drizzle-orm'
import { getNoteAccessFilter } from '../utils/auth-helpers'

/**
 * Vectors for every embedded note in the caller's workspace.
 *
 * Kept off `GET /api/notes` on purpose: a 768-dimension vector adds ~4 KB per note,
 * which would double the payload of the initial note load for a feature the client
 * only needs once search is used. The client fetches this lazily, and only when
 * semantic search is switched on.
 */
export default defineEventHandler(async (event) => {
  const accessFilter = await getNoteAccessFilter(event)

  return db
    .select({
      id: notes.id,
      embedding: notes.embedding,
      model: notes.embeddingModel,
      hash: notes.embeddingHash
    })
    .from(notes)
    .where(and(accessFilter, isNotNull(notes.embedding)))
})
