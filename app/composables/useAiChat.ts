import { reactive, ref, watch } from 'vue'
import type { Note } from '~/composables/useNotes'
import { markdownToHtml, htmlToMarkdown } from '~/utils/markdown'
import { toWireMessages } from '~/utils/chatHistory'

// ─── Types ───────────────────────────────────────────────────

export interface ToolCallRequest {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  // assistant streaming extras
  reasoning?: string
  toolCalls?: ToolCallRequest[]
  // tool message extras
  toolCallId?: string
  name?: string
  label?: string
  targetId?: string
  pending?: boolean
  error?: boolean
  /** Tool arguments the model is still writing (assistant turns). */
  toolProgress?: Array<{ id: string, name: string, chars: number }>
  /** A dropped stream is being replayed. */
  retrying?: boolean
}

const SESSION_KEY = 'arnai-chat-v1'
const MAX_TOOL_ROUNDS = 6
/** Attempts per round when the connection drops before the model finished. */
const MAX_STREAM_ATTEMPTS = 3
/** The server pings every 10s, so a longer silence means the pipe is dead. */
const STREAM_STALL_MS = 45_000

// The response stream ended without the server's terminator: a proxy, the
// network or the tab's connection cut it. Nothing was executed yet, so the
// round can be replayed safely.
class StreamDropped extends Error {
  constructor(message = 'Connection lost') {
    super(message)
    this.name = 'StreamDropped'
  }
}

type ChatEvent
  = | { type: 'delta' | 'reasoning', text?: string }
    | { type: 'tool_progress', calls?: Array<{ id: string, name: string, chars: number }> }
    | { type: 'tool_calls', calls?: ToolCallRequest[] }
    | { type: 'ping' | 'done' }
    | { type: 'error', message?: string }

function isRetryableStreamError(error: unknown): boolean {
  // Chrome surfaces a killed HTTP/2 or QUIC stream as `TypeError: network error`
  // / `Failed to fetch`, both from fetch() itself and from reader.read().
  return error instanceof StreamDropped || error instanceof TypeError
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

// ─── Singleton state ─────────────────────────────────────────

const _messages = ref<ChatMessage[]>([])
const _thinking = ref(false)
const _busy = ref(false)
const _initialized = ref(false)

let _abort: AbortController | null = null

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function loadSession() {
  if (!import.meta.client || _initialized.value) return
  _initialized.value = true
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { messages?: ChatMessage[], thinking?: boolean }
    // Anything still in flight when the page unloaded is dead on arrival.
    _messages.value = (saved.messages ?? []).filter(m => !m.pending)
    _thinking.value = saved.thinking ?? false
  } catch {
    // Corrupt session — start fresh.
  }
}

if (import.meta.client) {
  watch([_messages, _thinking], () => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        messages: _messages.value.map(m => ({ ...m, pending: false, retrying: false, toolProgress: undefined })),
        thinking: _thinking.value
      }))
    } catch {
      // Storage full — chat keeps working, just not persisted.
    }
  }, { deep: true })
}

// ─── Tool execution (client owns the notes store) ────────────

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

// Stored HTML content is "<h1>title</h1><p>#tag</p>…body", so the body is
// everything after the heading and the tag paragraphs.
function bodyOf(note: Note): string {
  const lines = htmlToMarkdown(note.content).split('\n')
  const body = lines
    .slice(lines[0]?.startsWith('# ') ? 1 : 0)
    .filter(line => !/^#[a-zA-Z][a-zA-Z0-9_]*$/.test(line.trim()))
  return body.join('\n').trim()
}

function buildContent(title: string, tags: string[], bodyMd: string): string {
  let html = `<h1>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>`
  for (const tag of tags) html += `<p>#${tag}</p>`
  if (bodyMd.trim()) html += markdownToHtml(bodyMd)
  return html
}

function noteToResult(n: Note) {
  return {
    id: n.id,
    title: n.title,
    tags: n.tags,
    updatedAt: new Date(n.updatedAt).toISOString()
  }
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown, label: string }> {
  const { getNote, searchNotes, createNote, updateNote, deleteNote } = useNotes()

  const notFound = { result: { error: 'Note not found' }, label: 'Note not found' }

  switch (name) {
    case 'search_notes': {
      const query = String(args.query ?? '')
      const pool = searchNotes(query, toStringArray(args.tags))
      const results = pool.slice(0, 25).map(noteToResult)
      return { result: { count: results.length, results }, label: `Searched "${query || 'all'}"` }
    }
    case 'get_note': {
      const n = getNote(String(args.id ?? ''))
      if (!n || n.deletedAt) return notFound
      return {
        result: { ...noteToResult(n), content: bodyOf(n) },
        label: `Read "${n.title}"`
      }
    }
    case 'create_note': {
      // `select: false` — a background creation must not move the user's cursor
      // to a different note while they are working.
      const note = await createNote({
        title: String(args.title ?? 'Untitled'),
        content: String(args.content ?? ''),
        tags: toStringArray(args.tags),
        select: false
      })
      return { result: noteToResult(note), label: `Created note "${note.title}"` }
    }
    case 'update_note': {
      const id = String(args.id ?? '')
      const n = getNote(id)
      if (!n || n.deletedAt) return notFound

      if (args.title !== undefined || args.content !== undefined || args.tags !== undefined) {
        const title = args.title !== undefined ? String(args.title) : n.title
        const tags = args.tags !== undefined ? toStringArray(args.tags) : n.tags
        const content = args.content !== undefined ? String(args.content) : bodyOf(n)
        await updateNote(id, buildContent(title, tags, content))
      }

      const updated = getNote(id)
      if (!updated) return { result: { error: 'Update failed' }, label: `Could not update "${n.title}"` }
      return {
        result: { ...noteToResult(updated), content: bodyOf(updated) },
        label: `Updated "${updated.title}"`
      }
    }
    case 'delete_note': {
      const id = String(args.id ?? '')
      const n = getNote(id)
      if (!n || n.deletedAt) return notFound
      await deleteNote(id) // soft delete — restorable from trash
      return { result: { ok: true, id, deleted: true }, label: `Moved "${n.title}" to trash` }
    }
    default:
      return { result: { error: `Unknown tool: ${name}` }, label: `Unknown tool ${name}` }
  }
}

// ─── Composable ──────────────────────────────────────────────

export function useAiChat() {
  loadSession()

  async function send(text: string) {
    const input = text.trim()
    if (!input || _busy.value) return
    _messages.value.push({ id: uid(), role: 'user', content: input })
    await runCompletion()
  }

  // Re-runs the last user turn after a failure, dropping the failed reply.
  async function retry() {
    if (_busy.value) return
    const lastUser = [..._messages.value].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    const index = _messages.value.indexOf(lastUser)
    _messages.value = _messages.value.slice(0, index + 1)
    await runCompletion()
  }

  // One attempt at one round. Throws StreamDropped when the stream ends
  // without the server's `done`/`tool_calls` terminator.
  async function streamOnce(assistant: ChatMessage, signal: AbortSignal): Promise<ToolCallRequest[] | null> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The model needs the user's local date to resolve "today" and "this
      // week" — the server clock may be in another timezone.
      body: JSON.stringify({
        messages: toWireMessages(_messages.value),
        thinking: _thinking.value,
        today: new Date().toLocaleDateString('en-CA')
      }),
      signal
    })

    if (!res.ok || !res.body) {
      const err = JSON.parse(await res.text().catch(() => '{}')) as { statusMessage?: string, message?: string }
      const message = err.statusMessage ?? err.message ?? `Chat failed (${res.status})`
      // Gateway-level failures are transient; 4xx (missing API key, bad
      // request) are not and must reach the user unchanged.
      if ([502, 503, 504].includes(res.status)) throw new StreamDropped(message)
      throw new Error(message)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let toolCalls: ToolCallRequest[] | null = null
    let buffer = ''

    // The server sends a ping every 10s even while the model writes a long
    // tool argument, so a longer silence means the connection is gone — fail
    // fast instead of waiting for a TCP timeout that may never come.
    const readChunk = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new StreamDropped('No response from the server')), STREAM_STALL_MS)
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

        for (const line of lines) {
          if (!line.trim()) continue
          let evt: ChatEvent
          try {
            evt = JSON.parse(line) as ChatEvent
          } catch {
            continue
          }
          if (evt.type === 'delta' && evt.text) assistant.content += evt.text
          else if (evt.type === 'reasoning' && evt.text) assistant.reasoning = (assistant.reasoning ?? '') + evt.text
          else if (evt.type === 'tool_progress') assistant.toolProgress = evt.calls ?? []
          else if (evt.type === 'tool_calls' && evt.calls) toolCalls = evt.calls
          else if (evt.type === 'error') throw new Error(evt.message ?? 'Model error')
          else if (evt.type === 'done') return toolCalls
          // 'ping' is keepalive only.
        }
      }
    } finally {
      reader.cancel().catch(() => {})
    }

    // Terminator lost but the tool calls did arrive: the model finished, so
    // honour them rather than replaying the whole round.
    if (toolCalls) return toolCalls
    throw new StreamDropped()
  }

  async function streamRound(assistant: ChatMessage, signal: AbortSignal): Promise<ToolCallRequest[] | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        const calls = await streamOnce(assistant, signal)
        assistant.retrying = false
        assistant.toolProgress = undefined
        return calls
      } catch (error) {
        if (signal.aborted || (error as Error).name === 'AbortError') throw error
        if (!isRetryableStreamError(error) || attempt >= MAX_STREAM_ATTEMPTS) throw error

        // No tool has run yet this round and the history the server sees is
        // unchanged, so replaying is side-effect free. Clear the partial reply
        // so the retry does not append to half a sentence.
        console.warn('[Arnai] Stream dropped, retrying round', { attempt, error })
        assistant.content = ''
        assistant.reasoning = ''
        assistant.toolProgress = undefined
        assistant.retrying = true
        await delay(500 * attempt, signal)
        if (signal.aborted) throw error
      }
    }
  }

  async function runTools(calls: ToolCallRequest[]) {
    for (const call of calls) {
      const toolMsg = reactive<ChatMessage>({
        id: uid(),
        role: 'tool',
        content: '',
        toolCallId: call.id,
        name: call.function.name,
        pending: true
      })
      _messages.value.push(toolMsg)

      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
      } catch {
        // Malformed arguments — run with none and let the model see the error.
      }
      try {
        const { result, label } = await executeTool(call.function.name, args)
        toolMsg.content = JSON.stringify(result)
        toolMsg.label = label
        const target = result as { id?: string, error?: string }
        if (target?.id && !target.error) toolMsg.targetId = target.id
      } catch (error) {
        toolMsg.content = JSON.stringify({ error: (error as Error).message })
        toolMsg.label = `${call.function.name} failed`
        toolMsg.error = true
      }
      toolMsg.pending = false
    }
  }

  async function runCompletion() {
    _busy.value = true
    _abort = new AbortController()
    const signal = _abort.signal

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const assistant = reactive<ChatMessage>({
          id: uid(),
          role: 'assistant',
          content: '',
          reasoning: '',
          pending: true
        })
        _messages.value.push(assistant)

        let toolCalls: ToolCallRequest[] | null = null
        try {
          toolCalls = await streamRound(assistant, signal)
        } catch (error) {
          assistant.pending = false
          assistant.retrying = false
          assistant.toolProgress = undefined
          if ((error as Error).name === 'AbortError') {
            if (!assistant.content && !assistant.reasoning) {
              _messages.value = _messages.value.filter(m => m.id !== assistant.id)
            }
            return
          }
          const message = isRetryableStreamError(error)
            ? 'Connection to the server was lost. Press retry to continue.'
            : (error as Error).message
          assistant.content = assistant.content || `⚠️ ${message}`
          assistant.error = true
          return
        }

        assistant.toolCalls = toolCalls ?? undefined
        assistant.pending = false
        assistant.retrying = false
        if (!toolCalls) return

        await runTools(toolCalls)
        if (signal.aborted) return
        // Next round sends the tool results back to the model.
      }

      _messages.value.push({
        id: uid(),
        role: 'assistant',
        content: `⚠️ Stopped after ${MAX_TOOL_ROUNDS} tool rounds. Ask me to continue if there is more to do.`,
        error: true
      })
    } finally {
      _busy.value = false
      _abort = null
      // Drop assistant turns that produced nothing at all (aborted mid-stream).
      _messages.value = _messages.value.filter(m => m.role !== 'assistant' || m.content.trim() || m.toolCalls)
    }
  }

  function stop() {
    _abort?.abort()
  }

  function clearChat() {
    _abort?.abort()
    _messages.value = []
    if (import.meta.client) sessionStorage.removeItem(SESSION_KEY)
  }

  return {
    messages: _messages,
    thinking: _thinking,
    busy: _busy,
    send,
    retry,
    stop,
    clearChat
  }
}
