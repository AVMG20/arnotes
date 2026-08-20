# Changelog

All notable changes to Arnotes are documented in this file.

## Unreleased

- Projects: kanban boards beside the notes, with columns, drag-and-drop tasks, labels, rich-text descriptions written in the notes editor, and a running log of updates per task
- MCP server at `/api/mcp` letting Claude Code and other AI agents search, read, create, and edit notes
- Full board control over MCP: read boards and tasks, create and rename boards and columns, create, edit, move and delete tasks, and post task updates
- API keys scoped per workspace and per permission — notes and boards, read and write — managed under Settings, stored only as hashes and revocable at any time
- In-app setup guide at `/mcp` with the endpoint for your install, client configuration snippets, and a copyable agent skill

## 0.1.0 - 2026-07-28

Initial open-source release.

- Self-hosted rich-text notes with inline tags, search, attachments, sharing, and an installable PWA
- Email/password authentication with optional Discord OAuth
- Optional per-user OpenRouter integration and AI usage history
- One-command Docker Compose deployment with PostgreSQL, health checks, automatic Drizzle schema setup, and persistent storage
- Standalone GitHub Pages marketing site
