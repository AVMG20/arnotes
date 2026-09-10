import { db } from '../../../db'
import { notes } from '../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { getNoteAccessFilter } from '../../../utils/auth-helpers'
import { MAX_ATTACHMENTS, noteAttachmentDir, storeImageUpload } from '../../../utils/attachments'

export default defineEventHandler(async (event) => {
  const noteId = getRouterParam(event, 'id')!

  const [note] = await db.select().from(notes).where(and(eq(notes.id, noteId), await getNoteAccessFilter(event)))
  if (!note) throw createError({ statusCode: 404, message: 'Note not found' })

  if ((note.attachments ?? []).length >= MAX_ATTACHMENTS) {
    throw createError({ statusCode: 400, message: `Attachment limit reached (max ${MAX_ATTACHMENTS})` })
  }

  const form = await readMultipartFormData(event)
  const filename = storeImageUpload(noteAttachmentDir(noteId), form?.find(p => p.name === 'file'))

  const updatedAttachments = [...(note.attachments ?? []), filename]
  await db.update(notes).set({ attachments: updatedAttachments }).where(eq(notes.id, noteId))

  return { url: `/api/attachments/${noteId}/${filename}` }
})
