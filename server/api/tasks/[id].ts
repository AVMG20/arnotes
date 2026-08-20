import { db } from '../../db'
import { projects, projectTasks } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireTask, requireColumn, columnTasksOrdered, positionBetween } from '../../utils/projects'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { task, project } = await requireTask(event, id)

  if (event.method === 'DELETE') {
    await db.delete(projectTasks).where(eq(projectTasks.id, id))
    await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))
    return { ok: true }
  }

  // PUT — edit fields and/or move (columnId + beforeId/afterId neighbors).
  const body = await readBody<{
    title?: string
    description?: string
    tags?: string[]
    columnId?: string
    beforeId?: string | null
    afterId?: string | null
  }>(event)

  const patch: { title?: string, description?: string, tags?: string[], columnId?: string, position?: number, updatedAt: number } = {
    updatedAt: Date.now()
  }
  if (body.title !== undefined) patch.title = body.title.trim() || 'Untitled'
  if (body.description !== undefined) patch.description = body.description
  if (body.tags !== undefined) patch.tags = [...new Set(body.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10)

  let targetColumnId = task.columnId
  if (body.columnId && body.columnId !== task.columnId) {
    await requireColumn(event, body.columnId)
    patch.columnId = body.columnId
    targetColumnId = body.columnId
  }

  if (body.beforeId !== undefined || body.afterId !== undefined || patch.columnId) {
    const siblings = (await columnTasksOrdered(targetColumnId))
      .filter(t => t.id !== id)
      .map(t => ({ id: t.id, position: t.position }))
    patch.position = await positionBetween(
      siblings,
      body.beforeId ?? null,
      body.afterId ?? null,
      async (ids) => {
        for (const [idx, tid] of ids.entries()) {
          await db.update(projectTasks).set({ position: idx * 1000 }).where(eq(projectTasks.id, tid))
        }
      }
    )
  }

  const [updated] = await db.update(projectTasks).set(patch).where(eq(projectTasks.id, id)).returning()
  await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))
  return updated
})
