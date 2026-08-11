import { auth } from '../lib/auth'

export default defineEventHandler(async (event) => {
  const path = event.path
  const guarded = ['/api/notes', '/api/settings', '/api/ai', '/api/teams', '/api/embeddings']
  if (!guarded.some(prefix => path.startsWith(prefix))) return

  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' })

  event.context.session = session
})
