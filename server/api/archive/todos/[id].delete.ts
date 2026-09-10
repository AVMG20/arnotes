import { archiveScope, dropTodos } from '../../../utils/archiveStore'

export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const [row] = await dropTodos(scope, [id])
  if (!row) throw createError({ statusCode: 404, message: 'Todo not found' })
  return row
})
