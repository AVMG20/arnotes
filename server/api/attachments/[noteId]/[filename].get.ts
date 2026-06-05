import { join, extname } from 'path'
import { existsSync, readFileSync } from 'fs'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

export default defineEventHandler(async (event) => {
  const noteId = getRouterParam(event, 'noteId')
  const filename = getRouterParam(event, 'filename')

  // Prevent path traversal
  if (!noteId || !filename || filename.includes('/') || filename.includes('..')) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  const filePath = join(process.cwd(), 'data', 'attachments', noteId, filename)
  if (!existsSync(filePath)) throw createError({ statusCode: 404, message: 'Not found' })

  const mime = MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream'
  setHeader(event, 'Content-Type', mime)
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')

  return readFileSync(filePath)
})
