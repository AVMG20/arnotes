import { auth } from '../lib/auth'

export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/notes') && !path.startsWith('/api/attachments')) return

  const session = await auth.api.getSession({ headers: event.headers })
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' })

  event.context.session = session
})
