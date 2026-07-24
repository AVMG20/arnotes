import { db } from '../db'
import { aiUsageRecords, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const body = await readBody<{ action: string, text?: string, context?: string, instruction?: string }>(event)

  const action = body.action as AiAction
  if (!action) throw createError({ statusCode: 400, message: 'Missing action' })

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const apiKey = settings?.openrouterApiKey
  if (!apiKey) throw createError({ statusCode: 400, message: 'OpenRouter API key not configured. Add it in Settings → AI.' })

  const model = settings?.openrouterModel || DEFAULT_OPENROUTER_MODEL
  const text = (body.text ?? '').trim()
  const context = (body.context ?? '').trim()
  const instruction = (body.instruction ?? '').trim()

  if (action === 'custom' && !instruction) throw createError({ statusCode: 400, message: 'Enter an instruction for the AI.' })
  if (instruction.length > 4000) throw createError({ statusCode: 400, message: 'AI instruction is too long.' })
  if (!text && !context && !instruction) throw createError({ statusCode: 400, message: 'Nothing selected to process.' })

  const prompt = buildPrompt(action, text, context, instruction)

  const stream = await streamOpenRouter(apiKey, model, prompt, async (usage) => {
    try {
      await db.insert(aiUsageRecords).values({
        id: crypto.randomUUID(),
        userId,
        action,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cost: usage.cost.toFixed(8)
      })
    } catch (error) {
      // Usage tracking must not turn a completed AI response into a client error.
      console.error('[AI] Failed to save usage record', { userId, action, model, usage, error })
    }
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
})
