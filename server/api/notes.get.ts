import { db } from '../db'
import { notes } from '../db/schema'
import { eq, desc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  return db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.updatedAt))
})
