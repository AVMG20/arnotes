import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { defineNuxtModule } from '@nuxt/kit'
import type { Plugin } from 'vite'

/**
 * Serves the ONNX Runtime WebAssembly files from this instance instead of a CDN.
 *
 * Left alone, transformers.js resolves the runtime to
 * `cdn.jsdelivr.net/npm/onnxruntime-web@<version>/dist/` at load time. That is a
 * third-party request from every visitor's browser on an otherwise self-hosted
 * app, and it makes semantic search fail outright behind a strict CSP or on an
 * air-gapped network. The CDN URL is baked into onnxruntime-web, and only an
 * explicit `wasmPaths` overrides it.
 *
 * The files are copied out of `onnxruntime-web` at build time and mounted at
 * `/ort`; `app/workers/embedder.worker.ts` points `wasmPaths` there. The
 * duplicate Vite emits into the client bundle is stripped below.
 */

/**
 * The single backend the worker asks for: `asyncify` is the WASM build, and the
 * matching `.mjs` is the loader onnxruntime-web imports alongside the binary.
 * Only these two are copied — the full dist is ~125 MB of variants for backends
 * this app never requests (the WebGPU pair alone is another 26 MB).
 */
const RUNTIME_FILES = [
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs'
]

export default defineNuxtModule({
  meta: { name: 'onnx-runtime' },

  setup(_options, nuxt) {
    // `onnxruntime-web` does not export `./package.json`, so the dist directory is
    // derived from its main entry — which already lives inside dist — instead.
    let distDir: string
    try {
      distDir = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))
    } catch {
      distDir = resolve(nuxt.options.rootDir, 'node_modules/onnxruntime-web/dist')
    }

    // Staged outside `buildDir`: Nuxt wipes that directory after module setup,
    // which would delete these files before Nitro ever copies them. Emptied first
    // so a file dropped from RUNTIME_FILES, or left by an older onnxruntime-web,
    // stops being shipped.
    const outDir = resolve(nuxt.options.rootDir, 'node_modules/.cache/arnotes-onnx-runtime')
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })

    const missing: string[] = []
    for (const file of RUNTIME_FILES) {
      const from = join(distDir, file)
      if (existsSync(from)) copyFileSync(from, join(outDir, file))
      else missing.push(file)
    }

    if (missing.length === RUNTIME_FILES.length) {
      // Failing silently here would leave the app quietly fetching from a CDN,
      // which is exactly what this module exists to prevent.
      console.warn(`[onnx-runtime] No runtime files found in ${distDir}. Semantic search will fall back to the onnxruntime-web CDN.`)
      return
    }

    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.publicAssets ||= []
      nitroConfig.publicAssets.push({
        dir: outDir,
        baseURL: '/ort',
        // Content is pinned to the installed onnxruntime-web version, so it can be cached hard.
        maxAge: 60 * 60 * 24 * 365
      })
    })
  }
})

/**
 * Drops the copy of the runtime binary that Vite emits into the worker bundle.
 *
 * onnxruntime-web references the file through `new URL(..., import.meta.url)`, so
 * the bundler dutifully emits a hashed copy — 23 MB that nothing ever fetches.
 * `wasmPaths` sends the runtime to `/ort`, and the library could not request a
 * hash-suffixed name anyway. Registered from `nuxt.config.ts` alongside the rest
 * of the worker build config.
 */
export function dropBundledOnnxRuntime(): Plugin {
  return {
    name: 'arnotes:drop-bundled-ort-wasm',
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && /ort-wasm-.*\.wasm$/.test(fileName)) {
          Reflect.deleteProperty(bundle, fileName)
        }
      }
    }
  }
}
