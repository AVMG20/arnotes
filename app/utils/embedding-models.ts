/**
 * Embedding models that can back semantic search.
 *
 * All of them are multilingual: Arnotes notes are commonly a mix of Dutch and
 * English, and English-only encoders (all-MiniLM-L6-v2 and friends) rank Dutch
 * text close to randomly. Sizes are the one-time browser download for the listed
 * `dtype`, cached by the browser afterwards.
 *
 * `minScore` and `rankBand` are measured rather than guessed. See
 * `docs/embedding-calibration.md` for the corpus, the queries, and how to
 * reproduce the numbers when adding a model.
 */
export interface EmbeddingModel {
  /** Hugging Face repository the browser downloads the ONNX weights from. */
  id: string
  label: string
  /** ONNX weight variant. `q8` is the quantized build — a quarter of the size at a marginal quality cost. */
  dtype: 'q8' | 'fp16' | 'fp32'
  dimensions: number
  approxDownloadMb: number
  /**
   * E5-family models are trained with asymmetric prefixes and lose a lot of
   * accuracy without them. Models that need no prefix leave these empty.
   */
  queryPrefix: string
  passagePrefix: string
  /**
   * Cosine floor below which a note counts as "not about this at all".
   *
   * Sits between the lowest score a genuine match produces and the highest score
   * any note reaches for a query the library has no answer to. That gap is what
   * makes an unanswerable search return nothing instead of the least bad note. It
   * does *not* separate relevant from irrelevant inside a query that does have an
   * answer — there the two ranges overlap, which is what `rankBand` is for.
   */
  minScore: number
  /**
   * How far below the best hit another hit may score and still be shown.
   *
   * Within an answerable query the useful signal is the gap to the top hit rather
   * than the absolute value, so this comes from the measured spread between a
   * correct match and its runner-up. Per model, because the families put their
   * scores on very different scales.
   */
  rankBand: number
  description: string
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModel> = {
  'Xenova/multilingual-e5-base': {
    id: 'Xenova/multilingual-e5-base',
    label: 'Multilingual E5 base',
    dtype: 'q8',
    dimensions: 768,
    approxDownloadMb: 279,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    // 12/12 retrieval. Matches score >= 0.789, unanswerable queries peak at 0.778,
    // top-to-runner-up gaps run 0.002–0.062.
    minScore: 0.78,
    rankBand: 0.06,
    description: 'Best balance of Dutch and English retrieval quality against download size.'
  },
  'Xenova/multilingual-e5-small': {
    id: 'Xenova/multilingual-e5-small',
    label: 'Multilingual E5 small',
    dtype: 'q8',
    dimensions: 384,
    approxDownloadMb: 118,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    // 10/12 retrieval. Matches score >= 0.795, unanswerable queries peak at 0.786,
    // gaps run -0.020–0.069. The narrowest separation of the four.
    minScore: 0.79,
    rankBand: 0.07,
    description: 'Lightest option. Noticeably weaker on longer Dutch notes, but fast on phones.'
  },
  'Xenova/multilingual-e5-large': {
    id: 'Xenova/multilingual-e5-large',
    label: 'Multilingual E5 large',
    dtype: 'q8',
    dimensions: 1024,
    approxDownloadMb: 562,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    // 12/12 retrieval and the cleanest separation: matches score >= 0.796 while
    // unanswerable queries peak at 0.763. Gaps run 0.012–0.079.
    minScore: 0.78,
    rankBand: 0.08,
    description: 'Highest quality. Roughly half a gigabyte to download and slow to embed on low-end devices.'
  },
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2': {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: 'Paraphrase multilingual MiniLM',
    dtype: 'q8',
    dimensions: 384,
    approxDownloadMb: 118,
    queryPrefix: '',
    passagePrefix: '',
    // 11/12 retrieval. Matches score >= 0.294, unanswerable queries peak at 0.240,
    // gaps run -0.058–0.602. An order of magnitude below the E5 numbers because
    // this model spreads scores across the whole range instead of packing them
    // into a narrow high band.
    minScore: 0.27,
    rankBand: 0.15,
    description: 'Tuned for sentence similarity rather than retrieval. Good for short, title-like notes.'
  }
}

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-base'

export function resolveEmbeddingModel(id: string | undefined | null): EmbeddingModel {
  const model = id ? EMBEDDING_MODELS[id] : undefined
  return model ?? EMBEDDING_MODELS[DEFAULT_EMBEDDING_MODEL]!
}
