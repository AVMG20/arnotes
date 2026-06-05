import { db } from '../../db'
import { notes } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import type { NewNote } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id
  const body = await readBody<Partial<NewNote>>(event)

  const [updated] = await db
    .update(notes)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.attachments !== undefined && { attachments: body.attachments }),
      ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      updatedAt: Date.now(),
    })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning()

  if (!updated) throw createError({ statusCode: 404, message: 'Note not found' })
  return updated
})
