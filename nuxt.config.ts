// https://nuxt.com/docs/api/configuration/nuxt-config
import { dropBundledOnnxRuntime } from './modules/onnx-runtime'

export default defineNuxtConfig({

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vite-pwa/nuxt'
  ],

  ssr: false,

  devtools: {
    enabled: process.env.NODE_ENV !== 'production'
  },

  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      discordEnabled: false,
      githubEnabled: false,
      allowSignUp: true,
      // Instance-wide switch for semantic search. Off means no model download, no
      // embedding generation and keyword-only search, whatever a user prefers.
      embeddingsEnabled: true,
      // Must be a key of EMBEDDING_MODELS in app/utils/embedding-models.ts;
      // anything else falls back to the default multilingual model.
      embeddingModel: 'Xenova/multilingual-e5-base'
    }
  },

  compatibilityDate: '2025-01-15',

  nitro: {
    preset: 'bun'
  },

  vite: {
    // The embedding worker is an ES module so it can import transformers.js.
    worker: {
      format: 'es',
      plugins: () => [dropBundledOnnxRuntime()]
    },
    resolve: {
      dedupe: [
        '@tiptap/core',
        '@tiptap/pm',
        'prosemirror-model',
        'prosemirror-state',
        'prosemirror-tables',
        'prosemirror-view'
      ]
    },
    optimizeDeps: {
      // transformers.js ships its own WASM/ONNX loader and breaks when Vite
      // pre-bundles it.
      exclude: ['@huggingface/transformers'],
      include: [
        '@nuxt/ui > prosemirror-state',
        '@nuxt/ui > prosemirror-transform',
        '@nuxt/ui > prosemirror-model',
        '@nuxt/ui > prosemirror-view',
        '@nuxt/ui > prosemirror-gapcursor',
        '@tiptap/extension-table',
        '@tiptap/pm/tables'
      ]
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Notes',
      short_name: 'Notes',
      description: 'A local-first note taking app',
      theme_color: '#18181b',
      background_color: '#18181b',
      display: 'standalone',
      orientation: 'portrait',
      scope: '/',
      start_url: '/',
      icons: [
        {
          src: 'pwa-64x64.png',
          sizes: '64x64',
          type: 'image/png'
        },
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: 'maskable-icon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,ico}']
    },
    client: {
      installPrompt: true
    },
    devOptions: {
      enabled: false,
      type: 'module'
    }
  }
})
