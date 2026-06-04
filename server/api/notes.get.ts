import { getDb } from '../utils/db'

export default defineEventHandler(async () => {
  const db = await getDb()
  return db.data.notes
})
