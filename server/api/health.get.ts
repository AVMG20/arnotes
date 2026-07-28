import { sql } from 'drizzle-orm'
import { db } from '../db'

export default defineEventHandler(async () => {
  await db.execute(sql`select 1`)
  return { status: 'ok', version: '0.1.0' }
})
