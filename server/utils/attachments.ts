import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import type { MultiPartData } from 'h3'

// Image uploads for notes and tasks share one rulebook: the same formats, the
// same size cap, the same per-owner limit. Only where the files live differs.
export const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])

const EXT_FROM_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10 MB
export const MAX_ATTACHMENTS = 15

export const SAFE_ID = /^[a-z0-9]+$/i
export const SAFE_FILENAME = /^[a-z0-9]+\.[a-z0-9]+$/i

export const ATTACHMENT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}

/** Notes keep their files directly under data/attachments/<noteId>. */
export function noteAttachmentDir(noteId: string) {
  return join(process.cwd(), 'data', 'attachments', noteId)
}

/** Task files sit in their own tree so a task id can never shadow a note id. */
export function taskAttachmentDir(taskId: string) {
  return join(process.cwd(), 'data', 'task-attachments', taskId)
}

export function countAttachments(dir: string) {
  return existsSync(dir) ? readdirSync(dir).length : 0
}

/**
 * Validates one multipart image and writes it to `dir` under a random name.
 * The extension comes from the validated MIME type, never from the client's
 * filename. Returns the stored filename.
 */
export function storeImageUpload(dir: string, filePart: MultiPartData | undefined) {
  if (!filePart?.data) throw createError({ statusCode: 400, message: 'No file provided' })

  const type = filePart.type ?? 'application/octet-stream'
  if (!ALLOWED_IMAGE_TYPES.has(type)) throw createError({ statusCode: 400, message: 'Unsupported file type' })
  if (filePart.data.length > MAX_ATTACHMENT_SIZE) throw createError({ statusCode: 400, message: 'File too large (max 10 MB)' })

  const ext = EXT_FROM_MIME[type]!
  const filename = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}.${ext}`

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, filename), filePart.data)
  return filename
}

/** Drops every file a task uploaded. Called wherever the row is removed for good. */
export function removeTaskAttachments(taskIds: string[]) {
  for (const id of taskIds) {
    const dir = taskAttachmentDir(id)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
}
