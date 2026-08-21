import { db } from '../db'
import { projects, projectColumns } from '../db/schema'
import { asc, desc, inArray } from 'drizzle-orm'
import { getProjectAccessFilter, genId } from '../utils/projects'
import { getUserActiveTeamId } from '../utils/auth-helpers'
import { publishFromEvent } from '../utils/realtime'
import { terminalColumnIds } from '#shared/utils/board'

export const DEFAULT_COLUMNS = ['Backlog', 'To do', 'Verify', 'Done'] as const

export default defineEventHandler(async (event) => {
  if (event.method === 'GET') {
    const filter = await getProjectAccessFilter(event)
    const rows = await db.select().from(projects).where(filter).orderBy(desc(projects.updatedAt))
    if (!rows.length) return []

    // Which columns count as finished, so the sidebar can say how much of a
    // board is still open without loading the board. The tasks themselves are
    // already on the client from /api/tasks; only the shape of the board is
    // missing, and it is a handful of rows per project.
    const columns = await db
      .select({
        id: projectColumns.id,
        projectId: projectColumns.projectId,
        name: projectColumns.name
      })
      .from(projectColumns)
      .where(inArray(projectColumns.projectId, rows.map(p => p.id)))
      .orderBy(asc(projectColumns.position))

    const byProject = new Map<string, { id: string, name: string }[]>()
    for (const column of columns) {
      const list = byProject.get(column.projectId)
      if (list) list.push(column)
      else byProject.set(column.projectId, [column])
    }

    return rows.map((project) => {
      const own = byProject.get(project.id) ?? []
      return { ...project, terminalColumnIds: terminalColumnIds(own) }
    })
  }

  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  // POST — create project with the default kanban columns seeded.
  const body = await readBody<{ name?: string }>(event)
  const userId = event.context.session.user.id
  const teamId = await getUserActiveTeamId(event)
  const now = Date.now()
  const id = genId()

  const [project] = await db.insert(projects).values({
    id,
    userId,
    teamId,
    name: body.name?.trim() || 'Untitled project',
    createdAt: now,
    updatedAt: now
  }).returning()

  const seeded = DEFAULT_COLUMNS.map((name, i) => ({
    id: genId(),
    projectId: id,
    name,
    position: i * 1000,
    createdAt: now
  }))
  await db.insert(projectColumns).values(seeded)

  await publishFromEvent(event, { type: 'projects' })
  // Same shape the list answers with, so a board created here counts its tasks
  // the same way as one that arrived on load.
  return { ...project, terminalColumnIds: terminalColumnIds(seeded) }
})
