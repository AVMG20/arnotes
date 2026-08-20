import { db } from '../../../db'
import { projects, projectColumns } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireProject, projectColumnsOrdered, positionBetween, genId } from '../../../utils/projects'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await requireProject(event, id)

  const body = await readBody<{ name?: string, beforeId?: string | null, afterId?: string | null }>(event)
  const name = body.name?.trim() || 'New column'

  const existing = await projectColumnsOrdered(id)
  const position = await positionBetween(
    existing.map(c => ({ id: c.id, position: c.position })),
    body.beforeId ?? null,
    body.afterId ?? null,
    async (ids) => {
      for (const [idx, cid] of ids.entries()) {
        await db.update(projectColumns).set({ position: idx * 1000 }).where(eq(projectColumns.id, cid))
      }
    }
  )

  const [column] = await db.insert(projectColumns).values({
    id: genId(),
    projectId: id,
    name,
    position,
    createdAt: Date.now()
  }).returning()

  await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, id))

  return column
})
