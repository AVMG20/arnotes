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
  '.svg': 'image/svg+xml'
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
    .select({ userId: notes.userId, isPublic: notes.isPublic, publicUntil: notes.publicUntil })
    .from(notes)
    .where(eq(notes.id, noteId))

  if (!note) throw createError({ statusCode: 404, message: 'Not found' })

  const isPublic = note.isPublic && (!note.publicUntil || note.publicUntil > Date.now())
  if (!isPublic) {
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session || session.user.id !== note.userId) {
      throw createError({ statusCode: 403, message: 'Forbidden' })
    }
  }

  const filePath = join(process.cwd(), 'data', 'attachments', noteId, filename)
  if (!existsSync(filePath)) throw createError({ statusCode: 404, message: 'Not found' })

  const mime = MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream'
  setHeader(event, 'Content-Type', mime)
  const maxAge = note.publicUntil
    ? Math.max(0, Math.floor((note.publicUntil - Date.now()) / 1000))
    : 31_536_000
  setHeader(event, 'Cache-Control', isPublic ? `public, max-age=${maxAge}` : 'private, no-store')

  return readFileSync(filePath)
})
