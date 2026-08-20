import { db } from '../../db'
import { projects } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireProject } from '../../utils/projects'

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
    return updated
  }

  // DELETE — hard delete, columns/tasks/comments cascade.
  await db.delete(projects).where(eq(projects.id, id))
  return { ok: true }
})
