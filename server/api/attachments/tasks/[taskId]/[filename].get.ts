import { join, extname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { db } from '#server/db'
import { projects, projectTasks } from '#server/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '#server/lib/auth'
import { isTeamMember } from '#server/utils/auth-helpers'
import { ATTACHMENT_MIME, SAFE_FILENAME, SAFE_ID, taskAttachmentDir } from '#server/utils/attachments'

// Serves an image uploaded into a task description. Readable by whoever can
// read the board: its owner, the team it belongs to, or anyone while the board
// is shared publicly — the public board page renders the same descriptions.
export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'taskId')
  const filename = getRouterParam(event, 'filename')

  if (!taskId || !filename || !SAFE_ID.test(taskId) || !SAFE_FILENAME.test(filename)) {
    throw createError({ statusCode: 400, message: 'Invalid path' })
  }

  const [row] = await db
    .select({
      userId: projects.userId,
      teamId: projects.teamId,
      isPublic: projects.isPublic,
      publicUntil: projects.publicUntil
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(eq(projectTasks.id, taskId))

  if (!row) throw createError({ statusCode: 404, message: 'Not found' })

  const isPublic = row.isPublic && (!row.publicUntil || row.publicUntil > Date.now())
  if (!isPublic) {
    const session = await auth.api.getSession({ headers: event.headers })
    const allowed = session
      && (session.user.id === row.userId
        || (row.teamId ? await isTeamMember(session.user.id, row.teamId) : false))

    if (!allowed) throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const filePath = join(taskAttachmentDir(taskId), filename)
  if (!existsSync(filePath)) throw createError({ statusCode: 404, message: 'Not found' })

  setHeader(event, 'Content-Type', ATTACHMENT_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream')
  const maxAge = row.publicUntil
    ? Math.max(0, Math.floor((row.publicUntil - Date.now()) / 1000))
    : 31_536_000
  setHeader(event, 'Cache-Control', isPublic ? `public, max-age=${maxAge}` : 'private, no-store')

  return readFileSync(filePath)
})
