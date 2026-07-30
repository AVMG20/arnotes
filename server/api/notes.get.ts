import { db } from '../db'
import { notes } from '../db/schema'
import { desc } from 'drizzle-orm'
import { getNoteAccessFilter } from '../utils/auth-helpers'

export default defineEventHandler(async (event) => {
  const accessFilter = await getNoteAccessFilter(event)
  return db.select().from(notes).where(accessFilter).orderBy(desc(notes.updatedAt))
})
