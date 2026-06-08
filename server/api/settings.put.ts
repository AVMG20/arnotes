import { db } from '../db'
import { userSettings } from '../db/schema'

const VALID_PRIMARY = new Set(['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'])
const VALID_NEUTRAL = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone'])

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const body = await readBody<{ primaryColor: string; neutralColor: string }>(event)

  if (!VALID_PRIMARY.has(body.primaryColor) || !VALID_NEUTRAL.has(body.neutralColor)) {
    throw createError({ statusCode: 400, message: 'Invalid color value' })
  }

  const { primaryColor, neutralColor } = body

  await db
    .insert(userSettings)
    .values({ userId, primaryColor, neutralColor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { primaryColor, neutralColor, updatedAt: new Date() },
    })

  return { primaryColor, neutralColor }
})
