import { db } from '../../../db'
import { projects, projectTasks } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireColumn, columnTasksOrdered, genId } from '../../../utils/projects'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ columnId: string, title?: string, description?: string, tags?: string[] }>(event)

  const { column, project } = await requireColumn(event, body.columnId)

  const existing = await columnTasksOrdered(column.id)
  const position = (existing[existing.length - 1]?.position ?? -1000) + 1000
  const now = Date.now()

  const [task] = await db.insert(projectTasks).values({
    id: genId(),
    projectId: project.id,
    columnId: column.id,
    title: body.title?.trim() || 'Untitled',
    description: body.description ?? '',
    tags: body.tags ?? [],
    position,
    createdAt: now,
    updatedAt: now
  }).returning()

  await db.update(projects).set({ updatedAt: now }).where(eq(projects.id, project.id))

  return task
})
