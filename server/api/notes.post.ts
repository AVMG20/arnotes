import { db } from '../db'
import { notes } from '../db/schema'
import type { NewNote } from '../db/schema'

export default defineEventHandler(async (event) => {
  const body = await readBody<Pick<NewNote, 'title' | 'content' | 'tags'>>(event)
  const userId = event.context.session.user.id
  const now = Date.now()

  const [note] = await db.insert(notes).values({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    userId,
    title: body.title ?? 'Untitled',
    content: body.content ?? '',
    tags: body.tags ?? [],
    attachments: [],
    createdAt: now,
    updatedAt: now
  }).returning()

  return note
})
