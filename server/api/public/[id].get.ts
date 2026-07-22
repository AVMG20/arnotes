import { db } from '../../db'
import { notes } from '../../db/schema'
import { and, eq, gt, isNull, or } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const [note] = await db
    .select()
    .from(notes)
    .where(and(
      eq(notes.id, id),
      eq(notes.isPublic, true),
      or(isNull(notes.publicUntil), gt(notes.publicUntil, Date.now()))
    ))
  if (!note) throw createError({ statusCode: 404, message: 'Note not found' })
  return note
})
