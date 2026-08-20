import { and, eq } from 'drizzle-orm'
import { db } from '../../../db'
import { apiKeys } from '../../../db/schema'

/** Revokes a key by deleting it. Any agent still holding it stops working at once. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id

  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id })

  if (!deleted) throw createError({ statusCode: 404, message: 'API key not found' })
  return { ok: true }
})
