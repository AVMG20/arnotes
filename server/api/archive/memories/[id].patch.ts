import { archiveScope, getMemories, normalizeTags, updateMemory } from '../../../utils/archiveStore'

// A memory card edited in place. No model call: the user correcting a wrong line
// should not cost a turn, and the assistant sees the correction next turn anyway
// because it reads storage fresh every time.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const body = await readBody<{ title?: string, body?: string, tags?: string[], updatedAt?: number }>(event)

  const [current] = await getMemories(scope, [id])
  if (!current || current.deletedAt) throw createError({ statusCode: 404, message: 'Memory not found' })

  // The assistant may have rewritten this row while the user was typing into
  // the card. Rather than silently overwriting its work, hand back what is
  // stored now and let the card say so.
  if (typeof body.updatedAt === 'number' && body.updatedAt !== current.updatedAt) {
    throw createError({
      statusCode: 409,
      message: 'This memory changed while you were editing it',
      data: { memory: current }
    })
  }

  const patch: { title?: string, body?: string, tags?: string[] } = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (typeof body.body === 'string') patch.body = body.body
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags)

  const row = await updateMemory(scope, id, patch)
  if (!row) throw createError({ statusCode: 404, message: 'Memory not found' })
  return row
})
