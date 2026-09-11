import { archiveScope, getTodos, normalizeTags, updateTodo } from '../../../utils/archiveStore'

// Ticking a box, renaming a line, moving a date. One row, one UPDATE — which is
// the whole reason todos are their own table rather than markdown in a body.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' })

  const body = await readBody<{
    title?: string
    done?: boolean
    dueAt?: number | null
    tags?: string[]
    updatedAt?: number
  }>(event)

  const [current] = await getTodos(scope, [id])
  if (!current || current.deletedAt) throw createError({ statusCode: 404, message: 'Todo not found' })

  if (typeof body.updatedAt === 'number' && body.updatedAt !== current.updatedAt) {
    throw createError({
      statusCode: 409,
      message: 'This todo changed while you were editing it',
      data: { todo: current }
    })
  }

  const patch: { title?: string, done?: boolean, dueAt?: number | null, tags?: string[] } = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (typeof body.done === 'boolean') patch.done = body.done
  if (body.dueAt !== undefined) patch.dueAt = typeof body.dueAt === 'number' ? body.dueAt : null
  if (body.tags !== undefined) patch.tags = normalizeTags(body.tags)

  const row = await updateTodo(scope, id, patch)
  if (!row) throw createError({ statusCode: 404, message: 'Todo not found' })
  return row
})
