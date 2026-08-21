import type { H3Event } from 'h3'
import { db } from '../db'
import { projects, projectColumns, projectTasks } from '../db/schema'
import { eq, and, asc, isNull } from 'drizzle-orm'
import { getUserActiveTeamId, projectAccessFilter } from './auth-helpers'

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// Same scoping rule as notes: active team's projects, or own team-less projects
// in the personal workspace. The filter itself lives in auth-helpers so the MCP
// server, which authenticates with an API key instead of a session, applies the
// identical rule.
export async function getProjectAccessFilter(event: H3Event) {
  const userId = event.context.session.user.id
  return projectAccessFilter(userId, await getUserActiveTeamId(event))
}

// Resolves a project the caller may access, 404 otherwise. Column and task
// endpoints funnel through here so a foreign id never leaks workspace data.
export async function requireProject(event: H3Event, projectId: string) {
  const filter = await getProjectAccessFilter(event)
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), filter))

  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })
  return project
}

// Trashed rows are invisible everywhere by default; only the trash view and the
// restore endpoints ask for them, and they have to say so. Defaulting the other
// way is how a soft delete quietly leaks back into a board, a search index or a
// public link.
interface TrashOptions {
  includeDeleted?: boolean
}

export async function requireColumn(event: H3Event, columnId: string, options: TrashOptions = {}) {
  const [column] = await db
    .select()
    .from(projectColumns)
    .where(and(
      eq(projectColumns.id, columnId),
      options.includeDeleted ? undefined : isNull(projectColumns.deletedAt)
    ))

  if (!column) throw createError({ statusCode: 404, message: 'Column not found' })
  const project = await requireProject(event, column.projectId)
  return { column, project }
}

export async function requireTask(event: H3Event, taskId: string, options: TrashOptions = {}) {
  const [task] = await db
    .select()
    .from(projectTasks)
    .where(and(
      eq(projectTasks.id, taskId),
      options.includeDeleted ? undefined : isNull(projectTasks.deletedAt)
    ))

  if (!task) throw createError({ statusCode: 404, message: 'Task not found' })
  const project = await requireProject(event, task.projectId)
  return { task, project }
}

export async function projectColumnsOrdered(projectId: string, options: TrashOptions = {}) {
  return db
    .select()
    .from(projectColumns)
    .where(and(
      eq(projectColumns.projectId, projectId),
      options.includeDeleted ? undefined : isNull(projectColumns.deletedAt)
    ))
    .orderBy(asc(projectColumns.position))
}

// Ordering only ever concerns live cards: a trashed one keeps the position it
// had so it can go back there, and letting it into this list would have the
// renumber below hand its slot away while it sits in the trash.
export async function columnTasksOrdered(columnId: string) {
  return db
    .select()
    .from(projectTasks)
    .where(and(eq(projectTasks.columnId, columnId), isNull(projectTasks.deletedAt)))
    .orderBy(asc(projectTasks.position))
}

/** Stamps who deleted a row, for a delete arriving through the browser. */
export function uiDeletion(event: H3Event) {
  return {
    deletedAt: Date.now(),
    deletedBy: event.context.session.user.id,
    deletedVia: 'ui' as const
  }
}

/** Clears every trace of a delete, shared by the restore paths. */
export const RESTORED = {
  deletedAt: null,
  deletedBy: null,
  deletedVia: null
} as const

// Positions are integers spaced by 1000. A drag lands between two neighbors
// (either may be null at the ends). When the gap has collapsed, the caller's
// renumber callback rewrites the column first and the computation is retried on
// a normalized copy of the list.
export async function positionBetween(
  list: { id: string, position: number }[],
  beforeId: string | null,
  afterId: string | null,
  renumber: (ids: string[]) => Promise<void>,
  retried = false
): Promise<number> {
  const ordered = [...list].sort((a, b) => a.position - b.position)

  // A neighbour the caller named but the list does not hold means its view raced
  // with a delete. That side is treated as open rather than retried: rebuilding
  // the list cannot conjure up an id that is gone, so retrying would never end.
  const beforeIdx = beforeId ? ordered.findIndex(i => i.id === beforeId) : -1
  const afterIdx = afterId ? ordered.findIndex(i => i.id === afterId) : -1

  // Only one named neighbour is trusted; the opposite bound comes from the list
  // itself. The caller reports the cards it can see, and a board under a label
  // filter hides some of the column — so the card it names as the one below the
  // drop may have others between it and the drop point. Splitting the named pair
  // would then land straight on top of a hidden card's position. Anchoring to
  // the card the user actually dropped under, and bounding with *its* true
  // neighbour, puts the card where it was dropped and keeps positions unique.
  let before: number | null = null
  let after: number | null = null

  if (beforeIdx >= 0) {
    before = ordered[beforeIdx]!.position
    after = ordered[beforeIdx + 1]?.position ?? null
  } else if (afterIdx >= 0) {
    before = ordered[afterIdx - 1]?.position ?? null
    after = ordered[afterIdx]!.position
  }

  if (before === null && after === null) {
    // Nothing left to anchor to. A drop aimed above a card that has since been
    // deleted still belongs at the top; everything else appends — an empty
    // column lands at 0, and a programmatic move (the AI tools) goes after the
    // last card instead of colliding with position 0.
    if (afterId && !beforeId) {
      const first = ordered[0]
      return first ? first.position - 1000 : 0
    }
    const last = ordered.at(-1)
    return last ? last.position + 1000 : 0
  }
  if (before === null) return (after as number) - 1000
  if (after === null) return before + 1000

  // The gap has collapsed, or two rows share a position: spread the column out
  // and compute once more against the normalised copy. One retry is enough —
  // after a renumber every gap is 1000 — and capping it keeps a surprise (an
  // inverted pair, a failed renumber) from looping instead of answering.
  if (after - before <= 1) {
    if (retried) return before + 1
    const ids = ordered.map(i => i.id)
    await renumber(ids)
    const spread = ids.map((id, idx) => ({ id, position: idx * 1000 }))
    return positionBetween(spread, beforeId, afterId, renumber, true)
  }
  return Math.floor((before + after) / 2)
}

/** Rewrites a column's task positions to an even 1000-apart spread. */
export async function renumberColumnTasks(columnId: string) {
  const tasks = await columnTasksOrdered(columnId)
  for (const [index, task] of tasks.entries()) {
    if (task.position === index * 1000) continue
    await db.update(projectTasks).set({ position: index * 1000 }).where(eq(projectTasks.id, task.id))
  }
}
