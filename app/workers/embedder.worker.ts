/// <reference lib="webworker" />

/**
 * Runs the sentence encoder off the main thread.
 *
 * Embedding a note takes tens to hundreds of milliseconds, and the backfill runs
 * over the whole library at startup, so doing this inline would stutter typing in
 * the editor. The worker owns the ONNX session; callers only ever see vectors.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { chunkText, meanPool, normalize } from '../utils/embedding'

export type EmbedderRequest
  = | { type: 'init', model: string, dtype: 'q8' | 'fp16' | 'fp32', wasmPaths: string }
    | { type: 'embed', requestId: number, texts: string[], prefix: string }

export type EmbedderResponse
  = | { type: 'ready' }
    | { type: 'download', file: string, progress: number }
    | { type: 'init-error', message: string }
    | { type: 'result', requestId: number, vectors: Float32Array[] }
    | { type: 'error', requestId: number, message: string }

const worker = self as unknown as DedicatedWorkerGlobalScope

// Weights always come from the Hugging Face CDN; there is no bundled copy to
// check for first.
env.allowLocalModels = false

let extractor: FeatureExtractionPipeline | null = null

function post(message: EmbedderResponse, transfer?: Transferable[]) {
  worker.postMessage(message, transfer ?? [])
}

/**
 * Loads the encoder on the WASM backend.
 *
 * WebGPU is deliberately not attempted. It would be faster, but ONNX Runtime's
 * WebGPU support for the int8 weights this app ships is uneven — some drivers
 * reject the session and others accept it and then never finish compiling — and
 * carrying it means shipping a second 26 MB runtime binary. WASM measures around
 * 95 ms per note on a modest machine, which is fast enough for a background
 * backfill, so the simpler path wins.
 */
async function load(model: string, dtype: 'q8' | 'fp16' | 'fp32') {
  const progress_callback = (report: { status?: string, file?: string, progress?: number }) => {
    if (report.status === 'progress' && report.file) {
      post({ type: 'download', file: report.file, progress: report.progress ?? 0 })
    }
  }

  extractor = await pipeline('feature-extraction', model, { dtype, device: 'wasm', progress_callback })
}

/**
 * One unit-length vector per input text. Texts longer than the encoder's context
 * are split into overlapping chunks and mean-pooled, so a long note is matched on
 * all of its content rather than only its opening paragraph.
 */
async function embed(texts: string[], prefix: string): Promise<Float32Array[]> {
  if (!extractor) throw new Error('Model is not loaded')

  const vectors: Float32Array[] = []
  for (const text of texts) {
    const chunks = chunkText(text)
    if (chunks.length === 0) {
      vectors.push(new Float32Array(0))
      continue
    }

    const output = await extractor(chunks.map(chunk => prefix + chunk), { pooling: 'mean', normalize: true })
    const [rows, dimensions] = output.dims as [number, number]
    const flat = output.data as Float32Array

    const chunkVectors: Float32Array[] = []
    for (let row = 0; row < rows; row++) {
      chunkVectors.push(normalize(flat.slice(row * dimensions, (row + 1) * dimensions)))
    }
    vectors.push(meanPool(chunkVectors))
  }
  return vectors
}

worker.addEventListener('message', async (event: MessageEvent<EmbedderRequest>) => {
  const message = event.data

  if (message.type === 'init') {
    try {
      // Without this, onnxruntime-web fetches its WebAssembly from a CDN. See
      // modules/onnx-runtime.ts for what is served at this path.
      env.backends.onnx.wasm!.wasmPaths = message.wasmPaths
      await load(message.model, message.dtype)
      post({ type: 'ready' })
    } catch (error) {
      post({ type: 'init-error', message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (message.type === 'embed') {
    try {
      const vectors = await embed(message.texts, message.prefix)
      post({ type: 'result', requestId: message.requestId, vectors }, vectors.map(v => v.buffer as ArrayBuffer))
    } catch (error) {
      post({
        type: 'error',
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
})
