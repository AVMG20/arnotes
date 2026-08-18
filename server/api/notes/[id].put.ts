import { db } from '../../db'
import { notes } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { unlinkSync } from 'fs'
import type { NewNote } from '../../db/schema'
import { getNoteAccessFilter } from '../../utils/auth-helpers'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<Partial<NewNote>>(event)

  const accessCondition = and(eq(notes.id, id), await getNoteAccessFilter(event))

  let updatedAttachments: string[] | undefined
  if (body.content !== undefined) {
    const [current] = await db
      .select({ attachments: notes.attachments })
      .from(notes)
      .where(accessCondition)

    if (current?.attachments) {
      const kept = current.attachments.filter(f => body.content!.includes(f))
      const removed = current.attachments.filter(f => !body.content!.includes(f))
      for (const f of removed) {
        try {
          unlinkSync(join(process.cwd(), 'data', 'attachments', id, f))
        } catch {
          // A missing attachment is already in the desired state.
        }
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
      ...(body.publicUntil !== undefined && { publicUntil: body.publicUntil }),
      updatedAt: Date.now()
    })
    .where(accessCondition)
    .returning()

  if (!updated) throw createError({ statusCode: 404, message: 'Note not found' })
  return updated
})
