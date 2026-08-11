import { db } from '../db'
import { notes } from '../db/schema'
import { isNotNull, and, inArray } from 'drizzle-orm'
import { getNoteAccessFilter } from '../utils/auth-helpers'
import { pendingEmbeddingCount } from '../utils/embedding-queue'

/**
 * Vectors for the caller's workspace, plus how much the server still has to
 * embed.
 *
 * Kept off `GET /api/notes` on purpose: a 768-dimension vector adds ~4 KB per
 * note, which would double the payload of the initial note load for a feature the
 * client only needs once search is used. The client fetches this lazily, and only
 * when semantic search is switched on.
 *
 * `?ids=a,b,c` narrows the response to specific notes. The client uses it to pick
 * up a vector for a note it just saved, without re-downloading the whole index.
 */

/** Enough for a client to refresh a burst of edits; anything larger should just refetch all. */
const MAX_IDS = 100

export default defineEventHandler(async (event) => {
  const accessFilter = await getNoteAccessFilter(event)

  const idsParam = getQuery(event).ids
  const ids = typeof idsParam === 'string'
    ? idsParam.split(',').map(id => id.trim()).filter(Boolean).slice(0, MAX_IDS)
    : null

  if (ids && ids.length === 0) return { items: [], pending: pendingEmbeddingCount() }

  const items = await db
    .select({
      id: notes.id,
      embedding: notes.embedding,
      hash: notes.embeddingHash
    })
    .from(notes)
    .where(and(
      accessFilter,
      isNotNull(notes.embedding),
      ...(ids ? [inArray(notes.id, ids)] : [])
    ))

  return { items, pending: pendingEmbeddingCount() }
})
