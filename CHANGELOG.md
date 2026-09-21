# Changelog

All notable changes to Arnotes are documented in this file.

## Unreleased

- The editor takes whatever is pasted into it: formatted text keeps its formatting, Markdown source becomes what it describes, a URL over a selection links it, code copied from VS Code lands in a code block of the right language, and checkbox lists from GitHub or Notion become task lists. Copying out puts Markdown on the plain-text side of the clipboard
- The selection toolbar gains **Turn into**, underline, six highlight colours and inline link editing (`⌘⇧K`); resting the caret in a link shows where it goes, with open, edit, copy and remove
- Every block has a handle: `+` adds a block below, the grip drags it — list items included, at any depth — and a click opens duplicate, copy as Markdown, move and delete. `⌥↑` / `⌥↓` move the current block or list item, `⌘⇧D` duplicates it
- `@` reads dates the way they are typed, in English or Dutch: `@fri`, `@in 3 days`, `@25 dec`, `@morgen om 14u`, `@2026-10-01`
- Global search is one keyboard-driven list: recent notes and tasks can be opened with the arrows before anything is typed, and `Tab` switches between All, Notes and Tasks
- Removed Archive, the memory assistant, along with its tables and its setting
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
- Boards have a trash: deleting a column or a task moves it there instead of destroying it, and **Show trashed** in the board menu draws the deleted columns and cards faded and in place, each with Restore and Delete permanently. The trash empties itself after 7 days
- Nothing an AI agent can reach deletes permanently any more. `delete_column` and `delete_task` move to the trash and are undone with the new `restore_column` and `restore_task`; a trashed row records whether it was the user, an MCP agent or the in-app assistant that deleted it
- Removed `delete_board` from the MCP server. Deleting a board takes its columns, tasks and updates with it, so it stays in the app behind a confirmation where an agent cannot reach it
- Restoring a column brings its tasks back: the ones handed to a neighbour when it was deleted return, unless they have since been filed somewhere on purpose
- Columns and task labels can be given a colour of their own, from the same palette as the accent in Settings: a column through **Change color** in its menu, a label by right-clicking it anywhere it appears. Both fall back to the colour derived from their name until one is set, and agents can colour a column through `update_column`
- Task updates take Markdown, deliberately a narrow one: bold, italic, inline code, strike, highlight and links, and nothing that opens a block. The update box is the editor itself with none of an editor's furniture — no toolbar, no border — so `**shipped**` turns bold as it is typed
- Updates posted over MCP are signed with the API key that posted them and marked as an agent's, instead of appearing under the key owner's name
- Global search takes a half-typed tag: `#sani` filters by every tag it could still complete to, and a tag now narrows tasks and boards as well as notes, matching a task's labels or its board's name
- Global search can be pointed at one half of the workspace with an All / Notes / Tasks switch, and the row of tag chips is gone — `#tag` in the box does the same job
- Task updates are for people again: `add_task_update` is gone from the MCP server, so the log holds what the team writes — on staging, customer feedback, needs more work — and not an agent's summary of its own session. Agents can still read the thread through `get_task`
- A task's updates open in a sheet of their own from a button in the task panel's header, instead of taking the bottom of the panel away from the description
- The board menu no longer carries a dot when something is in the trash
- Your own task updates can be edited in place or deleted from the update's menu; an edited update says so
- Opening a board changes the page on the click: the board being left is no longer drawn again under the new one, a board seen before comes back from memory while it refreshes, the first cards of each column paint before the rest, and label chips build their right-click menu only when it is used
- Fixed: dragging a card while a label filter was on could give two cards the same position, leaving them to swap places on their own
- Fixed: deleting a board's last column destroyed its tasks while the confirmation promised they would move
- Fixed: a card picked up on a touch screen no longer swallows the scroll — a card drags after a short hold
- Fixed: the editor's divider did nothing. It was offered in the `/` menu but the extension behind it was switched off, so the entry was dead; it now works from there, from a new toolbar button, and by typing `---`

## 0.1.0 - 2026-07-28

Initial open-source release.

- Self-hosted rich-text notes with inline tags, search, attachments, sharing, and an installable PWA
- Email/password authentication with optional Discord OAuth
- Optional per-user OpenRouter integration and AI usage history
- One-command Docker Compose deployment with PostgreSQL, health checks, automatic Drizzle schema setup, and persistent storage
- Standalone GitHub Pages marketing site
