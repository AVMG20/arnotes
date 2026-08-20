import { db } from '../db'
import { projects, projectColumns } from '../db/schema'
import { desc } from 'drizzle-orm'
import { getProjectAccessFilter, genId } from '../utils/projects'
import { getUserActiveTeamId } from '../utils/auth-helpers'

export const DEFAULT_COLUMNS = ['Backlog', 'To do', 'Verify', 'Done'] as const

export default defineEventHandler(async (event) => {
  if (event.method === 'GET') {
    const filter = await getProjectAccessFilter(event)
    return db.select().from(projects).where(filter).orderBy(desc(projects.updatedAt))
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

  await db.insert(projectColumns).values(
    DEFAULT_COLUMNS.map((name, i) => ({
      id: genId(),
      projectId: id,
      name,
      position: i * 1000,
      createdAt: now
    }))
  )

  return project
})
