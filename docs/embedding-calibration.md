# Embedding calibration

`shared/utils/embedding-model.ts` carries two numbers, `EMBEDDING_MIN_SCORE` and
`EMBEDDING_RANK_BAND`. Both are measured rather than guessed, because cosine
similarity is not comparable between model families — the E5 models pack every
score into a narrow band above 0.7, while a paraphrase model spreads across the
whole range. Copying a threshold from one to the other silently breaks search.

This document records what was measured on the four candidates, why
`multilingual-e5-base` was chosen, and how to repeat the measurement if the model
is ever changed.

## What the two numbers do

Ranking happens in two stages, in `useEmbeddings().rank()`:

1. **`EMBEDDING_MIN_SCORE`** answers *does this library contain anything about the query at
   all*. It sits between the lowest score a genuine match produces and the
   highest score any note reaches for a query with no answer in the library. Below
   it, nothing is returned, so searching for something you never wrote about gives
   no semantic results instead of the least unrelated note.

2. **`EMBEDDING_RANK_BAND`** answers *which of the surviving notes are worth showing*. Within
   a query that does have an answer, relevant and irrelevant scores overlap, so an
   absolute cutoff cannot separate them — only the distance to the best hit can.
   Anything scoring within the band of the top hit is kept.

A single absolute threshold cannot do both jobs. For `multilingual-e5-base` the
lowest genuine match scored 0.789 while the *best irrelevant* note for an
answerable query reached 0.812 — overlapping ranges. Splitting the decision in two
is what makes both cases work.

## Method

Twelve notes in mixed Dutch and English, standing in for a real library: groceries,
a quarterly budget, a bike repair, standup notes, a holiday, a birthday present, a
tax return, a pasta recipe, a workout schedule, a server backup runbook, a doctor's
appointment, and book notes.

Two query sets, both deliberately sharing no keywords with their target, so a
keyword engine would score zero on all of them:

- **12 answerable queries**, one per note, half crossing languages
  (`bicycle tire repair` → the Dutch note about a `lekke fietsband`,
  `begroting voor het bestuur` → the English note about a quarterly budget).
- **5 unanswerable queries** on subjects no note covers
  (`photosynthesis of tropical orchids`, `kleurenblindheid bij honden`, …).

For each model: embed the notes with the passage prefix, embed the queries with the
query prefix, and record the score of the intended note, the best score any other
note reached, and the top score for each unanswerable query.

`EMBEDDING_MIN_SCORE` is then placed between the lowest answerable-target score and the
highest unanswerable-query score. `EMBEDDING_RANK_BAND` comes from the observed spread between
a correct match and its runner-up.

## Results

All four models on the same corpus, `q8` weights, ONNX Runtime:

| Model | Top-1 | Lowest genuine match | Highest unanswerable | Min score | Top-to-runner-up gap | Rank band |
| --- | --- | --- | --- | --- | --- | --- |
| `multilingual-e5-base` (in use) | 12/12 | 0.789 | 0.778 | 0.78 | 0.002 – 0.062 | 0.06 |
| `multilingual-e5-small` | 10/12 | 0.795 | 0.786 | 0.79 | −0.020 – 0.069 | 0.07 |
| `multilingual-e5-large` | 12/12 | 0.796 | 0.763 | 0.78 | 0.012 – 0.079 | 0.08 |
| `paraphrase-multilingual-MiniLM-L12-v2` | 11/12 | 0.294 | 0.240 | 0.27 | −0.058 – 0.602 | 0.15 |

With those settings applied, every model returns the intended note somewhere in its
result set for all 12 answerable queries, and nothing at all for all 5 unanswerable
ones. Result sets stay small — `multilingual-e5-base` returns between 1 and 7 notes
out of 12, averaging 2.5.

`multilingual-e5-base` is the one shipped: joint-best retrieval at less than half
the size of `large`. Now that the model runs on the server rather than in every
browser, size matters less than it did — but `large` bought no measured accuracy
on this corpus, so it would be paid for nothing.

## Reproducing

Run a model against the corpus above with the app's own helpers, so the measurement
uses the same chunking, pooling and similarity code the server will:

```ts
import { pipeline, env } from '@huggingface/transformers'
import { chunkText, meanPool, normalize, similarity, noteEmbeddingText } from '#shared/utils/embedding'
import { EMBEDDING_DTYPE, EMBEDDING_MODEL_ID, PASSAGE_PREFIX, QUERY_PREFIX } from '#shared/utils/embedding-model'

const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE })

async function embed(text: string, prefix: string) {
  const chunks = chunkText(text)
  const out = await extractor(chunks.map(c => prefix + c), { pooling: 'mean', normalize: true })
  const [rows, dims] = out.dims as [number, number]
  const vectors = []
  for (let r = 0; r < rows; r++) vectors.push(normalize(out.data.slice(r * dims, (r + 1) * dims)))
  return meanPool(vectors)
}

// notes → embed(noteEmbeddingText(note), PASSAGE_PREFIX)
// queries → embed(query, QUERY_PREFIX)
// score → similarity(queryVector, noteVector)
```

Then set `EMBEDDING_MIN_SCORE` between the two score populations and
`EMBEDDING_RANK_BAND` from the top-to-runner-up gaps. A model whose populations
overlap — no gap between the lowest genuine match and the highest unanswerable
score — is not usable here, and should be rejected rather than given a guessed
threshold.

A replacement must also be multilingual. English-only encoders rank Dutch text
close to randomly, which is why `all-MiniLM-L6-v2` and similar were never
candidates.

Changing the model changes `EMBEDDING_MODEL_ID`, which is folded into the stored
content hash, so every vector is treated as stale and the boot scan re-embeds the
library. No migration is needed, but a large library will keep the encoder busy
for a while.
