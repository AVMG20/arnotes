import { defineConfig } from 'drizzle-kit'

// Mirrors the host rewrite in server/db/index.ts — the migration image loads this
// config standalone and cannot import from the server bundle.
const raw = process.env.DATABASE_URL || 'postgresql://arnotes:arnotes@localhost:5432/arnotes'
const url = process.env.IS_DOCKER ? raw : raw.replace('@postgres:', '@localhost:')

export default defineConfig({
  schema: './server/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url
  },
  strict: true
})
