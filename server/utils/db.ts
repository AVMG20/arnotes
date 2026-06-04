import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

type DB = { notes: Note[] }

let _db: Low<DB> | null = null

export async function getDb(): Promise<Low<DB>> {
  if (_db) return _db

  const cwd = process.cwd()
  const root = cwd.endsWith('/.output') ? cwd.slice(0, -8) : cwd
  const dataDir = join(root, 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

  const adapter = new JSONFile<DB>(join(dataDir, 'notes.json'))
  _db = new Low<DB>(adapter, { notes: [] })
  await _db.read()
  return _db
}
