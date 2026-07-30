import { db } from '../../../db'
import { notes } from '../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { getNoteAccessFilter } from '../../../utils/auth-helpers'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const [restored] = await db
    .update(notes)
    .set({ deletedAt: null })
    .where(and(eq(notes.id, id), await getNoteAccessFilter(event)))
    .returning()

  if (!restored) throw createError({ statusCode: 404, message: 'Note not found' })
  return restored
})
