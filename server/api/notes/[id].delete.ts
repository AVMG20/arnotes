import { getDb } from '../../utils/db'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const db = await getDb()

  const before = db.data.notes.length
  db.data.notes = db.data.notes.filter(n => n.id !== id)
  if (db.data.notes.length === before) throw createError({ statusCode: 404, message: 'Note not found' })

  await db.write()

  const attachDir = join(process.cwd(), 'data', 'attachments', id!)
  if (existsSync(attachDir)) rmSync(attachDir, { recursive: true })

  return { ok: true }
})
