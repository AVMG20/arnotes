// Every read and write Archive performs, scoped to one workspace.
//
// Nothing here is reachable from the notes or boards side of the app, and the
// assistant's tools are reachable from nothing else: Archive keeps its own two
// tables so that "the assistant manages this" and "the user manages this" never
// describe the same row.
import type { H3Event } from 'h3'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import {
  archiveMemories,
  archiveMessages,
  archiveTodos,
  ARCHIVE_INDEX_LIMIT,
  ARCHIVE_TODO_DIGEST_LIMIT
} from '../db/schema'
import type { ArchiveMemory, ArchiveTodo } from '../db/schema'
import { getUserActiveTeamId } from './auth-helpers'

export interface ArchiveScope {
  userId: string
  teamId: string | null
}

export async function archiveScope(event: H3Event): Promise<ArchiveScope> {
  return {
    userId: event.context.session.user.id,
    teamId: await getUserActiveTeamId(event)
  }
}

/** Ids are prefixed so the assistant cannot hand a todo id to a memory tool. */
function newId(prefix: 'm' | 't' | 'msg'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const newMemoryId = () => newId('m')
export const newTodoId = () => newId('t')
export const newMessageId = () => newId('msg')

// Same rule as notes: every memory of the active team, or only the caller's own
// team-less memories when they are in their personal workspace.
function memoryScopeFilter({ userId, teamId }: ArchiveScope) {
  return teamId
    ? eq(archiveMemories.teamId, teamId)
    : and(eq(archiveMemories.userId, userId), isNull(archiveMemories.teamId))
}

function todoScopeFilter({ userId, teamId }: ArchiveScope) {
  return teamId
    ? eq(archiveTodos.teamId, teamId)
    : and(eq(archiveTodos.userId, userId), isNull(archiveTodos.teamId))
}

export function messageScopeFilter({ userId, teamId }: ArchiveScope) {
  return teamId
    ? eq(archiveMessages.teamId, teamId)
    : and(eq(archiveMessages.userId, userId), isNull(archiveMessages.teamId))
}

const liveMemory = (scope: ArchiveScope) => and(memoryScopeFilter(scope), isNull(archiveMemories.deletedAt))
const liveTodo = (scope: ArchiveScope) => and(todoScopeFilter(scope), isNull(archiveTodos.deletedAt))

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

// ─── Reads ────────────────────────────────────────────────────────────────────

export function listMemories(scope: ArchiveScope, limit = ARCHIVE_INDEX_LIMIT * 2): Promise<ArchiveMemory[]> {
  return db.select().from(archiveMemories)
    .where(liveMemory(scope))
    .orderBy(desc(archiveMemories.updatedAt))
    .limit(limit)
}

/** Ceiling on what the sidebar is handed in one go. */
const STORE_LIMIT = 1000

/** Live and forgotten alike, for the sidebar's storage view. */
export function listAllMemories(scope: ArchiveScope): Promise<ArchiveMemory[]> {
  return db.select().from(archiveMemories)
    .where(memoryScopeFilter(scope))
    .orderBy(desc(archiveMemories.updatedAt))
    .limit(STORE_LIMIT)
}

/** Open and done, but not dropped: a dropped todo has nothing to restore into. */
export function listAllTodos(scope: ArchiveScope): Promise<ArchiveTodo[]> {
  return db.select().from(archiveTodos)
    .where(liveTodo(scope))
    .orderBy(desc(archiveTodos.createdAt))
    .limit(STORE_LIMIT)
}

export function getMemories(scope: ArchiveScope, ids: string[]): Promise<ArchiveMemory[]> {
  if (!ids.length) return Promise.resolve([])
  return db.select().from(archiveMemories)
    .where(and(memoryScopeFilter(scope), inArray(archiveMemories.id, ids)))
}

export function getTodos(scope: ArchiveScope, ids: string[]): Promise<ArchiveTodo[]> {
  if (!ids.length) return Promise.resolve([])
  return db.select().from(archiveTodos)
    .where(and(todoScopeFilter(scope), inArray(archiveTodos.id, ids)))
}

export function listOpenTodos(scope: ArchiveScope, limit = ARCHIVE_TODO_DIGEST_LIMIT + 1): Promise<ArchiveTodo[]> {
  return db.select().from(archiveTodos)
    .where(and(liveTodo(scope), eq(archiveTodos.done, false)))
    .orderBy(desc(archiveTodos.createdAt))
    .limit(limit)
}

export function listTodosForMemories(scope: ArchiveScope, memoryIds: string[]): Promise<ArchiveTodo[]> {
  if (!memoryIds.length) return Promise.resolve([])
  return db.select().from(archiveTodos)
    .where(and(liveTodo(scope), inArray(archiveTodos.memoryId, memoryIds)))
}

// LIKE wildcards inside a user's search term would silently widen the match.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, char => `\\${char}`)
}

export async function searchMemories(
  scope: ArchiveScope,
  query: string,
  tags: string[] = [],
  limit = 25
): Promise<ArchiveMemory[]> {
  const terms = query.toLowerCase().split(/\s+/).map(t => t.trim()).filter(Boolean)
  const wanted = tags.map(t => t.toLowerCase()).filter(Boolean)

  const conditions = [liveMemory(scope)]
  for (const term of terms) {
    const pattern = `%${escapeLike(term)}%`
    conditions.push(sql`(${archiveMemories.title} ILIKE ${pattern} OR ${archiveMemories.body} ILIKE ${pattern})`)
  }

  const rows = await db.select().from(archiveMemories)
    .where(and(...conditions))
    .orderBy(desc(archiveMemories.updatedAt))
    .limit(limit * 4)

  // Tags are a JSON array, which is far easier to match here than in SQL, and
  // the row set above is already bounded.
  const filtered = wanted.length
    ? rows.filter(row => wanted.every(tag => row.tags.some(own => own.toLowerCase() === tag)))
    : rows

  return filtered.slice(0, limit)
}

// ─── Context blocks ───────────────────────────────────────────────────────────

/**
 * The catalogue sent on every turn. It is what lets the assistant notice that
 * something is already stored — and that one of two overlapping entries is the
 * stale one — without spending a search first.
 *
 * Beyond a point that catalogue would grow without limit, so it degrades: the
 * newest entries keep their tags and dates, older ones fall back to a title, and
 * the remainder become a count and a nudge to search.
 */
export function buildMemoryIndex(rows: ArchiveMemory[]): string {
  if (!rows.length) return 'MEMORY INDEX: empty. Nothing has been stored yet.'

  const detailed = rows.slice(0, Math.floor(ARCHIVE_INDEX_LIMIT / 2))
  const brief = rows.slice(detailed.length, ARCHIVE_INDEX_LIMIT)

  const lines = detailed.map(row =>
    `${row.id} | ${row.title} | ${row.tags.join(',')} | ${day(row.updatedAt)}`
  )
  for (const row of brief) lines.push(`${row.id} | ${row.title}`)
  // No number here on purpose: the rows handed in are themselves capped, so any
  // count would understate how much is really out of view.
  if (rows.length > ARCHIVE_INDEX_LIMIT) {
    lines.push('…and more older memories — use search_memory to reach them.')
  }

  return `MEMORY INDEX (id | title | tags | updated), newest first:\n${lines.join('\n')}`
}

/**
 * Open work only. Finished todos leave the prompt on their own.
 *
 * `liveMemoryIds` is the set the index was built from. A todo outlives the
 * memory it came from — forgetting a plan does not cancel the work — but naming
 * a memory the assistant cannot see anywhere else reads as a dangling pointer,
 * so the source is only cited while it is still listed.
 */
export function buildTodoDigest(rows: ArchiveTodo[], liveMemoryIds?: Set<string>): string {
  if (!rows.length) return 'OPEN TODOS: none.'

  const shown = rows.slice(0, ARCHIVE_TODO_DIGEST_LIMIT)
  const lines = shown.map((row) => {
    const parts = [row.id, row.title]
    if (row.dueAt) parts.push(`due ${day(row.dueAt)}`)
    if (row.tags.length) parts.push(row.tags.join(','))
    if (row.memoryId && (!liveMemoryIds || liveMemoryIds.has(row.memoryId))) parts.push(`from ${row.memoryId}`)
    return parts.join(' | ')
  })
  if (rows.length > shown.length) lines.push(`…and more open todos not listed.`)

  return `OPEN TODOS (id | title | due | tags | source), newest first:\n${lines.join('\n')}`
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createMemory(
  scope: ArchiveScope,
  input: { title: string, body?: string, tags?: string[] }
): Promise<ArchiveMemory> {
  const now = Date.now()
  const [row] = await db.insert(archiveMemories).values({
    id: newMemoryId(),
    userId: scope.userId,
    teamId: scope.teamId,
    title: input.title.trim() || 'Untitled',
    body: input.body ?? '',
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now
  }).returning()
  return row!
}

export async function updateMemory(
  scope: ArchiveScope,
  id: string,
  patch: { title?: string, body?: string, tags?: string[] }
): Promise<ArchiveMemory | null> {
  const values: Partial<ArchiveMemory> = { updatedAt: Date.now() }
  if (patch.title !== undefined) values.title = patch.title.trim() || 'Untitled'
  if (patch.body !== undefined) values.body = patch.body
  if (patch.tags !== undefined) values.tags = normalizeTags(patch.tags)

  const [row] = await db.update(archiveMemories)
    .set(values)
    .where(and(memoryScopeFilter(scope), eq(archiveMemories.id, id), isNull(archiveMemories.deletedAt)))
    .returning()
  return row ?? null
}

export async function forgetMemories(scope: ArchiveScope, ids: string[]): Promise<ArchiveMemory[]> {
  if (!ids.length) return []
  const now = Date.now()
  return db.update(archiveMemories)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(memoryScopeFilter(scope), inArray(archiveMemories.id, ids), isNull(archiveMemories.deletedAt)))
    .returning()
}

export async function restoreMemory(scope: ArchiveScope, id: string): Promise<ArchiveMemory | null> {
  const [row] = await db.update(archiveMemories)
    .set({ deletedAt: null, updatedAt: Date.now() })
    .where(and(memoryScopeFilter(scope), eq(archiveMemories.id, id)))
    .returning()
  return row ?? null
}

/** Hard delete. Todos that hung off the memory keep standing, with the link cleared. */
export async function purgeMemory(scope: ArchiveScope, id: string): Promise<ArchiveMemory | null> {
  const [row] = await db.delete(archiveMemories)
    .where(and(memoryScopeFilter(scope), eq(archiveMemories.id, id)))
    .returning()
  return row ?? null
}

export interface TodoInput {
  title: string
  dueAt?: number | null
  tags?: string[]
  memoryId?: string | null
}

export async function createTodos(scope: ArchiveScope, inputs: TodoInput[]): Promise<ArchiveTodo[]> {
  const clean = inputs.filter(input => input.title?.trim())
  if (!clean.length) return []

  const now = Date.now()
  const [{ max } = { max: 0 }] = await db
    .select({ max: sql<number>`coalesce(max(${archiveTodos.position}), 0)` })
    .from(archiveTodos)
    .where(todoScopeFilter(scope))

  return db.insert(archiveTodos).values(clean.map((input, i) => ({
    id: newTodoId(),
    userId: scope.userId,
    teamId: scope.teamId,
    memoryId: input.memoryId || null,
    title: input.title.trim(),
    dueAt: input.dueAt ?? null,
    tags: normalizeTags(input.tags),
    position: Number(max) + i + 1,
    createdAt: now,
    updatedAt: now
  }))).returning()
}

export interface TodoPatch {
  title?: string
  done?: boolean
  dueAt?: number | null
  tags?: string[]
  memoryId?: string | null
}

export async function updateTodo(scope: ArchiveScope, id: string, patch: TodoPatch): Promise<ArchiveTodo | null> {
  const now = Date.now()
  const values: Partial<ArchiveTodo> = { updatedAt: now }
  if (patch.title !== undefined) values.title = patch.title.trim() || 'Untitled'
  if (patch.dueAt !== undefined) values.dueAt = patch.dueAt
  if (patch.tags !== undefined) values.tags = normalizeTags(patch.tags)
  if (patch.memoryId !== undefined) values.memoryId = patch.memoryId
  if (patch.done !== undefined) {
    values.done = patch.done
    // Kept so "what did I finish this week" is answerable later.
    values.doneAt = patch.done ? now : null
  }

  const [row] = await db.update(archiveTodos)
    .set(values)
    .where(and(todoScopeFilter(scope), eq(archiveTodos.id, id), isNull(archiveTodos.deletedAt)))
    .returning()
  return row ?? null
}

export async function updateTodos(
  scope: ArchiveScope,
  patches: Array<TodoPatch & { id: string }>
): Promise<ArchiveTodo[]> {
  const out: ArchiveTodo[] = []
  for (const { id, ...patch } of patches) {
    const row = await updateTodo(scope, id, patch)
    if (row) out.push(row)
  }
  return out
}

export async function dropTodos(scope: ArchiveScope, ids: string[]): Promise<ArchiveTodo[]> {
  if (!ids.length) return []
  const now = Date.now()
  return db.update(archiveTodos)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(todoScopeFilter(scope), inArray(archiveTodos.id, ids), isNull(archiveTodos.deletedAt)))
    .returning()
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const clean = tags
    .map(tag => String(tag).trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
  return [...new Set(clean)].slice(0, 12)
}
