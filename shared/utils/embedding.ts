/**
 * Vector plumbing shared by the server-side encoder, the client index and the
 * search fusion. Lives in `shared/` because both sides have to agree byte for
 * byte: the server writes the hash and the client decides from it whether a
 * note's vector is still current.
 *
 * Deliberately dependency-free, so importing it into a Nitro handler pulls in
 * nothing else.
 */

import { EMBEDDING_MODEL_ID } from './embedding-model'

/** Longest slice of a note fed to the encoder, in characters. */
const CHUNK_SIZE = 1000
/** Overlap between chunks so a sentence spanning a boundary is still matched. */
const CHUNK_OVERLAP = 150
/**
 * Chunk ceiling per note. Encoders cap out around 512 tokens, so a long note is
 * split and mean-pooled; six chunks covers ~6 000 characters, past which extra
 * text mostly dilutes the vector instead of sharpening it.
 */
const MAX_CHUNKS = 6

// ─── Text preparation ───────────────────────────────────────

/** Strips note HTML down to the prose an encoder should actually see. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The exact text a note is embedded from. Title and tags are repeated at the
 * front because they carry the most signal per token.
 */
export function noteEmbeddingText(note: { title: string, content: string, tags: string[] }): string {
  const parts = [note.title]
  if (note.tags.length) parts.push(note.tags.join(', '))
  parts.push(htmlToPlainText(note.content))
  return parts.filter(Boolean).join('\n').trim()
}

/** Splits long text into overlapping windows small enough for the encoder. */
export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return text ? [text] : []

  const chunks: string[] = []
  const stride = CHUNK_SIZE - CHUNK_OVERLAP
  for (let start = 0; start < text.length && chunks.length < MAX_CHUNKS; start += stride) {
    chunks.push(text.slice(start, start + CHUNK_SIZE))
  }
  return chunks
}

// ─── Vector maths ───────────────────────────────────────────

/** Scales a vector to unit length in place, so similarity is a plain dot product. */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!
  const magnitude = Math.sqrt(sum)
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / magnitude
  }
  return vector
}

/** Averages chunk vectors into the single vector stored for a note. */
export function meanPool(vectors: Float32Array[]): Float32Array {
  const first = vectors[0]
  if (!first) return new Float32Array(0)
  if (vectors.length === 1) return normalize(new Float32Array(first))

  const pooled = new Float32Array(first.length)
  for (const vector of vectors) {
    for (let i = 0; i < pooled.length; i++) pooled[i] = pooled[i]! + (vector[i] ?? 0)
  }
  for (let i = 0; i < pooled.length; i++) pooled[i] = pooled[i]! / vectors.length
  return normalize(pooled)
}

/**
 * Cosine similarity. Every vector that reaches this point has been normalized,
 * so the dot product is already the cosine.
 */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!
  return dot
}

// ─── Wire format ────────────────────────────────────────────

/**
 * Vectors travel and rest as base64 of the raw Float32 buffer: ~4 KB for 768
 * dimensions against ~16 KB for the equivalent JSON array, with no precision lost.
 */
export function encodeVector(vector: Float32Array): string {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
  // Chunked because String.fromCharCode(...bytes) overflows the call stack on
  // vectors this size.
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function decodeVector(base64: string): Float32Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

/**
 * cyrb53 over the embedded text. Identifies "this vector is still current": the
 * server stores it next to the vector it wrote, and the client compares it
 * against the note it holds to know whether a re-embed is still outstanding.
 *
 * A collision only costs a missed re-embed, so a fast non-cryptographic hash is
 * the right trade.
 */
export function embeddingHash(text: string): string {
  const input = `${EMBEDDING_MODEL_ID} ${text}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** Hash of a note as it stands right now, for comparison against the stored one. */
export function noteEmbeddingHash(note: { title: string, content: string, tags: string[] }): string {
  return embeddingHash(noteEmbeddingText(note))
}

// ─── Rank fusion ────────────────────────────────────────────

export interface ScoredId {
  id: string
  score: number
}

/**
 * Reciprocal Rank Fusion. Merges the keyword and vector rankings on rank rather
 * than score, which sidesteps the fact that MiniSearch scores and cosine
 * similarities live on completely different scales.
 *
 * `k` damps the top of each list; 60 is the value from the original RRF paper and
 * keeps a rank-1 hit from one engine from steamrolling a broad consensus in the
 * other. `semanticWeight` below 1 keeps exact keyword matches ahead of merely
 * related notes when both engines fire.
 */
export function reciprocalRankFusion(
  rankings: Array<{ ids: string[], weight: number }>,
  k = 60
): ScoredId[] {
  const scores = new Map<string, number>()
  for (const { ids, weight } of rankings) {
    ids.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + index + 1))
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}
