import { db } from '../../db'
import { notes } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import type { NewNote } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id
  const body = await readBody<Partial<NewNote>>(event)

  let updatedAttachments: string[] | undefined
  if (body.content !== undefined) {
    const [current] = await db
      .select({ attachments: notes.attachments })
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))

    if (current?.attachments) {
      const kept = current.attachments.filter(f => body.content!.includes(f))
      const removed = current.attachments.filter(f => !body.content!.includes(f))
      for (const f of removed) {
        try { unlinkSync(join(process.cwd(), 'data', 'attachments', id, f)) } catch {}
      }
      updatedAttachments = kept
    }
  }

  const [updated] = await db
    .update(notes)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(updatedAttachments !== undefined && { attachments: updatedAttachments }),
      ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      updatedAt: Date.now(),
    })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning()

  if (!updated) throw createError({ statusCode: 404, message: 'Note not found' })
  return updated
})
