import { join } from 'node:path'
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { chunkText, meanPool, normalize } from '#shared/utils/embedding'
import { EMBEDDING_DTYPE, EMBEDDING_MODEL_ID, PASSAGE_PREFIX, QUERY_PREFIX } from '#shared/utils/embedding-model'

/**
 * The sentence encoder, running in the Nitro process.
 *
 * This used to run in the visitor's browser. It worked, but every tab paid for a
 * ~280 MB model download and the ONNX runtime pushed the app's resident memory
 * from roughly 200 MB to 1.3 GB — for a model that produces identical vectors for
 * every user of the instance. Embedding once, on the machine that already stores
 * the notes, costs the host a few hundred megabytes of RAM and gives every client
 * (including phones, which could not realistically run this at all) the full
 * feature.
 *
 * The weights are fetched from the Hugging Face CDN on first use and cached on
 * disk, so only the very first embed after a fresh deployment waits on the
 * network.
 */

/** Where downloaded weights are kept. Inside `data/` so the Docker volume persists them. */
const CACHE_DIR = process.env.EMBEDDING_CACHE_DIR || join(process.cwd(), 'data', 'models')

env.allowLocalModels = false
env.cacheDir = CACHE_DIR

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

/** Set when loading has failed, so a broken deployment is reported instead of retried forever. */
let loadError: Error | null = null

export function embeddingsEnabled(): boolean {
  // Mirrors the public runtime config, read here so a request never reaches the
  // encoder on an instance that has the feature switched off.
  return process.env.NUXT_PUBLIC_EMBEDDINGS_ENABLED !== 'false'
}

/**
 * Loads the encoder once per process. Never called at boot: an instance where
 * nobody searches should not hold the model in memory at all.
 */
function extractor(): Promise<FeatureExtractionPipeline> {
  if (loadError) return Promise.reject(loadError)
  if (extractorPromise) return extractorPromise

  extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE })
    .catch((error: unknown) => {
      // Remembered rather than rethrown from a stale promise, so the message the
      // client eventually sees is the original failure.
      loadError = error instanceof Error ? error : new Error(String(error))
      extractorPromise = null
      throw loadError
    })

  return extractorPromise
}

/**
 * Serializes inference across the whole process.
 *
 * ONNX Runtime saturates the available cores on a single session, so running two
 * embeds concurrently makes both slower rather than either faster, and a backfill
 * racing a search would leave the search waiting on unbounded work. One queue
 * keeps latency predictable and memory flat.
 */
let chain: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task)
  chain = result.catch(() => {})
  return result
}

/**
 * One unit-length vector per input text. Texts longer than the encoder's context
 * are split into overlapping chunks and mean-pooled, so a long note is matched on
 * all of its content rather than only its opening paragraph.
 */
async function embed(texts: string[], prefix: string): Promise<Float32Array[]> {
  const encode = await extractor()

  return serialize(async () => {
    const vectors: Float32Array[] = []
    for (const text of texts) {
      const chunks = chunkText(text)
      if (chunks.length === 0) {
        vectors.push(new Float32Array(0))
        continue
      }

      const output = await encode(chunks.map(chunk => prefix + chunk), { pooling: 'mean', normalize: true })
      const [rows, dimensions] = output.dims as [number, number]
      const flat = output.data as Float32Array

      const chunkVectors: Float32Array[] = []
      for (let row = 0; row < rows; row++) {
        chunkVectors.push(normalize(flat.slice(row * dimensions, (row + 1) * dimensions)))
      }
      vectors.push(meanPool(chunkVectors))
    }
    return vectors
  })
}

/** Vectors for note text, encoded with the passage prefix E5 expects. */
export function embedPassages(texts: string[]): Promise<Float32Array[]> {
  return embed(texts, PASSAGE_PREFIX)
}

/** A vector for something the user typed into the search box. */
export async function embedQuery(text: string): Promise<Float32Array> {
  const [vector] = await embed([text], QUERY_PREFIX)
  return vector ?? new Float32Array(0)
}
