import { desc, eq } from 'drizzle-orm'
import { db } from '../../db'
import { aiUsageRecords, archiveMessages, userSettings, ARCHIVE_CONTEXT } from '../../db/schema'
import type { ArchiveAction, ArchiveMemory, ArchiveTodo } from '../../db/schema'
import { ARCHIVE_SYSTEM_PROMPT, ARCHIVE_TOOLS, executeArchiveTool } from '../../utils/archiveTools'
import {
  archiveScope,
  buildMemoryIndex,
  buildTodoDigest,
  listMemories,
  listOpenTodos,
  messageScopeFilter,
  newMessageId,
  type ArchiveScope
} from '../../utils/archiveStore'
import { stripCardBodies } from '#shared/utils/archiveCards'
import { DEFAULT_OPENROUTER_MODEL } from '../../utils/ai'

// Archive's turn. NDJSON to the client:
//   { type: 'delta', text }              — assistant text
//   { type: 'tool_start', name }         — a tool is about to run
//   { type: 'tool', name, label }        — a tool ran, and what it did
//   { type: 'rows', memories, todos }    — rows touched, so cards draw at once
//   { type: 'ping' }                     — keepalive
//   { type: 'saved', message }           — the persisted assistant turn
//   { type: 'done' } / { type: 'error' }
//
// Unlike /api/chat, the tools run here rather than in the browser: Archive's
// memory lives only in the database, so there is nothing on the client to
// consult and a round trip per tool call would be pure latency.

const HEARTBEAT_MS = 10_000
const UPSTREAM_STALL_MS = 180_000
/** Tool rounds per turn before the loop is cut off. */
const MAX_ROUNDS = 6

interface RequestBody {
  message?: string
  /** The client's local date, so "tomorrow" resolves in the user's timezone. */
  today?: string
}

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: WireToolCall[]
  tool_call_id?: string
}

interface OpenRouterChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{ index?: number, id?: string, function?: { name?: string, arguments?: string } }>
    }
  }>
  usage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number, cost?: number }
  error?: { message?: string }
}

class UpstreamError extends Error {}

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const body = await readBody<RequestBody>(event)

  const text = typeof body.message === 'string' ? body.message.trim() : ''
  if (!text) throw createError({ statusCode: 400, message: 'Missing message' })

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const apiKey = settings?.openrouterApiKey
  if (!apiKey) {
    throw createError({ statusCode: 400, message: 'OpenRouter API key not configured. Add it in Settings → AI.' })
  }
  const model = settings?.openrouterModel || DEFAULT_OPENROUTER_MODEL
  const contextMessages = Math.min(
    ARCHIVE_CONTEXT.max,
    Math.max(ARCHIVE_CONTEXT.min, settings?.archiveContextMessages ?? ARCHIVE_CONTEXT.default)
  )

  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10)

  const scope = await archiveScope(event)

  // The window the user chose, oldest first. These are plain user/assistant
  // turns — tool traffic is never replayed, so this can never be a history with
  // an orphaned tool result in it.
  const recent = (await db.select().from(archiveMessages)
    .where(messageScopeFilter(scope))
    .orderBy(desc(archiveMessages.createdAt))
    .limit(contextMessages)).reverse()

  const userRow = await persistMessage(scope, 'user', text, [])

  const [memories, openTodos] = await Promise.all([listMemories(scope), listOpenTodos(scope)])

  const baseMessages: ProviderMessage[] = [
    { role: 'system', content: `${ARCHIVE_SYSTEM_PROMPT}\n\nToday is ${today}.` },
    {
      role: 'system',
      content: `${buildMemoryIndex(memories)}\n\n${buildTodoDigest(openTodos, new Set(memories.map(m => m.id)))}`
    },
    ...recent.map(row => ({
      role: row.role,
      // Cards collapse to bare references: the stored row has very likely moved
      // on since, and re-sending bodies already listed in the index is what
      // makes a long conversation expensive.
      content: row.role === 'assistant' ? stripCardBodies(row.content) : row.content
    })),
    { role: 'user' as const, content: text }
  ]

  const upstream = new AbortController()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  let clientGone = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastByteAt = Date.now()

      const send = (obj: unknown) => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
          lastByteAt = Date.now()
        } catch {
          clientGone = true
        }
      }

      // A tool argument that is a whole memory body takes a while to generate
      // and emits no text meanwhile; an idle response gets cut by proxies.
      const heartbeat = setInterval(() => {
        if (!clientGone && Date.now() - lastByteAt >= HEARTBEAT_MS) send({ type: 'ping' })
      }, Math.floor(HEARTBEAT_MS / 2))

      const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
      const messages = [...baseMessages]
      const actions: ArchiveAction[] = []
      const chunks: string[] = []
      // Text of the round in flight, so a turn cut short still keeps what the
      // user has already read.
      const live = { text: '' }
      let usedTools = false

      try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
          live.text = ''
          const turn = await runRound({ apiKey, model, messages, signal: upstream.signal, decoder, send, usage, live })
          live.text = ''

          if (turn.text.trim()) chunks.push(turn.text.trim())
          if (!turn.toolCalls.length) break

          usedTools = true
          messages.push({ role: 'assistant', content: turn.text || null, tool_calls: turn.toolCalls })

          for (const call of turn.toolCalls) {
            send({ type: 'tool_start', name: call.function.name })
            const outcome = await runTool(scope, call)
            actions.push({ name: call.function.name, label: outcome.label })
            send({ type: 'tool', name: call.function.name, label: outcome.label })
            // Rows go out with the call that touched them, so the sidebar's
            // storage view moves while the assistant is still working.
            const touched: { memories?: ArchiveMemory[], todos?: ArchiveTodo[] } = {}
            if (outcome.memories?.length) touched.memories = outcome.memories
            if (outcome.todos?.length) touched.todos = outcome.todos
            if (touched.memories || touched.todos) send({ type: 'rows', ...touched })
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(outcome.result)
            })
          }

          if (round === MAX_ROUNDS - 1) {
            chunks.push('_Stopped after too many steps in one turn. Ask me to continue._')
          }
        }

        const content = chunks.join('\n\n')
        const saved = await persistMessage(scope, 'assistant', content, actions)
        send({ type: 'saved', message: saved, userMessage: userRow })
        send({ type: 'done' })
      } catch (error) {
        const message = error instanceof UpstreamError
          ? error.message
          : error instanceof Error ? error.message : 'The model stream failed'
        if (!clientGone) console.error('[Archive] Turn failed', { model, error })

        // Whatever was written before the failure is still worth keeping — also
        // when the user pressed Stop, so the transcript matches what they saw.
        if (live.text.trim()) chunks.push(live.text.trim())
        const partial = chunks.join('\n\n')
        if (partial.trim() || actions.length) {
          const saved = await persistMessage(scope, 'assistant', partial, actions).catch(() => null)
          if (saved) send({ type: 'saved', message: saved, userMessage: userRow })
        }
        send({ type: 'error', message })
      } finally {
        clearInterval(heartbeat)
        upstream.abort()

        try {
          await db.insert(aiUsageRecords).values({
            id: crypto.randomUUID(),
            userId,
            action: usedTools ? 'archive-tools' : 'archive',
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cost: usage.cost.toFixed(8)
          })
        } catch (error) {
          console.error('[Archive] Failed to save usage record', { userId, model, error })
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

async function persistMessage(
  scope: ArchiveScope,
  role: 'user' | 'assistant',
  content: string,
  actions: ArchiveAction[]
) {
  const [row] = await db.insert(archiveMessages).values({
    id: newMessageId(),
    userId: scope.userId,
    teamId: scope.teamId,
    role,
    content,
    actions,
    createdAt: Date.now()
  }).returning()
  return row!
}

async function runTool(scope: ArchiveScope, call: WireToolCall) {
  let args: Record<string, unknown> = {}
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
  } catch {
    // Truncated or malformed arguments: tell the model rather than throwing the
    // whole turn away, so it can try the call again.
    return { result: { error: 'Arguments were not valid JSON. Send them again.' }, label: 'Malformed tool call' }
  }

  try {
    return await executeArchiveTool(scope, call.function.name, args)
  } catch (error) {
    console.error('[Archive] Tool failed', { tool: call.function.name, error })
    return { result: { error: 'That operation failed.' }, label: `${call.function.name} failed` }
  }
}

/** One request/response with the model, streaming its text through as it lands. */
async function runRound(opts: {
  apiKey: string
  model: string
  messages: ProviderMessage[]
  signal: AbortSignal
  decoder: TextDecoder
  send: (obj: unknown) => void
  usage: { inputTokens: number, outputTokens: number, totalTokens: number, cost: number }
  /** Mirrors the text streamed so far, for the caller's error path. */
  live: { text: string }
}): Promise<{ text: string, toolCalls: WireToolCall[] }> {
  const { apiKey, model, messages, signal, decoder, send, usage, live } = opts

  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://arnotes.local',
        'X-Title': 'Arnotes Archive',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        tools: ARCHIVE_TOOLS,
        stream: true,
        stream_options: { include_usage: true }
      }),
      signal
    })
  } catch (error) {
    if (signal.aborted) throw new UpstreamError('Cancelled')
    console.error('[Archive] Unable to reach OpenRouter', { model, error })
    throw new UpstreamError('Could not reach OpenRouter. Check the server connection and try again.')
  }

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => null) as { error?: { message?: string } } | null
    console.error('[Archive] OpenRouter request failed', { model, status: res.status, error: errBody })
    throw new UpstreamError(errBody?.error?.message ?? `OpenRouter request failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const pending = new Map<number, WireToolCall>()
  let text = ''
  let buffer = ''

  // Races each read against a stall timer: a hung upstream has to surface as an
  // error rather than as a stream that never ends.
  const readChunk = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new UpstreamError('OpenRouter stopped sending data')), UPSTREAM_STALL_MS)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  try {
    for (;;) {
      const { done, value } = await readChunk()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        // SSE comments carry no payload but do prove the model is alive.
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
        if (parsed.error) throw new UpstreamError(parsed.error.message ?? 'OpenRouter error')
        if (parsed.usage) {
          usage.inputTokens += parsed.usage.prompt_tokens ?? 0
          usage.outputTokens += parsed.usage.completion_tokens ?? 0
          usage.totalTokens += parsed.usage.total_tokens ?? 0
          usage.cost += parsed.usage.cost ?? 0
        }

        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
          text += delta.content
          live.text = text
          send({ type: 'delta', text: delta.content })
        }
        // Tool arguments arrive fragmented across deltas; reassemble by index.
        for (const call of delta.tool_calls ?? []) {
          const idx = call.index ?? 0
          const existing = pending.get(idx)
          pending.set(idx, {
            id: call.id ?? existing?.id ?? `call_${idx}_${Date.now()}`,
            type: 'function',
            function: {
              name: call.function?.name ?? existing?.function.name ?? '',
              arguments: (existing?.function.arguments ?? '') + (call.function?.arguments ?? '')
            }
          })
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return { text, toolCalls: [...pending.values()].filter(call => call.function.name) }
}
