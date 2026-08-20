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
  renumber: (ids: string[]) => Promise<void>
): Promise<number> {
  const byId = new Map(list.map(i => [i.id, i]))
  // undefined = the neighbor id no longer exists (stale client state); null = no
  // neighbor on that side.
  const before: number | null | undefined = beforeId ? byId.get(beforeId)?.position : null
  const after: number | null | undefined = afterId ? byId.get(afterId)?.position : null

  const normalized = async () => {
    const ids = [...list].sort((a, b) => a.position - b.position).map(i => i.id)
    await renumber(ids)
    return ids.map((id, idx) => ({ id, position: idx * 1000 }))
  }

  // Stale neighbor ids (list raced with a delete) → renumber, then recompute.
  if (before === undefined || after === undefined) {
    return positionBetween(await normalized(), beforeId, afterId, renumber)
  }

  // No neighbors on either side means "append": an empty column lands at 0, a
  // programmatic move (AI tools) goes after the last card instead of colliding
  // with position 0.
  if (before === null && after === null) {
    const last = [...list].sort((a, b) => a.position - b.position).at(-1)
    return last ? last.position + 1000 : 0
  }
  if (before === null) return (after as number) - 1000
  if (after === null) return before + 1000
  if (after - before <= 1) {
    return positionBetween(await normalized(), beforeId, afterId, renumber)
  }
  return Math.floor((before + after) / 2)
}
