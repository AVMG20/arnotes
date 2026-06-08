import { db } from '../db'
import { userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))

  if (!settings) {
    return { primaryColor: 'emerald', neutralColor: 'zinc' }
  }

  return { primaryColor: settings.primaryColor, neutralColor: settings.neutralColor }
})
