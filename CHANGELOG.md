# Changelog

All notable changes to Arnotes are documented in this file.

## Unreleased

### Added

- Semantic search. Notes are embedded on the server with Multilingual E5 base and
  the resulting vectors are stored on the note, so each note is indexed once and
  reused across devices. Search fuses the keyword and vector rankings, so a Dutch
  query can surface an English note about the same thing.
- Notes are embedded in the background as they are saved, and any note whose
  vector is missing or out of date is picked up by a scan when the server starts —
  including every note written before this release.
- `NUXT_PUBLIC_EMBEDDINGS_ENABLED` for instance-wide control and
  `EMBEDDING_CACHE_DIR` for where the weights are cached, plus a per-account
  toggle under Settings.

### Upgrade notes

- Run `bun run db:push` (Docker Compose does this automatically) to add the
  `embedding` and `embedding_hash` columns on `notes` and the
  `semantic_search_enabled` column on `user_settings`.
- The application image is now Debian rather than Alpine. The embedding model runs
  on `onnxruntime-node`, whose native binding is built against glibc and does not
  load on musl.
- The server downloads the model (~280 MB) into `data/models` the first time
  something is embedded, and holds roughly 400–600 MB of resident memory once it
  is loaded. Set `NUXT_PUBLIC_EMBEDDINGS_ENABLED=false` to avoid both.

## 0.1.0 - 2026-07-28

Initial open-source release.

- Self-hosted rich-text notes with inline tags, search, attachments, sharing, and an installable PWA
- Email/password authentication with optional Discord OAuth
- Optional per-user OpenRouter integration and AI usage history
- One-command Docker Compose deployment with PostgreSQL, health checks, automatic Drizzle schema setup, and persistent storage
- Standalone GitHub Pages marketing site
