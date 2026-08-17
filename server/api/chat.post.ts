import { db } from '../db'
import { aiUsageRecords, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { CHAT_TOOLS, CHAT_SYSTEM_PROMPT } from '../utils/chatTools'
import { DEFAULT_OPENROUTER_MODEL } from '../utils/ai'

// Chat endpoint for the Arnai assistant. Streams NDJSON events to the client:
//   { type: 'delta', text }              — assistant text chunk
//   { type: 'reasoning', text }          — thinking token chunk (when enabled)
//   { type: 'tool_calls', calls }        — model wants tools executed
//   { type: 'done' }                     — stream complete
//   { type: 'error', message }           — failure
// Tool execution happens on the client, which owns the notes store.

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

interface RequestBody {
  messages: ChatMessage[]
  thinking?: boolean
}

interface OpenRouterDelta {
  content?: string | null
  reasoning?: string | null
  tool_calls?: Array<{
    index?: number
    id?: string
    type?: string
    function?: { name?: string, arguments?: string }
  }>
}

interface OpenRouterChunk {
  choices?: Array<{ delta?: OpenRouterDelta, finish_reason?: string | null }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    cost?: number
  }
  error?: { message?: string }
}

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const body = await readBody<RequestBody>(event)

  const history = Array.isArray(body.messages) ? body.messages.slice(-40) : []
  if (history.length === 0) throw createError({ statusCode: 400, statusMessage: 'Missing messages' })

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const apiKey = settings?.openrouterApiKey
  if (!apiKey) throw createError({ statusCode: 400, statusMessage: 'OpenRouter API key not configured. Add it in Settings -> AI.' })
  const model = settings?.openrouterModel || DEFAULT_OPENROUTER_MODEL
  const thinking = body.thinking === true

  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://arnotes.local',
        'X-Title': 'Arnotes',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          ...history.map(m => ({
            role: m.role,
            content: m.content ?? '',
            ...(m.tool_calls && { tool_calls: m.tool_calls }),
            ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
            ...(m.name && { name: m.name })
          }))
        ],
        tools: CHAT_TOOLS,
        reasoning: thinking ? { effort: 'medium' } : { effort: 'none', exclude: true },
        stream: true,
        stream_options: { include_usage: true }
      })
    })
  } catch (error) {
    console.error('[AI Chat] Unable to reach OpenRouter', { model, error })
    throw createError({ statusCode: 502, statusMessage: 'Could not reach OpenRouter. Check the server connection and try again.' })
  }

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => null) as { error?: { message?: string } } | null
    const message = errBody?.error?.message ?? `OpenRouter request failed (${res.status})`
    console.error('[AI Chat] OpenRouter request failed', { model, status: res.status, error: errBody })
    throw createError({ statusCode: 502, statusMessage: message })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const emit = (obj: unknown) => encoder.encode(JSON.stringify(obj) + '\n')

  let buffer = ''
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
  let sawToolCalls = false

  // Tool-call arguments arrive fragmented across deltas; reassemble by index.
  const pendingCalls = new Map<number, ToolCall>()

  const stream = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') continue

        let parsed: OpenRouterChunk
        try {
          parsed = JSON.parse(data) as OpenRouterChunk
        } catch {
          continue
        }
        if (parsed.error) {
          controller.enqueue(emit({ type: 'error', message: parsed.error.message ?? 'OpenRouter error' }))
          return
        }
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
            cost: parsed.usage.cost ?? 0
          }
        }
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue
        if (delta.reasoning) controller.enqueue(emit({ type: 'reasoning', text: delta.reasoning }))
        if (delta.content) controller.enqueue(emit({ type: 'delta', text: delta.content }))
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const existing = pendingCalls.get(idx)
            pendingCalls.set(idx, {
              id: tc.id ?? existing?.id ?? `call_${idx}_${Date.now()}`,
              type: 'function',
              function: {
                name: tc.function?.name ?? existing?.function.name ?? '',
                arguments: (existing?.function.arguments ?? '') + (tc.function?.arguments ?? '')
              }
            })
          }
        }
      }
    },
    async flush(controller) {
      if (pendingCalls.size > 0) {
        sawToolCalls = true
        controller.enqueue(emit({ type: 'tool_calls', calls: [...pendingCalls.values()] }))
      }
      controller.enqueue(emit({ type: 'done' }))
      try {
        await db.insert(aiUsageRecords).values({
          id: crypto.randomUUID(),
          userId,
          action: sawToolCalls ? 'chat-tools' : 'chat',
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cost: usage.cost.toFixed(8)
        })
      } catch (error) {
        console.error('[AI Chat] Failed to save usage record', { userId, model, error })
      }
    }
  }))

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
})
