import { db } from '../db'
import { notes } from '../db/schema'
import type { NewNote } from '../db/schema'
import { getUserActiveTeamId } from '../utils/auth-helpers'

export default defineEventHandler(async (event) => {
  const body = await readBody<Pick<NewNote, 'title' | 'content' | 'tags'>>(event)
  const userId = event.context.session.user.id
  const activeTeamId = await getUserActiveTeamId(event)
  const now = Date.now()

  const [note] = await db.insert(notes).values({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    userId,
    teamId: activeTeamId,
    title: body.title ?? 'Untitled',
    content: body.content ?? '',
    tags: body.tags ?? [],
    attachments: [],
    createdAt: now,
    updatedAt: now
  }).returning()

  return note
})
