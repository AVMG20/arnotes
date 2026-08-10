# Changelog

All notable changes to Arnotes are documented in this file.

## Unreleased

### Added

- Semantic search. Notes are embedded in the browser with a multilingual sentence
  encoder and the resulting vectors are stored on the note, so each note is
  indexed once and reused across devices. Search fuses the keyword and vector
  rankings, so a Dutch query can surface an English note about the same thing.
- Notes written before this release are embedded automatically in the background
  the next time the app is opened.
- `NUXT_PUBLIC_EMBEDDINGS_ENABLED` and `NUXT_PUBLIC_EMBEDDING_MODEL` for
  instance-wide control, plus a per-account toggle under Settings.

### Upgrade notes

- Run `bun run db:push` (Docker Compose does this automatically) to add the
  `embedding`, `embedding_model`, and `embedding_hash` columns on `notes` and the
  `semantic_search_enabled` column on `user_settings`.
- The first visit after upgrading downloads the embedding model (~279 MB by
  default) in each browser and indexes the existing notes. Both happen in the
  background and can be avoided entirely by setting
  `NUXT_PUBLIC_EMBEDDINGS_ENABLED=false`.

## 0.1.0 - 2026-07-28

Initial open-source release.

- Self-hosted rich-text notes with inline tags, search, attachments, sharing, and an installable PWA
- Email/password authentication with optional Discord OAuth
- Optional per-user OpenRouter integration and AI usage history
- One-command Docker Compose deployment with PostgreSQL, health checks, automatic Drizzle schema setup, and persistent storage
- Standalone GitHub Pages marketing site
