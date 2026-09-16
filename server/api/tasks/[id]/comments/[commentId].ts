import { db } from '../../../../db'
import { taskComments } from '../../../../db/schema'
import { and, eq } from 'drizzle-orm'
import { requireTask } from '../../../../utils/projects'
import { publishFromEvent } from '../../../../utils/realtime'

// Editing and removing an update. Only the account an update belongs to can do
// either — which includes what an agent once posted with that account's key,
// since that is the owner's to clean up. A teammate's update is theirs.
export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'id')!
  const commentId = getRouterParam(event, 'commentId')!
  const { task } = await requireTask(event, taskId)

  const [comment] = await db
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, taskId)))

  if (!comment) throw createError({ statusCode: 404, message: 'Update not found' })
  if (comment.userId !== event.context.session.user.id) {
    throw createError({ statusCode: 403, message: 'Only the author can change this update' })
  }

  if (event.method === 'DELETE') {
    await db.delete(taskComments).where(eq(taskComments.id, commentId))
    await publishFromEvent(event, { type: 'board', projectId: task.projectId })
    return { ok: true }
  }

  if (event.method !== 'PUT') {
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  const payload = await readBody<{ body?: string }>(event)
  const body = payload.body?.trim()
  if (!body) throw createError({ statusCode: 400, message: 'Update body is required' })
  if (body === comment.body) return { id: comment.id, body: comment.body, editedAt: comment.editedAt }

  const [updated] = await db
    .update(taskComments)
    .set({ body, editedAt: Date.now() })
    .where(eq(taskComments.id, commentId))
    .returning()

  await publishFromEvent(event, { type: 'board', projectId: task.projectId })
  return { id: updated!.id, body: updated!.body, editedAt: updated!.editedAt }
})
