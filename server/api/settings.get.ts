import { db } from '../db'
import { userSettings, AI_SETTINGS_DEFAULTS } from '../db/schema'
import { eq } from 'drizzle-orm'

function maskKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 8) return '••••'
  return key.slice(0, 4) + '••••' + key.slice(-4)
}

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))

  if (!settings) {
    return {
      primaryColor: 'emerald',
      neutralColor: 'zinc',
      openrouterApiKey: null,
      openrouterApiKeyMasked: null,
      openrouterModel: AI_SETTINGS_DEFAULTS.openrouterModel
    }
  }

  return {
    primaryColor: settings.primaryColor,
    neutralColor: settings.neutralColor,
    openrouterApiKey: settings.openrouterApiKey,
    openrouterApiKeyMasked: maskKey(settings.openrouterApiKey),
    openrouterModel: settings.openrouterModel
  }
})
