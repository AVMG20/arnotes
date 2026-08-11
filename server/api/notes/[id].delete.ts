import { db } from '../../db'
import { notes } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { getNoteAccessFilter } from '../../utils/auth-helpers'
import { NOTE_COLUMNS } from '../../utils/note-columns'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!

  const accessCondition = and(eq(notes.id, id), await getNoteAccessFilter(event))

  const [existing] = await db
    .select(NOTE_COLUMNS)
    .from(notes)
    .where(accessCondition)

  if (!existing) throw createError({ statusCode: 404, message: 'Note not found' })

  if (existing.deletedAt) {
    // Already in trash — permanently delete
    await db.delete(notes).where(accessCondition)
    const attachDir = join(process.cwd(), 'data', 'attachments', id)
    if (existsSync(attachDir)) rmSync(attachDir, { recursive: true })
    return { ok: true, permanent: true }
  }

  // Soft delete
  const [softDeleted] = await db
    .update(notes)
    .set({ deletedAt: Date.now() })
    .where(accessCondition)
    .returning(NOTE_COLUMNS)

  return { ok: true, permanent: false, note: softDeleted }
})
