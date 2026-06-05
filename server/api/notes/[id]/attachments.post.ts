import { db } from '../../../db'
import { notes } from '../../../db/schema'
import { eq, and } from 'drizzle-orm'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export default defineEventHandler(async (event) => {
  const noteId = getRouterParam(event, 'id')!
  const userId = event.context.session.user.id

  const [note] = await db.select().from(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
  if (!note) throw createError({ statusCode: 404, message: 'Note not found' })

  const form = await readMultipartFormData(event)
  const filePart = form?.find(p => p.name === 'file')
  if (!filePart?.data) throw createError({ statusCode: 400, message: 'No file provided' })

  const type = filePart.type ?? 'application/octet-stream'
  if (!ALLOWED_TYPES.has(type)) throw createError({ statusCode: 400, message: 'Unsupported file type' })
  if (filePart.data.length > MAX_SIZE) throw createError({ statusCode: 400, message: 'File too large (max 10 MB)' })

  const ext = (filePart.filename ?? 'image').split('.').pop() ?? 'bin'
  const filename = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}.${ext}`

  const dir = join(process.cwd(), 'data', 'attachments', noteId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, filename), filePart.data)

  const updatedAttachments = [...(note.attachments ?? []), filename]
  await db.update(notes).set({ attachments: updatedAttachments }).where(eq(notes.id, noteId))

  return { url: `/api/attachments/${noteId}/${filename}` }
})
