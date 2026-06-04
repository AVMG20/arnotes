---
name: project-notes-app
description: Architecture and feature summary for the Nuxt notes app in this repo
metadata:
  type: project
---

Full-featured notes app built with Nuxt 4, Nuxt UI v4, Tiptap, lowdb, MiniSearch, date-fns.

**Layout:** Three-panel — `NotesTagsPanel` (w-44) | `NotesListPanel` (w-60) | `NotesEditor` (flex-1)

**Storage:** Server-side via Nitro API routes + lowdb JSONFile at `data/notes.json`. No localStorage.

**Key files:**
- `server/utils/db.ts` — lowdb singleton
- `server/api/notes.get|post.ts` + `server/api/notes/[id].put|delete.ts`
- `app/composables/useNotes.ts` — module-level reactive singleton, MiniSearch, tag tracking
- `app/plugins/init-notes.client.ts` — async plugin: fetches notes, seeds welcome note, inits MiniSearch
- `app/composables/useDateMention.ts` — Tiptap `@` date mention node + suggestion dropdown
- `app/composables/useRelativeTime.ts` — shared date-fns relative time formatter
- `app/components/NotesTagsPanel.vue` — left nav: All Notes + tags
- `app/components/NotesListPanel.vue` — middle: search trigger + notes list
- `app/components/NotesEditor.vue` — Tiptap editor with toolbar, autosave, markdown paste
- `app/components/CodeBlockView.vue` — custom NodeView for code blocks with language picker
- `app/components/NotesSearchModal.vue` — ⌘K palette: recent tags, recent notes, create from query
- `app/components/DateSuggestionList.vue` — dropdown for `@` date suggestions

**Editor extensions:** StarterKit, CodeBlockLowlight (custom NodeView), Highlight, TaskList, TaskItem, Placeholder, DateMention, HashtagHighlight (ProseMirror decoration plugin)

**Global shortcuts:** ⌘K search, ⌘N new note, ⌘W delete active note

**Tag system:** `#tag` in note body (outside code blocks) auto-extracts tags. Active tag auto-applied on new note creation (tag placed on line 2 so line 1 is free for title).

**Why:** `updatedAt` sort — notes sort by last edit, but only actual edits trigger a save (dirty flag); clicking a note without editing does not update `updatedAt`.
