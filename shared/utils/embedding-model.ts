/**
 * The one embedding model this app uses.
 *
 * Multilingual on purpose: notes are commonly a mix of Dutch and English, and
 * English-only encoders (all-MiniLM-L6-v2 and friends) rank Dutch text close to
 * randomly. The model runs on the Nitro server, so its size is a one-time cost on
 * the host rather than a download every visitor pays for.
 *
 * There is deliberately no choice of model. Vectors from two model families are
 * not comparable, so offering a switch meant carrying the model identity on every
 * note row and re-embedding the whole library whenever it changed — a lot of
 * machinery for a setting nobody had a reason to touch.
 *
 * The thresholds below are measured rather than guessed. See
 * `docs/embedding-calibration.md` for the corpus, the queries and how to
 * reproduce them.
 */

/** Hugging Face repository the server downloads the ONNX weights from. */
export const EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-base'

export const EMBEDDING_MODEL_LABEL = 'Multilingual E5 base'

/** ONNX weight variant. `q8` is the quantized build: a quarter of the size at a marginal quality cost. */
export const EMBEDDING_DTYPE = 'q8'

export const EMBEDDING_DIMENSIONS = 768

/**
 * E5 is trained with asymmetric prefixes and loses a lot of accuracy without
 * them: the same text is encoded differently depending on whether it is the
 * thing being searched for or the thing being searched.
 */
export const QUERY_PREFIX = 'query: '
export const PASSAGE_PREFIX = 'passage: '

/**
 * Cosine floor below which a note counts as "not about this at all".
 *
 * Sits between the lowest score a genuine match produces (0.789) and the highest
 * score any note reaches for a query the library has no answer to (0.778). That
 * gap is what makes an unanswerable search return nothing instead of the least
 * bad note. It does *not* separate relevant from irrelevant inside a query that
 * does have an answer — there the two ranges overlap, which is what
 * `EMBEDDING_RANK_BAND` is for.
 */
export const EMBEDDING_MIN_SCORE = 0.78

/**
 * How far below the best hit another hit may score and still be shown.
 *
 * Within an answerable query the useful signal is the gap to the top hit rather
 * than the absolute value. Measured top-to-runner-up gaps run 0.002–0.062.
 */
export const EMBEDDING_RANK_BAND = 0.06
