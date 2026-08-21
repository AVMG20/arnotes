import { db } from '../../db'
import { projects } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireProject } from '../../utils/projects'
import { isAccentColor } from '#shared/utils/colors'
import { closeTopic, publicProjectTopic, publishFromEvent } from '../../utils/realtime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const project = await requireProject(event, id)

  if (event.method === 'PUT') {
    const body = await readBody<{
      name?: string
      isPublic?: boolean
      publicUntil?: number | null
      labelColor?: { label?: string, color?: string | null }
    }>(event)
    const name = body.name?.trim()

    // Label colours are patched one label at a time rather than sent as a whole
    // map: two people colouring different labels on the same board would
    // otherwise each write the map they loaded and undo the other's change.
    let labelColors: Record<string, string> | undefined
    if (body.labelColor) {
      const label = body.labelColor.label?.trim().toLowerCase()
      const color = body.labelColor.color
      if (!label) throw createError({ statusCode: 400, message: 'A label is required' })
      if (color !== null && !isAccentColor(color)) {
        throw createError({ statusCode: 400, message: 'Unknown colour' })
      }
      const { [label]: _cleared, ...rest } = project.labelColors ?? {}
      // null clears the entry rather than storing an empty colour, so the label
      // goes back to the one derived from its text.
      labelColors = color === null ? rest : { ...rest, [label]: color }
    }

    const [updated] = await db.update(projects)
      .set({
        name: name || project.name,
        ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
        ...(body.publicUntil !== undefined && { publicUntil: body.publicUntil }),
        ...(labelColors !== undefined && { labelColors }),
        updatedAt: Date.now()
      })
      .where(eq(projects.id, id))
      .returning()

    // Named so that anyone reading this board's public link hears about a
    // rename, or about the share being switched off under them.
    await publishFromEvent(event, { type: 'projects', projectId: id })
    if (body.isPublic === false) closeTopic(publicProjectTopic(id))
    return updated
  }

  // Anything but PUT or DELETE would otherwise fall through to the delete
  // below, which a link prefetch or a stray GET must never reach.
  if (event.method !== 'DELETE') {
    throw createError({ statusCode: 405, message: 'Method not allowed' })
  }

  // DELETE — hard delete, columns/tasks/comments cascade.
  await db.delete(projects).where(eq(projects.id, id))

  await publishFromEvent(event, { type: 'projects', projectId: id })
  closeTopic(publicProjectTopic(id))
  return { ok: true }
})
