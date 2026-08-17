import { reactive, ref, watch } from 'vue'
import type { TaskProp, Note } from '~/composables/useNotes'
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
  targetKind?: 'task' | 'note'
  pending?: boolean
  error?: boolean
}

const SESSION_KEY = 'arnai-chat-v1'
const MAX_TOOL_ROUNDS = 6

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
        messages: _messages.value.map(m => ({ ...m, pending: false })),
        thinking: _thinking.value
      }))
    } catch {
      // Storage full — chat keeps working, just not persisted.
    }
  }, { deep: true })
}

// ─── Tool execution (client owns the notes store) ────────────

function endOfDay(dateStr: string): number | null {
  if (!dateStr) return null
  const ts = new Date(`${dateStr}T23:59:59.999`).getTime()
  return Number.isNaN(ts) ? null : ts
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function toTaskProps(props: unknown): TaskProp[] {
  if (!Array.isArray(props)) return []
  return props
    .filter((p): p is { name: string, type?: string, value?: string } => !!p && typeof p === 'object' && 'name' in p)
    .map(p => ({
      id: uid(),
      name: String(p.name),
      type: (['text', 'link', 'note'].includes(String(p.type)) ? String(p.type) : 'text') as TaskProp['type'],
      value: String(p.value ?? '')
    }))
}

// Stored HTML content is "<h1>title</h1><p>#tag</p>…body", so the body is
// everything after the heading and the tag paragraphs.
function descriptionOf(note: Note): string {
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
    kind: n.isTask ? 'task' : 'note',
    title: n.title,
    status: n.taskStatus,
    dueAt: n.dueAt,
    tags: n.tags,
    updatedAt: new Date(n.updatedAt).toISOString(),
    taskProps: n.taskProps
  }
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown, label: string }> {
  const { getNote, searchNotes, createTask, createNote, updateNote, updateTaskMeta, deleteNote } = useNotes()

  const notFound = { result: { error: 'Item not found' }, label: 'Item not found' }

  switch (name) {
    case 'search_items': {
      const query = String(args.query ?? '')
      const kind = (['task', 'note', 'both'].includes(String(args.kind)) ? args.kind : 'both') as 'task' | 'note' | 'both'
      let pool = searchNotes(query, toStringArray(args.tags))
      if (kind !== 'both') pool = pool.filter(n => n.isTask === (kind === 'task'))
      const results = pool.slice(0, 25).map(noteToResult)
      return { result: { count: results.length, results }, label: `Searched "${query || 'all'}"` }
    }
    case 'get_item': {
      const n = getNote(String(args.id ?? ''))
      if (!n || n.deletedAt) return notFound
      return {
        result: { ...noteToResult(n), description: descriptionOf(n) },
        label: `Read "${n.title}"`
      }
    }
    case 'create_task': {
      const task = await createTask({
        title: String(args.title ?? 'Untitled'),
        description: String(args.description ?? ''),
        tags: toStringArray(args.tags),
        dueAt: endOfDay(String(args.due_date ?? '')),
        taskProps: toTaskProps(args.custom_properties)
      })
      return { result: noteToResult(task), label: `Created task "${task.title}"` }
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
    case 'update_item': {
      const id = String(args.id ?? '')
      const n = getNote(id)
      if (!n || n.deletedAt) return notFound

      const willBeTask = args.is_task === undefined ? n.isTask : args.is_task === true
      const meta: Parameters<typeof updateTaskMeta>[1] = {}
      if (args.is_task !== undefined && willBeTask !== n.isTask) meta.isTask = willBeTask
      if (willBeTask) {
        if (args.status === 'open' || args.status === 'done') meta.taskStatus = args.status
        if (args.due_date !== undefined) meta.dueAt = endOfDay(String(args.due_date ?? ''))
        if (args.custom_properties !== undefined) meta.taskProps = toTaskProps(args.custom_properties)
      }
      if (Object.keys(meta).length > 0) await updateTaskMeta(id, meta)

      if (args.title !== undefined || args.description !== undefined || args.tags !== undefined) {
        const title = args.title !== undefined ? String(args.title) : n.title
        const tags = args.tags !== undefined ? toStringArray(args.tags) : n.tags
        const description = args.description !== undefined ? String(args.description) : descriptionOf(n)
        await updateNote(id, buildContent(title, tags, description))
      }

      const updated = getNote(id)
      if (!updated) return { result: { error: 'Update failed' }, label: `Could not update "${n.title}"` }
      return {
        result: { ...noteToResult(updated), description: descriptionOf(updated) },
        label: meta.isTask === true
          ? `Converted "${updated.title}" to task`
          : meta.isTask === false
            ? `Converted "${updated.title}" to note`
            : `Updated "${updated.title}"`
      }
    }
    case 'delete_item': {
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

  async function streamRound(assistant: ChatMessage, signal: AbortSignal): Promise<ToolCallRequest[] | null> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The model needs the user's local date to resolve "today", "this week"
      // and relative due dates — the server clock may be in another timezone.
      body: JSON.stringify({
        messages: toWireMessages(_messages.value),
        thinking: _thinking.value,
        today: new Date().toLocaleDateString('en-CA')
      }),
      signal
    })

    if (!res.ok || !res.body) {
      const err = JSON.parse(await res.text().catch(() => '{}')) as { statusMessage?: string, message?: string }
      throw new Error(err.statusMessage ?? err.message ?? `Chat failed (${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let toolCalls: ToolCallRequest[] | null = null
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let evt: {
          type: 'delta' | 'reasoning' | 'tool_calls' | 'done' | 'error'
          text?: string
          calls?: ToolCallRequest[]
          message?: string
        }
        try {
          evt = JSON.parse(line)
        } catch {
          continue
        }
        if (evt.type === 'delta' && evt.text) assistant.content += evt.text
        else if (evt.type === 'reasoning' && evt.text) assistant.reasoning = (assistant.reasoning ?? '') + evt.text
        else if (evt.type === 'tool_calls' && evt.calls) toolCalls = evt.calls
        else if (evt.type === 'error') throw new Error(evt.message ?? 'Model error')
        else if (evt.type === 'done') return toolCalls
      }
    }
    return toolCalls
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
        const target = result as { id?: string, kind?: 'task' | 'note', error?: string }
        if (target?.id && !target.error && (target.kind === 'task' || target.kind === 'note')) {
          toolMsg.targetId = target.id
          toolMsg.targetKind = target.kind
        }
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
          if ((error as Error).name === 'AbortError') {
            if (!assistant.content && !assistant.reasoning) {
              _messages.value = _messages.value.filter(m => m.id !== assistant.id)
            }
            return
          }
          assistant.content = assistant.content || `⚠️ ${(error as Error).message}`
          assistant.error = true
          return
        }

        assistant.toolCalls = toolCalls ?? undefined
        assistant.pending = false
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
