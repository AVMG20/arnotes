import { db } from '../db'
import { userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const body = await readBody<{ action: string, text?: string, context?: string }>(event)

  const action = body.action as AiAction
  if (!action) throw createError({ statusCode: 400, message: 'Missing action' })

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const apiKey = settings?.openrouterApiKey
  if (!apiKey) throw createError({ statusCode: 400, message: 'OpenRouter API key not configured. Add it in Settings → AI.' })

  const model = settings?.openrouterModel || DEFAULT_OPENROUTER_MODEL
  const text = (body.text ?? '').trim()
  const context = (body.context ?? '').trim()

  if (!text && !context) throw createError({ statusCode: 400, message: 'Nothing selected to process.' })

  const prompt = buildPrompt(action, text, context)

  const result = await callOpenRouter(apiKey, model, prompt)
  return { result, model }
})
