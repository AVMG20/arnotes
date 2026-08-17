import { auth } from '../lib/auth'

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/notes') && !path.startsWith('/api/settings') && !path.startsWith('/api/ai') && !path.startsWith('/api/chat') && !path.startsWith('/api/teams')) return

  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' })

  event.context.session = session
})
