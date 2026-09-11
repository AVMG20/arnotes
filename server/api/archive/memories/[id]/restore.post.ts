import { archiveScope, restoreMemory } from '../../../../utils/archiveStore'

// Un-forgets a memory. The assistant can only forget; bringing something back
// is the user's call, from the Forgotten list in the sidebar.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const row = await restoreMemory(scope, id)
  if (!row) throw createError({ statusCode: 404, message: 'Memory not found' })
  return row
})
