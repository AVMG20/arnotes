import { db } from '../../db'
import { projects, projectTasks } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireTask, requireColumn, columnTasksOrdered, positionBetween, uiDeletion } from '../../utils/projects'
import { publishFromEvent } from '../../utils/realtime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  // Widened for the delete below, which has to be able to find a card that is
  // already in the trash in order to remove it for good.
  const { task, project } = await requireTask(event, id, { includeDeleted: true })

  if (event.method === 'DELETE') {
    // Same two stages as a note: the first delete puts the card in the board's
    // trash, and deleting it again from there is what removes it.
    const permanent = task.deletedAt !== null

    if (permanent) {
      await db.delete(projectTasks).where(eq(projectTasks.id, id))
    } else {
      await db.update(projectTasks).set(uiDeletion(event)).where(eq(projectTasks.id, id))
    }

    await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))

    await publishFromEvent(event, { type: 'board', projectId: project.id })
    return { ok: true, permanent }
  }

  if (event.method !== 'PUT') {
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  // A trashed card is read-only: restore it before editing or moving it.
  if (task.deletedAt) throw createError({ statusCode: 404, message: 'Task not found' })

  // PUT — edit fields and/or move (columnId + beforeId/afterId neighbors).
  const body = await readBody<{
    title?: string
    description?: string
    tags?: string[]
    columnId?: string
    beforeId?: string | null
    afterId?: string | null
  }>(event)

  const patch: {
    title?: string
    description?: string
    tags?: string[]
    columnId?: string
    previousColumnId?: string | null
    position?: number
    updatedAt: number
  } = {
    updatedAt: Date.now()
  }
  if (body.title !== undefined) patch.title = body.title.trim() || 'Untitled'
  if (body.description !== undefined) patch.description = body.description
  if (body.tags !== undefined) patch.tags = [...new Set(body.tags.map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10)

  let targetColumnId = task.columnId
  if (body.columnId && body.columnId !== task.columnId) {
    // The column must belong to this task's board. Without the check a task
    // could be parked in another board's column while its projectId stayed
    // behind, leaving it invisible on one board and orphaned on the other.
    const { column } = await requireColumn(event, body.columnId)
    if (column.projectId !== task.projectId) {
      throw createError({ statusCode: 400, message: 'That column belongs to another project' })
    }
    patch.columnId = body.columnId
    // Filing a card somewhere deliberately overrides where it happened to come
    // from, so restoring its old column later leaves this one alone.
    patch.previousColumnId = null
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

  await publishFromEvent(event, { type: 'board', projectId: project.id })
  return updated
})
