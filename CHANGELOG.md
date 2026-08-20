# Changelog

All notable changes to Arnotes are documented in this file.

## Unreleased

- MCP server at `/api/mcp` letting Claude Code and other AI agents search, read, create, and edit notes
- API keys scoped per workspace and per permission, managed under Settings, stored only as hashes and revocable at any time
- In-app setup guide at `/mcp` with the endpoint for your install, client configuration snippets, and a copyable agent skill

## 0.1.0 - 2026-07-28

Initial open-source release.

- Self-hosted rich-text notes with inline tags, search, attachments, sharing, and an installable PWA
- Email/password authentication with optional Discord OAuth
- Optional per-user OpenRouter integration and AI usage history
- One-command Docker Compose deployment with PostgreSQL, health checks, automatic Drizzle schema setup, and persistent storage
- Standalone GitHub Pages marketing site
