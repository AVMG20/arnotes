// https://nuxt.com/docs/api/configuration/nuxt-config
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
      allowSignUp: true
    }
  },

  compatibilityDate: '2025-01-15',

  nitro: {
    preset: 'bun',
    // Live updates: the browser listens on /_ws for changes made elsewhere —
    // an AI agent over MCP, a teammate, another tab.
    experimental: {
      websocket: true
    },
    typescript: {
      tsConfig: {
        compilerOptions: {
          // Notes are stored as editor HTML, so the API parses and rewrites it
          // through a server-side DOM implementation. That code needs the DOM
          // interface types, which Nitro leaves out by default.
          lib: ['esnext', 'webworker', 'dom', 'dom.iterable']
        }
      }
    }
  },

  vite: {
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
