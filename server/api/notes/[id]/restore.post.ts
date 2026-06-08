import { db } from '../../../db'
import { notes } from '../../../db/schema'
import { eq, and } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id

  const [restored] = await db
    .update(notes)
    .set({ deletedAt: null })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning()

  if (!restored) throw createError({ statusCode: 404, message: 'Note not found' })
  return restored
})
