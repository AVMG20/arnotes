import { db } from '../../db'
import { projects } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireProject } from '../../utils/projects'
import { publishFromEvent } from '../../utils/realtime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const project = await requireProject(event, id)

  if (event.method === 'PUT') {
    const body = await readBody<{ name?: string }>(event)
    const name = body.name?.trim()
    const [updated] = await db.update(projects)
      .set({ name: name || project.name, updatedAt: Date.now() })
      .where(eq(projects.id, id))
      .returning()

    await publishFromEvent(event, { type: 'projects' })
    return updated
  }

  // Anything but PUT or DELETE would otherwise fall through to the delete
  // below, which a link prefetch or a stray GET must never reach.
  if (event.method !== 'DELETE') {
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  // DELETE — hard delete, columns/tasks/comments cascade.
  await db.delete(projects).where(eq(projects.id, id))

  await publishFromEvent(event, { type: 'projects' })
  return { ok: true }
})
