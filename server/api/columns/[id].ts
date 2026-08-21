import { db } from '../../db'
import { projects, projectColumns, projectTasks } from '../../db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { requireColumn, projectColumnsOrdered, positionBetween, renumberColumnTasks, uiDeletion } from '../../utils/projects'
import { publishFromEvent } from '../../utils/realtime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  // Widened for the delete below, which has to be able to find a column that is
  // already in the trash in order to remove it for good.
  const { column, project } = await requireColumn(event, id, { includeDeleted: true })

  if (event.method === 'PUT') {
    // A trashed column is read-only: restore it first, then rename or move it.
    if (column.deletedAt) throw createError({ statusCode: 404, message: 'Column not found' })

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

  // DELETE — the same two-stage shape a note has: the first one puts the column
  // in the board's trash, and deleting it again from there is what removes it.
  if (column.deletedAt) {
    // Permanent. Tasks and their updates cascade off the foreign key.
    await db.delete(projectColumns).where(eq(projectColumns.id, id))
    await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))

    await publishFromEvent(event, { type: 'board', projectId: project.id })
    return { ok: true, permanent: true, movedToColumnId: null }
  }

  const stamp = uiDeletion(event)

  // Tasks move to the left neighbour; the first column's tasks go to the next
  // column instead. Only live columns count as somewhere to put them.
  const siblings = await projectColumnsOrdered(column.projectId)
  const idx = siblings.findIndex(c => c.id === id)
  const target = siblings[idx > 0 ? idx - 1 : idx + 1]

  if (target) {
    // Where they came from is recorded so restoring the column can bring them
    // back rather than handing back an empty column.
    await db.update(projectTasks)
      .set({ columnId: target.id, previousColumnId: id })
      .where(and(eq(projectTasks.columnId, id), isNull(projectTasks.deletedAt)))
    // The moved tasks kept the old column's positions, which collide with the
    // ones already there; a renumber gives the merged column one clear order.
    await renumberColumnTasks(target.id)
  } else {
    // A lone column has no neighbour to hand its tasks to, so they go into the
    // trash with it — carrying the column's exact timestamp, which is how a
    // restore later tells this cohort from cards trashed on their own.
    await db.update(projectTasks)
      .set(stamp)
      .where(and(eq(projectTasks.columnId, id), isNull(projectTasks.deletedAt)))
  }

  await db.update(projectColumns).set(stamp).where(eq(projectColumns.id, id))
  await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))

  await publishFromEvent(event, { type: 'board', projectId: project.id })
  return { ok: true, permanent: false, movedToColumnId: target?.id ?? null }
})
