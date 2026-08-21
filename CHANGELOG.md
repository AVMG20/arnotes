# Changelog

All notable changes to Arnotes are documented in this file.

## Unreleased

- Projects: kanban boards beside the notes, with columns, drag-and-drop tasks, labels, rich-text descriptions written in the notes editor, and a running log of updates per task
- MCP server at `/api/mcp` letting Claude Code and other AI agents search, read, create, and edit notes
- Full board control over MCP: read boards and tasks, create and rename boards and columns, create, edit, move and delete tasks, and post task updates
- Live updates over a WebSocket at `/_ws`: a change made by an agent, a teammate or another tab appears without a reload, including in an open task panel
- Shareable boards: a read-only public link to a kanban board, optionally expiring, with no sidebar and no editing — the same deal a shared note gets
- Public pages follow the socket too, so a shared note or board updates while it is open and goes dark the moment sharing stops
- API keys scoped per workspace and per permission — notes and boards, read and write — managed under Settings, stored only as hashes and revocable at any time
- In-app setup guide at `/mcp` with the endpoint for your install, client configuration snippets, and a copyable agent skill
- Cards count their own checklists: a task list in a description shows as `2/4` on the card, with no subtask feature to manage
- Cards carry a due date read from the `@date` mentions already in their description, turning red once it is behind them
- Boards say how much is left rather than how much there has ever been: `8/47`, counting against whichever columns read as finished
- Labels autocomplete from the ones the board already uses, so a label stays one label
- The board can be walked from the keyboard: arrows move between cards, Enter opens one, `n` starts a card in the column you are on
- Long columns fold their tail behind one line, so a board that has been collecting finished work for months still opens quickly
- Fixed: dragging a card while a label filter was on could give two cards the same position, leaving them to swap places on their own
- Fixed: deleting a board's last column destroyed its tasks while the confirmation promised they would move
- Fixed: a card picked up on a touch screen no longer swallows the scroll — a card drags after a short hold

## 0.1.0 - 2026-07-28

Initial open-source release.

- Self-hosted rich-text notes with inline tags, search, attachments, sharing, and an installable PWA
- Email/password authentication with optional Discord OAuth
- Optional per-user OpenRouter integration and AI usage history
- One-command Docker Compose deployment with PostgreSQL, health checks, automatic Drizzle schema setup, and persistent storage
- Standalone GitHub Pages marketing site
