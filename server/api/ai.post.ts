import { db } from '../db'
import { aiUsageRecords, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  let model: string | undefined
  let action: AiAction | undefined

  try {
    const userId = event.context.session.user.id
    const body = await readBody<{ action: string, text?: string, context?: string, instruction?: string }>(event)

    const requestedAction = body.action as AiAction
    action = requestedAction
    if (!requestedAction) throw createError({ statusCode: 400, statusMessage: 'Missing action' })

    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
    const apiKey = settings?.openrouterApiKey
    if (!apiKey) throw createError({ statusCode: 400, statusMessage: 'OpenRouter API key not configured. Add it in Settings -> AI.' })

    const selectedModel = settings?.openrouterModel || DEFAULT_OPENROUTER_MODEL
    model = selectedModel
    const text = (body.text ?? '').trim()
    const context = (body.context ?? '').trim()
    const instruction = (body.instruction ?? '').trim()

    if (requestedAction === 'custom' && !instruction) throw createError({ statusCode: 400, statusMessage: 'Enter an instruction for the AI.' })
    if (instruction.length > 4000) throw createError({ statusCode: 400, statusMessage: 'AI instruction is too long.' })
    if (!text && !context && !instruction) throw createError({ statusCode: 400, statusMessage: 'Nothing selected to process.' })

    const prompt = buildPrompt(requestedAction, text, context, instruction)

    const stream = await streamOpenRouter(apiKey, selectedModel, prompt, async (usage) => {
      try {
        await db.insert(aiUsageRecords).values({
          id: crypto.randomUUID(),
          userId,
          action: requestedAction,
          model: selectedModel,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cost: usage.cost.toFixed(8)
        })
      } catch (error) {
        // Usage tracking must not turn a completed AI response into a client error.
        console.error('[AI] Failed to save usage record', { userId, action: requestedAction, model: selectedModel, usage, error })
      }
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      }
    })
  } catch (error) {
    const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500
    const message = error instanceof Error ? error.message : 'The AI request failed unexpectedly.'
    console.error('[AI] Request failed before streaming', { action, model, statusCode, error })
    throw createError({ statusCode, statusMessage: message })
  }
})
