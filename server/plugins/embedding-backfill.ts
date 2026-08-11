import { backfillStaleEmbeddings } from '../utils/embedding-queue'
import { embeddingsEnabled } from '../utils/embedder'

/**
 * Catches up the vector index once the instance is running.
 *
 * Delayed rather than run inline: the scan reads every live note and the encoder
 * download can be a few hundred megabytes, neither of which should sit between
 * the process starting and the first request being served. Failures are logged
 * and dropped — semantic search degrades to keyword search, which is not worth
 * refusing to boot over.
 */
const START_DELAY_MS = 10_000

export default defineNitroPlugin(() => {
  if (!embeddingsEnabled()) return

  setTimeout(() => {
    backfillStaleEmbeddings().catch((error) => {
      console.error('[embeddings] backfill failed', error)
    })
  }, START_DELAY_MS).unref?.()
})
