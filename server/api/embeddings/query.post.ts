import { embedQuery, embeddingsEnabled } from '../../utils/embedder'
import { encodeVector } from '#shared/utils/embedding'

/**
 * Encodes a search query into a vector for the client to rank against.
 *
 * The client keeps the note vectors and does the cosine itself — ranking a few
 * thousand 768-dimension vectors is a millisecond of work and keeps search
 * responsive while typing — so this endpoint exists only because the model that
 * turns text into a vector now lives on the server.
 */

/** Queries are search box input, not documents. Anything longer is a paste accident. */
const MAX_QUERY_LENGTH = 512

export default defineEventHandler(async (event) => {
  if (!embeddingsEnabled()) {
    throw createError({ statusCode: 404, message: 'Semantic search is disabled on this instance' })
  }

  const body = await readBody<{ query?: string }>(event)
  const query = typeof body?.query === 'string' ? body.query.trim() : ''

  if (!query) throw createError({ statusCode: 400, message: 'query must be a non-empty string' })
  if (query.length > MAX_QUERY_LENGTH) {
    throw createError({ statusCode: 400, message: `query must be at most ${MAX_QUERY_LENGTH} characters` })
  }

  let vector: Float32Array
  try {
    vector = await embedQuery(query)
  } catch (error) {
    // The model failing to load is an instance problem, not a bad request; the
    // client falls back to keyword-only search on a 503.
    console.error('[embeddings] query embed failed', error)
    throw createError({ statusCode: 503, message: 'The search model is unavailable' })
  }

  if (vector.length === 0) throw createError({ statusCode: 503, message: 'The search model returned nothing' })

  return { embedding: encodeVector(vector) }
})
