import { db } from '../../db'
import { notes } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id

  const [deleted] = await db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning()

  if (!deleted) throw createError({ statusCode: 404, message: 'Note not found' })

  const attachDir = join(process.cwd(), 'data', 'attachments', id)
  if (existsSync(attachDir)) rmSync(attachDir, { recursive: true })

  return { ok: true }
})
