import { getDb } from '../../utils/db'
import type { Note } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<Partial<Note>>(event)
  const db = await getDb()

  const idx = db.data.notes.findIndex(n => n.id === id)
  if (idx < 0) throw createError({ statusCode: 404, message: 'Note not found' })

  const existing = db.data.notes[idx]!
  db.data.notes[idx] = {
    id: existing.id,
    title: body.title ?? existing.title,
    content: body.content ?? existing.content,
    tags: body.tags ?? existing.tags,
    attachments: body.attachments ?? existing.attachments ?? [],
    createdAt: existing.createdAt,
    updatedAt: Date.now()
  }
  await db.write()
  return db.data.notes[idx]
})
