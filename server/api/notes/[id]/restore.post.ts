import { db } from '../../../db'
import { notes } from '../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { getNoteAccessFilter } from '../../../utils/auth-helpers'
import { NOTE_COLUMNS } from '../../../utils/note-columns'
import { queueNoteEmbedding } from '../../../utils/embedding-queue'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const [restored] = await db
    .update(notes)
    .set({ deletedAt: null })
    .where(and(eq(notes.id, id), await getNoteAccessFilter(event)))
    .returning(NOTE_COLUMNS)

  if (!restored) throw createError({ statusCode: 404, message: 'Note not found' })

  // A note trashed before it was ever embedded is skipped by the backfill scan,
  // so restoring is the moment to make sure it has a vector.
  queueNoteEmbedding(restored.id)

  return restored
})
