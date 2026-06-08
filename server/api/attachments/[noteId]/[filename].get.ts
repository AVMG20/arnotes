import { join, extname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { db } from '#server/db'
import { notes } from '#server/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '#server/lib/auth'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

const SAFE_SEGMENT = /^[a-z0-9]+$/i
const SAFE_FILENAME = /^[a-z0-9]+\.[a-z0-9]+$/i

export default defineEventHandler(async (event) => {
  const noteId = getRouterParam(event, 'noteId')
  const filename = getRouterParam(event, 'filename')

  if (!noteId || !filename || !SAFE_SEGMENT.test(noteId) || !SAFE_FILENAME.test(filename)) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  const [note] = await db
    .select({ userId: notes.userId, isPublic: notes.isPublic })
    .from(notes)
    .where(eq(notes.id, noteId))

  if (!note) throw createError({ statusCode: 404, message: 'Not found' })

  if (!note.isPublic) {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session || session.user.id !== note.userId) {
      throw createError({ statusCode: 403, message: 'Forbidden' })
    }
  }

  const filePath = join(process.cwd(), 'data', 'attachments', noteId, filename)
  if (!existsSync(filePath)) throw createError({ statusCode: 404, message: 'Not found' })

  const mime = MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream'
  setHeader(event, 'Content-Type', mime)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')

  return readFileSync(filePath)
})
