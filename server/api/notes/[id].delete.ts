import { db } from '../../db'
import { notes } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id

  const [existing] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))

  if (!existing) throw createError({ statusCode: 404, message: 'Note not found' })

  if (existing.deletedAt) {
    // Already in trash — permanently delete
    await db.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, userId)))
    const attachDir = join(process.cwd(), 'data', 'attachments', id)
    if (existsSync(attachDir)) rmSync(attachDir, { recursive: true })
    return { ok: true, permanent: true }
  }

  // Soft delete
  const [softDeleted] = await db
    .update(notes)
    .set({ deletedAt: Date.now() })
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning()

  return { ok: true, permanent: false, note: softDeleted }
})
