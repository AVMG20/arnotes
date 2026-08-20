// The note tools Arnotes exposes over MCP. Unlike the in-app chat tools — which
// are declared on the server but executed in the browser against the notes store
// — these run here, against the database, scoped to the workspace and permissions
// of the API key that authenticated the request. Board tools live beside them in
// mcpBoardTools.ts and are folded into the registry at the bottom of this file.
import { and, desc, eq, isNull, isNotNull } from 'drizzle-orm'
import { join } from 'path'
import { unlinkSync } from 'fs'
import { db } from '../db'
import { notes } from '../db/schema'
import type { ApiKeyScope, Note } from '../db/schema'
import type { ApiKeyContext } from './api-keys'
import { noteAccessFilter } from './auth-helpers'
import { extractTags, extractTitle, htmlToMarkdown, htmlToPlainText, markdownToHtml, prependTitle, setNoteTags, setTitleInContent } from './markdown'
import { McpToolError, newId, optionalLimit, optionalString, optionalStringArray, requireString } from './mcpToolKit'
import type { McpToolDefinition } from './mcpToolKit'
import { MCP_BOARD_TOOLS } from './mcpBoardTools'

// ─── shared shapes ────────────────────────────────────────────────────────────

function workspaceFilter(context: ApiKeyContext) {
  return noteAccessFilter(context.userId, context.teamId)
}

function summarize(note: Note, snippet?: string) {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    updatedAt: new Date(note.updatedAt).toISOString(),
    createdAt: new Date(note.createdAt).toISOString(),
    ...(note.deletedAt ? { trashed: true } : {}),
    ...(snippet ? { snippet } : {})
  }
}

function detail(note: Note) {
  return {
    ...summarize(note),
    content: htmlToMarkdown(note.content)
  }
}

async function findNote(id: string, context: ApiKeyContext): Promise<Note> {
  const [note] = await db.select().from(notes).where(and(eq(notes.id, id), workspaceFilter(context)))
  if (!note) throw new McpToolError(`No note with id "${id}" exists in this workspace.`)
  return note
}

/**
 * Drops attachment files the new body no longer references, matching what the
 * web editor does on save so replaced content does not leak files onto disk.
 */
function pruneAttachments(noteId: string, attachments: string[], content: string): string[] {
  const kept: string[] = []
  for (const file of attachments) {
    if (content.includes(file)) {
      kept.push(file)
      continue
    }
    try {
      unlinkSync(join(process.cwd(), 'data', 'attachments', noteId, file))
    } catch {
      // A missing attachment is already in the desired state.
    }
  }
  return kept
}

/**
 * Builds the stored HTML for a write. Titles and tags are both derived from the
 * body in Arnotes, so they are written into the content rather than kept beside
 * it — exactly as the editor does.
 *
 * A new note gets its title prepended so nothing the caller wrote is lost; an
 * edit rewrites the leading heading instead, which is what renaming a note means
 * here.
 */
function composeNote(options: { html: string, title?: string, tags?: string[], titleMode: 'prepend' | 'rewrite' }) {
  let html = options.html
  if (options.title !== undefined) {
    html = options.titleMode === 'prepend'
      ? prependTitle(html, options.title)
      : setTitleInContent(html, options.title)
  }
  if (options.tags !== undefined) html = setNoteTags(html, options.tags)

  return { content: html, title: extractTitle(html), tags: extractTags(html) }
}

function snippetFor(text: string, terms: string[]): string {
  const lowered = text.toLowerCase()
  const firstHit = terms.map(term => lowered.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstHit - 60)
  const snippet = text.slice(start, start + 200).trim()
  return (start > 0 ? '…' : '') + snippet + (start + 200 < text.length ? '…' : '')
}

// ─── tools ────────────────────────────────────────────────────────────────────

const NOTE_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_notes',
    title: 'List notes',
    description: 'List notes in the workspace, most recently updated first. Use this to get an overview; use search_notes when looking for something specific.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum notes to return (default 25, max 200).' },
        tag: { type: 'string', description: 'Only return notes carrying this tag (without the # prefix).' },
        trashed: { type: 'boolean', description: 'Return trashed notes instead of active ones. Defaults to false.' }
      }
    },
    async handler(args, context) {
      const limit = optionalLimit(args, 'limit', 25, 200)
      const tag = optionalString(args, 'tag')?.replace(/^#/, '').toLowerCase()
      const trashed = args.trashed === true

      const rows = await db
        .select()
        .from(notes)
        .where(and(workspaceFilter(context), trashed ? isNotNull(notes.deletedAt) : isNull(notes.deletedAt)))
        .orderBy(desc(notes.updatedAt))

      const filtered = tag ? rows.filter(note => note.tags.includes(tag)) : rows
      return {
        total: filtered.length,
        notes: filtered.slice(0, limit).map(note => summarize(note))
      }
    }
  },
  {
    name: 'search_notes',
    title: 'Search notes',
    description: 'Full-text search over note titles, bodies and tags. All words in the query must appear somewhere in a note. Returns matching notes with a snippet; follow up with get_note to read one in full.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for. An empty string matches every note.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only return notes carrying all of these tags.' },
        limit: { type: 'number', description: 'Maximum notes to return (default 20, max 100).' }
      },
      required: ['query']
    },
    async handler(args, context) {
      const query = optionalString(args, 'query') ?? ''
      const tags = (optionalStringArray(args, 'tags') ?? []).map(tag => tag.replace(/^#/, '').toLowerCase())
      const limit = optionalLimit(args, 'limit', 20, 100)
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

      const rows = await db
        .select()
        .from(notes)
        .where(and(workspaceFilter(context), isNull(notes.deletedAt)))
        .orderBy(desc(notes.updatedAt))

      const matches = rows
        .filter(note => tags.every(tag => note.tags.includes(tag)))
        .map((note) => {
          const text = htmlToPlainText(note.content)
          const haystack = `${note.title} ${note.tags.join(' ')} ${text}`.toLowerCase()
          if (!terms.every(term => haystack.includes(term))) return null

          const titleHits = terms.filter(term => note.title.toLowerCase().includes(term)).length
          return { note, text, titleHits }
        })
        .filter((match): match is { note: Note, text: string, titleHits: number } => match !== null)
        // Notes whose title matches come first; the query ordering keeps the rest recent.
        .sort((a, b) => b.titleHits - a.titleHits)

      return {
        total: matches.length,
        notes: matches.slice(0, limit).map(({ note, text }) => summarize(note, snippetFor(text, terms)))
      }
    }
  },
  {
    name: 'get_note',
    title: 'Read a note',
    description: 'Read one note in full, with its body as Markdown. Use ids returned by list_notes or search_notes.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      return detail(await findNote(requireString(args, 'id'), context))
    }
  },
  {
    name: 'list_tags',
    title: 'List tags',
    description: 'List every tag used in the workspace with how many notes carry it. Useful for finding the right tag before searching.',
    scope: 'notes:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    async handler(_args, context) {
      const rows = await db
        .select({ tags: notes.tags })
        .from(notes)
        .where(and(workspaceFilter(context), isNull(notes.deletedAt)))

      const counts = new Map<string, number>()
      for (const row of rows) {
        for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }

      return {
        tags: [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([tag, count]) => ({ tag, count }))
      }
    }
  },
  {
    name: 'create_note',
    title: 'Create a note',
    description: 'Create a note from Markdown. The title becomes the note\'s leading heading and tags are appended to the body as #hashtags, which is how Arnotes stores them, so do not repeat either inside the body.',
    scope: 'notes:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title. Becomes the leading heading of the body.' },
        content: { type: 'string', description: 'Markdown body. Supports headings, lists, "- [ ]" checklists, tables and fenced code.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the note, without the # prefix.' }
      },
      required: ['title']
    },
    async handler(args, context) {
      const title = requireString(args, 'title')
      const markdown = optionalString(args, 'content') ?? ''
      const tags = optionalStringArray(args, 'tags') ?? []
      const now = Date.now()

      const composed = composeNote({ html: markdownToHtml(markdown), title, tags, titleMode: 'prepend' })

      const [created] = await db.insert(notes).values({
        id: newId(),
        userId: context.userId,
        teamId: context.teamId,
        title: composed.title,
        content: composed.content,
        tags: composed.tags,
        attachments: [],
        createdAt: now,
        updatedAt: now
      }).returning()

      return detail(created!)
    }
  },
  {
    name: 'update_note',
    title: 'Update a note',
    description: 'Update an existing note. Only the fields you pass change, and each one replaces its value entirely — pass the complete new body, not a diff. Read the note first when making a partial edit.',
    scope: 'notes:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id.' },
        title: { type: 'string', description: 'New title. Rewrites the note\'s leading heading.' },
        content: { type: 'string', description: 'Complete replacement Markdown body.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Complete replacement tag list, without the # prefix. Tags written inline in the body stay.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const id = requireString(args, 'id')
      const title = optionalString(args, 'title')
      const markdown = optionalString(args, 'content')
      const tags = optionalStringArray(args, 'tags')

      if (title === undefined && markdown === undefined && tags === undefined) {
        throw new McpToolError('Pass at least one of "title", "content" or "tags".')
      }

      const existing = await findNote(id, context)
      if (existing.deletedAt) {
        throw new McpToolError(`Note "${id}" is in the trash. Restore it with restore_note before editing.`)
      }

      const composed = composeNote({
        html: markdown === undefined ? existing.content : markdownToHtml(markdown),
        title,
        tags,
        titleMode: 'rewrite'
      })

      // Only a body replacement can orphan an attachment.
      const attachments = markdown === undefined || !existing.attachments.length
        ? undefined
        : pruneAttachments(id, existing.attachments, composed.content)

      const [updated] = await db
        .update(notes)
        .set({
          title: composed.title,
          content: composed.content,
          tags: composed.tags,
          ...(attachments !== undefined && { attachments }),
          updatedAt: Date.now()
        })
        .where(and(eq(notes.id, id), workspaceFilter(context)))
        .returning()

      return detail(updated!)
    }
  },
  {
    name: 'delete_note',
    title: 'Trash a note',
    description: 'Move a note to the trash. This is reversible with restore_note; nothing is permanently deleted.',
    scope: 'notes:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const id = requireString(args, 'id')
      const existing = await findNote(id, context)
      if (existing.deletedAt) return { id, alreadyTrashed: true }

      const [trashed] = await db
        .update(notes)
        .set({ deletedAt: Date.now() })
        .where(and(eq(notes.id, id), workspaceFilter(context)))
        .returning()

      return { trashed: true, note: summarize(trashed!) }
    }
  },
  {
    name: 'restore_note',
    title: 'Restore a note',
    description: 'Bring a note back out of the trash.',
    scope: 'notes:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const id = requireString(args, 'id')
      const existing = await findNote(id, context)
      if (!existing.deletedAt) return { id, alreadyActive: true }

      const [restored] = await db
        .update(notes)
        .set({ deletedAt: null, updatedAt: Date.now() })
        .where(and(eq(notes.id, id), workspaceFilter(context)))
        .returning()

      return { restored: true, note: summarize(restored!) }
    }
  }
]

export const MCP_TOOLS: McpToolDefinition[] = [...NOTE_TOOLS, ...MCP_BOARD_TOOLS]

export function toolsForScopes(scopes: ApiKeyScope[]): McpToolDefinition[] {
  return MCP_TOOLS.filter(tool => scopes.includes(tool.scope))
}
