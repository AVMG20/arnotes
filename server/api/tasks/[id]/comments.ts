import { db } from '../../../db'
import { taskComments, user } from '../../../db/schema'
import { eq, asc } from 'drizzle-orm'
import { requireTask, genId } from '../../../utils/projects'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { task: _task } = await requireTask(event, id)

  if (event.method === 'GET') {
    return db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        userId: taskComments.userId,
        body: taskComments.body,
        createdAt: taskComments.createdAt,
        userName: user.name
      })
      .from(taskComments)
      .leftJoin(user, eq(user.id, taskComments.userId))
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt))
  }

  const payload = await readBody<{ body?: string }>(event)
  const body = payload.body?.trim()
  if (!body) throw createError({ statusCode: 400, message: 'Comment body is required' })

  const [comment] = await db.insert(taskComments).values({
    id: genId(),
    taskId: id,
    userId: event.context.session.user.id,
    body,
    createdAt: Date.now()
  }).returning()

  return { ...comment, userName: event.context.session.user.name }
})
