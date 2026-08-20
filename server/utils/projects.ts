import type { H3Event } from 'h3'
import { db } from '../db'
import { projects, projectColumns, projectTasks } from '../db/schema'
import { eq, and, asc } from 'drizzle-orm'
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

export async function requireColumn(event: H3Event, columnId: string) {
  const [column] = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.id, columnId))

  if (!column) throw createError({ statusCode: 404, message: 'Column not found' })
  const project = await requireProject(event, column.projectId)
  return { column, project }
}

export async function requireTask(event: H3Event, taskId: string) {
  const [task] = await db
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.id, taskId))

  if (!task) throw createError({ statusCode: 404, message: 'Task not found' })
  const project = await requireProject(event, task.projectId)
  return { task, project }
}

export async function projectColumnsOrdered(projectId: string) {
  return db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.projectId, projectId))
    .orderBy(asc(projectColumns.position))
}

export async function columnTasksOrdered(columnId: string) {
  return db
    .select()
    .from(projectTasks)
    .where(eq(projectTasks.columnId, columnId))
    .orderBy(asc(projectTasks.position))
}

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
  const byId = new Map(list.map(i => [i.id, i]))
  const ordered = [...list].sort((a, b) => a.position - b.position)

  // A neighbour the caller named but the list does not hold means its view raced
  // with a delete. That side is treated as open rather than retried: rebuilding
  // the list cannot conjure up an id that is gone, so retrying would never end.
  const before = beforeId ? byId.get(beforeId)?.position ?? null : null
  const after = afterId ? byId.get(afterId)?.position ?? null : null

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
