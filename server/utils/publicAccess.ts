// Everything a shared link is allowed to reach, in one place. A public note or
// board is readable without a session, so the rule that decides "is this link
// live right now" is written once and used by the HTTP endpoints and by the
// WebSocket handler that lets those readers subscribe to updates.
import { db } from '../db'
import { notes, projects } from '../db/schema'
import { and, eq, gt, isNull, or } from 'drizzle-orm'

/** A share is live while it is switched on and its end date has not passed. */
function liveShare(column: typeof notes.publicUntil | typeof projects.publicUntil) {
  return or(isNull(column), gt(column, Date.now()))
}

export async function findPublicNote(id: string) {
  const [note] = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      tags: notes.tags,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt
    })
    .from(notes)
    .where(and(
      eq(notes.id, id),
      eq(notes.isPublic, true),
      isNull(notes.deletedAt),
      liveShare(notes.publicUntil)
    ))
  return note ?? null
}

export async function findPublicProject(id: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt
    })
    .from(projects)
    .where(and(
      eq(projects.id, id),
      eq(projects.isPublic, true),
      liveShare(projects.publicUntil)
    ))
  return project ?? null
}
