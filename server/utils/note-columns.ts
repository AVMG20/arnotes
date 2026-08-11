import { notes } from '../db/schema'

/**
 * Every note column the client actually renders.
 *
 * Embedding columns are excluded on purpose — a vector adds several kilobytes per
 * note and is only needed by semantic search, which fetches it separately from
 * `/api/embeddings`. Use this instead of a bare `select()` or `returning()` when
 * a note is going over the wire.
 */
export const NOTE_COLUMNS = {
  id: notes.id,
  userId: notes.userId,
  teamId: notes.teamId,
  title: notes.title,
  content: notes.content,
  tags: notes.tags,
  attachments: notes.attachments,
  isPublic: notes.isPublic,
  publicUntil: notes.publicUntil,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
  deletedAt: notes.deletedAt
} as const
