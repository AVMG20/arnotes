import { db } from '../db'
import { userSettings, AI_SETTINGS_DEFAULTS } from '../db/schema'
import { eq } from 'drizzle-orm'

const VALID_PRIMARY = new Set(['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'])
const VALID_NEUTRAL = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone'])

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const body = await readBody<{
    primaryColor: string
    neutralColor: string
    openrouterApiKey?: string | null
    openrouterModel?: string
  }>(event)

  if (!body.primaryColor || !body.neutralColor || !VALID_PRIMARY.has(body.primaryColor) || !VALID_NEUTRAL.has(body.neutralColor)) {
    throw createError({ statusCode: 400, message: 'Invalid color value' })
  }

  const primaryColor = body.primaryColor
  const neutralColor = body.neutralColor

  // Model: allow any non-empty string (free-form OpenRouter slug), but coerce to default
  const openrouterModel = (typeof body.openrouterModel === 'string' && body.openrouterModel.trim())
    ? body.openrouterModel.trim()
    : AI_SETTINGS_DEFAULTS.openrouterModel

  // API key: undefined = leave untouched; null / '' = clear; non-empty = set.
  const existing = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).then(r => r[0])
  let openrouterApiKey = existing?.openrouterApiKey ?? null
  if (body.openrouterApiKey !== undefined) {
    const trimmed = (typeof body.openrouterApiKey === 'string' ? body.openrouterApiKey.trim() : '')
    openrouterApiKey = trimmed ? trimmed : null
  }

  await db
    .insert(userSettings)
    .values({ userId, primaryColor, neutralColor, openrouterApiKey, openrouterModel, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { primaryColor, neutralColor, openrouterApiKey, openrouterModel, updatedAt: new Date() }
    })

  return { primaryColor, neutralColor, openrouterModel, openrouterApiKey }
})
