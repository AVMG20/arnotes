import { db } from '../../db'
import { projects, projectColumns, projectTasks } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireColumn, projectColumnsOrdered, positionBetween, renumberColumnTasks } from '../../utils/projects'
import { publishFromEvent } from '../../utils/realtime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { column, project } = await requireColumn(event, id)

  if (event.method === 'PUT') {
    const body = await readBody<{ name?: string, beforeId?: string | null, afterId?: string | null }>(event)

    const patch: { name?: string, position?: number } = {}
    if (typeof body.name === 'string') patch.name = body.name.trim() || column.name
    if (body.beforeId !== undefined || body.afterId !== undefined) {
      const siblings = (await projectColumnsOrdered(column.projectId))
        .filter(c => c.id !== id)
        .map(c => ({ id: c.id, position: c.position }))
      patch.position = await positionBetween(
        siblings,
        body.beforeId ?? null,
        body.afterId ?? null,
        async (ids) => {
          for (const [idx, cid] of ids.entries()) {
            await db.update(projectColumns).set({ position: idx * 1000 }).where(eq(projectColumns.id, cid))
          }
        }
      )
    }

    if (Object.keys(patch).length === 0) return column

    const [updated] = await db.update(projectColumns).set(patch).where(eq(projectColumns.id, id)).returning()
    await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))

    await publishFromEvent(event, { type: 'board', projectId: project.id })
    return updated
  }

  if (event.method !== 'DELETE') {
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  // DELETE — tasks move to the left neighbor; the first column's tasks go to
  // the next column instead. A lone column takes its tasks with it.
  const siblings = await projectColumnsOrdered(column.projectId)
  const idx = siblings.findIndex(c => c.id === id)
  const target = siblings[idx > 0 ? idx - 1 : idx + 1]

  if (target) {
    await db.update(projectTasks).set({ columnId: target.id }).where(eq(projectTasks.columnId, id))
    // The moved tasks kept the old column's positions, which collide with the
    // ones already there; a renumber gives the merged column one clear order.
    await renumberColumnTasks(target.id)
  }

  await db.delete(projectColumns).where(eq(projectColumns.id, id))
  await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))

  await publishFromEvent(event, { type: 'board', projectId: project.id })
  return { ok: true, movedToColumnId: target?.id ?? null }
})
