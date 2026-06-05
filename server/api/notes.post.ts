import { getDb } from '../utils/db'
import type { Note } from '../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<Omit<Note, 'id' | 'createdAt' | 'updatedAt'>>(event)
  const db = await getDb()

  const note: Note = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: body.title ?? 'Untitled',
    content: body.content ?? '',
    tags: body.tags ?? [],
    attachments: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  db.data.notes.unshift(note)
  await db.write()
  return note
})
