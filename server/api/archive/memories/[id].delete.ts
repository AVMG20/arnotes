import { archiveScope, forgetMemories } from '../../../utils/archiveStore'

// Forgetting from the card. Soft, like every deletion in the app.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const [row] = await forgetMemories(scope, [id])
  if (!row) throw createError({ statusCode: 404, message: 'Memory not found' })
  return row
})
