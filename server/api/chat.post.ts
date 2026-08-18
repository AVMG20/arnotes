import { db } from '../db'
import { aiUsageRecords, userSettings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { CHAT_TOOLS, CHAT_SYSTEM_PROMPT } from '../utils/chatTools'
import { trimHistory, toProviderMessages } from '../utils/chatHistory'
import type { WireMessage, WireToolCall } from '../utils/chatHistory'
import { DEFAULT_OPENROUTER_MODEL } from '../utils/ai'

// Chat endpoint for the Arnai assistant. Streams NDJSON events to the client:
//   { type: 'delta', text }              — assistant text chunk
//   { type: 'reasoning', text }          — thinking token chunk (when enabled)
//   { type: 'tool_progress', calls }     — tool arguments still being written
//   { type: 'ping' }                     — keepalive, no payload
//   { type: 'tool_calls', calls }        — model wants tools executed
//   { type: 'done' }                     — stream complete
//   { type: 'error', message }           — failure
// Tool execution happens on the client, which owns the notes store.

/**
 * A tool call whose arguments are a whole note body takes a long time to
 * generate, and the model emits no assistant text while it does. An idle
 * response stream is closed by proxies in front of the app (the browser then
 * reports ERR_QUIC_PROTOCOL_ERROR / ERR_HTTP2_PROTOCOL_ERROR with nothing in
 * the server log), so a byte goes out at least this often.
 */
const HEARTBEAT_MS = 10_000

/** Give up if OpenRouter itself sends nothing at all for this long. */
const UPSTREAM_STALL_MS = 180_000

interface RequestBody {
  messages: WireMessage[]
  thinking?: boolean
  /** The client's local date (YYYY-MM-DD) so relative dates resolve correctly. */
  today?: string
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

  const history = Array.isArray(body.messages) ? trimHistory(body.messages) : []
  if (history.length === 0) throw createError({ statusCode: 400, statusMessage: 'Missing messages' })

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const apiKey = settings?.openrouterApiKey
  if (!apiKey) throw createError({ statusCode: 400, statusMessage: 'OpenRouter API key not configured. Add it in Settings -> AI.' })
  const model = settings?.openrouterModel || DEFAULT_OPENROUTER_MODEL
  const thinking = body.thinking === true

  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10)

  const buildMessages = () => [
    { role: 'system', content: `${CHAT_SYSTEM_PROMPT}\n\nToday is ${today}.` },
    ...toProviderMessages(history)
  ]

  // Aborting this stops the (billed) generation as soon as the client hangs up.
  const upstream = new AbortController()

  const requestCompletion = (reasoning: { effort?: 'none' | 'medium', exclude?: boolean }) =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://arnotes.local',
        'X-Title': 'Arnotes',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(),
        tools: CHAT_TOOLS,
        reasoning,
        stream: true,
        stream_options: { include_usage: true }
      }),
      signal: upstream.signal
    })

  let res: Response
  try {
    if (thinking) {
      res = await requestCompletion({ effort: 'medium' })
    } else {
      // `none` disables configurable reasoning. Mandatory-thinking models
      // reject it — retry once with reasoning merely hidden (same policy
      // as /api/ai so those models stay usable here too).
      res = await requestCompletion({ effort: 'none', exclude: true })
      if (!res.ok && [400, 422, 500].includes(res.status)) {
        console.warn('[AI Chat] Retrying without disabled reasoning', { model, status: res.status })
        res = await requestCompletion({ exclude: true })
      }
    }
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

  const upstreamBody = res.body
  let clientGone = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastByteAt = Date.now()

      const send = (obj: unknown) => {
        if (clientGone) return
        try {
          controller.enqueue(emit(obj))
          lastByteAt = Date.now()
        } catch {
          clientGone = true
        }
      }

      const heartbeat = setInterval(() => {
        if (!clientGone && Date.now() - lastByteAt >= HEARTBEAT_MS) send({ type: 'ping' })
      }, Math.floor(HEARTBEAT_MS / 2))

      const reader = upstreamBody.getReader()

      // Races the read against a stall timer: a hung upstream must surface as
      // an error event, not as a stream that never ends.
      const readChunk = async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('OpenRouter stopped sending data')), UPSTREAM_STALL_MS)
            })
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      }

      let buffer = ''
      let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
      let sawToolCalls = false
      let failed = false
      let lastProgressAt = 0

      // Tool-call arguments arrive fragmented across deltas; reassemble by index.
      const pendingCalls = new Map<number, WireToolCall>()

      try {
        for (;;) {
          const { done, value } = await readChunk()
          if (done) break
          if (clientGone) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const raw of lines) {
            const line = raw.trim()
            if (!line) continue
            // SSE comments (": OPENROUTER PROCESSING") carry no payload but do
            // prove the model is alive — forward them so the stream stays warm.
            if (line.startsWith(':')) {
              send({ type: 'ping' })
              continue
            }
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (!data || data === '[DONE]') continue

            let parsed: OpenRouterChunk
            try {
              parsed = JSON.parse(data) as OpenRouterChunk
            } catch {
              continue
            }
            if (parsed.error) {
              failed = true
              send({ type: 'error', message: parsed.error.message ?? 'OpenRouter error' })
              break
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
            if (delta.reasoning) send({ type: 'reasoning', text: delta.reasoning })
            if (delta.content) send({ type: 'delta', text: delta.content })
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
              // Progress keeps the connection busy while a long note body is
              // written, and lets the client show what is being prepared.
              // Throttled: arguments arrive token by token.
              if (Date.now() - lastProgressAt >= 500) {
                lastProgressAt = Date.now()
                send({
                  type: 'tool_progress',
                  calls: [...pendingCalls.values()].map(c => ({
                    id: c.id,
                    name: c.function.name,
                    chars: c.function.arguments.length
                  }))
                })
              }
            }
          }
          if (failed) break
        }

        if (!failed) {
          if (pendingCalls.size > 0) {
            sawToolCalls = true
            send({ type: 'tool_calls', calls: [...pendingCalls.values()] })
          }
          send({ type: 'done' })
        }
      } catch (error) {
        // A client that hung up aborts the upstream read; that is not a fault.
        if (!clientGone) {
          console.error('[AI Chat] Stream failed', { model, error })
          send({ type: 'error', message: error instanceof Error ? error.message : 'The model stream failed' })
        }
      } finally {
        clearInterval(heartbeat)
        await reader.cancel().catch(() => {})
        upstream.abort()

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

        if (!clientGone) {
          try {
            controller.close()
          } catch {
            // Already closed by the runtime.
          }
        }
      }
    },
    cancel() {
      // Browser navigated away or the user pressed stop.
      clientGone = true
      upstream.abort()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
})
