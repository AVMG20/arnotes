import { archiveScope, forgetMemories, purgeMemory } from '../../../utils/archiveStore'

// Forgets a memory (soft). With ?permanent=1 the row is removed for good — only
// the sidebar's Forgotten list offers that, and only after a confirmation.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const permanent = getQuery(event).permanent === '1'
  if (permanent) {
    const row = await purgeMemory(scope, id)
    if (!row) throw createError({ statusCode: 404, message: 'Memory not found' })
    return row
  }

  const [row] = await forgetMemories(scope, [id])
  if (!row) throw createError({ statusCode: 404, message: 'Memory not found' })
  return row
})
