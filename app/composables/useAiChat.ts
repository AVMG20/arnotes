import { ref, watch } from 'vue'
import type { TaskProp, Note } from '~/composables/useNotes'
import { markdownToHtml, htmlToMarkdown } from '~/utils/markdown'

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
    if (raw) {
      const saved = JSON.parse(raw) as { messages: ChatMessage[], thinking?: boolean }
      // Drop unfinished tool traffic from a previous page unload.
      _messages.value = (saved.messages ?? []).filter(m =>
        m.role !== 'tool' && !m.pending && !(m.role === 'assistant' && m.toolCalls && !m.content)
      )
      _thinking.value = saved.thinking ?? false
    }
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

function toTaskProps(props: Array<{ name?: string, type?: string, value?: string }> | undefined): TaskProp[] {
  if (!Array.isArray(props)) return []
  return props
    .filter(p => p?.name && p?.value !== undefined)
    .map(p => ({
      id: uid(),
      name: String(p.name),
      type: (['text', 'link', 'note'].includes(String(p.type)) ? String(p.type) : 'text') as TaskProp['type'],
      value: String(p.value ?? '')
    }))
}

// Splits stored HTML content into (title, tags, markdown body) so edits can
// rebuild it without duplicating the heading or tag paragraphs.
function splitContent(note: Note): { body: string } {
  const md = htmlToMarkdown(note.content)
  const lines = md.split('\n')
  let start = lines[0]?.startsWith('# ') ? 1 : 0
  const body: string[] = []
  for (; start < lines.length; start++) {
    const line = lines[start] ?? ''
    if (/^#[a-zA-Z][a-zA-Z0-9_]*$/.test(line.trim())) continue
    body.push(line)
  }
  return { body: body.join('\n').trim() }
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
  const { notes, searchNotes, createTask, createNote, updateNote, updateTaskMeta, deleteNote } = useNotes()

  switch (name) {
    case 'search_items': {
      const query = String(args.query ?? '')
      const kind = (['task', 'note', 'both'].includes(String(args.kind)) ? args.kind : 'both') as 'task' | 'note' | 'both'
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
      let pool = searchNotes(query, tags).filter(n => !n.deletedAt)
      if (kind !== 'both') pool = pool.filter(n => n.isTask === (kind === 'task'))
      const results = pool.slice(0, 25).map(noteToResult)
      return { result: { count: results.length, results }, label: `Searched "${query || 'all'}"` }
    }
    case 'get_item': {
      const n = notes.value.find(x => x.id === String(args.id ?? ''))
      if (!n || n.deletedAt) return { result: { error: 'Item not found' }, label: 'Item not found' }
      return {
        result: { ...noteToResult(n), description: splitContent(n).body },
        label: `Read "${n.title}"`
      }
    }
    case 'create_task': {
      const task = await createTask({
        title: String(args.title ?? 'Untitled'),
        description: String(args.description ?? ''),
        tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
        dueAt: endOfDay(String(args.due_date ?? '')),
        taskProps: toTaskProps(args.custom_properties as never)
      })
      return { result: noteToResult(task), label: `Created task "${task.title}"` }
    }
    case 'create_note': {
      const title = String(args.title ?? 'Untitled')
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : []
      const content = buildContent(title, tags, String(args.content ?? ''))
      const note = await createNote({ title })
      await updateNote(note.id, content)
      return { result: noteToResult({ ...note, content }), label: `Created note "${title}"` }
    }
    case 'update_item': {
      const id = String(args.id ?? '')
      const n = notes.value.find(x => x.id === id)
      if (!n || n.deletedAt) return { result: { error: 'Item not found' }, label: 'Item not found' }

      const meta: {
        taskStatus?: 'open' | 'done'
        dueAt?: number | null
        taskProps?: TaskProp[]
        isTask?: boolean
      } = {}
      if (n.isTask || args.is_task === true || args.is_task === false) {
        // Status/due/props only apply to tasks; is_task converts either way.
        if (args.status === 'open' || args.status === 'done') meta.taskStatus = args.status
        if (args.due_date !== undefined) meta.dueAt = endOfDay(String(args.due_date ?? ''))
        if (args.custom_properties !== undefined) meta.taskProps = toTaskProps(args.custom_properties as never)
        if (args.is_task !== undefined) meta.isTask = args.is_task === true
        if (Object.keys(meta).length > 0) await updateTaskMeta(id, meta)
      }

      if (args.title !== undefined || args.description !== undefined || args.tags !== undefined) {
        const { body } = splitContent(n)
        const title = args.title !== undefined ? String(args.title) : n.title
        const tags = args.tags !== undefined
          ? (Array.isArray(args.tags) ? args.tags.map(String) : [])
          : n.tags
        const desc = args.description !== undefined ? String(args.description ?? '') : body
        await updateNote(id, buildContent(title, tags, desc))
      }

      const updated = notes.value.find(x => x.id === id)
      return {
        result: updated ? { ...noteToResult(updated), description: splitContent(updated).body } : { error: 'Update failed' },
        label: args.is_task === true && !n.isTask
          ? `Converted "${n.title}" to task`
          : args.is_task === false && n.isTask
            ? `Converted "${n.title}" to note`
            : `Updated "${n.title}"`
      }
    }
    case 'delete_item': {
      const id = String(args.id ?? '')
      const n = notes.value.find(x => x.id === id)
      if (!n || n.deletedAt) return { result: { error: 'Item not found' }, label: 'Item not found' }
      await deleteNote(id) // soft delete — restorable from trash
      return { result: { ok: true, id, deleted: true }, label: `Moved "${n.title}" to trash` }
    }
    default:
      return { result: { error: `Unknown tool: ${name}` }, label: `Unknown tool ${name}` }
  }
}

// ─── Wire format (OpenAI messages sent to /api/chat) ─────────

function toWire(): Array<Record<string, unknown>> {
  return _messages.value
    .filter((m) => {
      if (m.role === 'tool') return !m.pending
      if (m.error || m.pending) return false
      return m.content.trim() !== '' || !!m.toolCalls
    })
    .map((m) => {
      if (m.role === 'assistant' && m.toolCalls) {
        return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls }
      }
      if (m.role === 'tool') {
        return { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content }
      }
      return { role: m.role, content: m.content }
    })
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

  async function runCompletion() {
    _busy.value = true
    _abort = new AbortController()

    let rounds = 0
    try {
      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++
        const assistant = ref<ChatMessage>({
          id: uid(),
          role: 'assistant',
          content: '',
          reasoning: '',
          pending: true
        })
        _messages.value.push(assistant.value)

        let toolCalls: ToolCallRequest[] | null = null
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: toWire(), thinking: _thinking.value }),
            signal: _abort.signal
          })

          if (!res.ok || !res.body) {
            const err = JSON.parse(await res.text().catch(() => '{}')) as { statusMessage?: string, message?: string }
            throw new Error(err.statusMessage ?? err.message ?? `Chat failed (${res.status})`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          stream: while (true) {
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
              if (evt.type === 'delta' && evt.text) {
                assistant.value.content += evt.text
              } else if (evt.type === 'reasoning' && evt.text) {
                assistant.value.reasoning = (assistant.value.reasoning ?? '') + evt.text
              } else if (evt.type === 'tool_calls' && evt.calls) {
                toolCalls = evt.calls
              } else if (evt.type === 'error') {
                throw new Error(evt.message ?? 'Model error')
              } else if (evt.type === 'done') {
                break stream
              }
            }
          }
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            assistant.value.pending = false
            if (!assistant.value.content && !assistant.value.reasoning) {
              _messages.value = _messages.value.filter(m => m.id !== assistant.value.id)
            }
            break
          }
          assistant.value.content = assistant.value.content || `⚠️ ${(error as Error).message}`
          assistant.value.error = true
          assistant.value.pending = false
          break
        }

        assistant.value.toolCalls = toolCalls ?? undefined
        assistant.value.pending = false

        if (!toolCalls) break

        // Execute tools locally, append tool results, let the model continue.
        for (const call of toolCalls) {
          const toolMsg = ref<ChatMessage>({
            id: uid(),
            role: 'tool',
            content: '',
            toolCallId: call.id,
            name: call.function.name,
            pending: true
          })
          _messages.value.push(toolMsg.value)
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
          } catch {
            // Malformed arguments — pass through empty and let the model retry.
          }
          try {
            const { result, label } = await executeTool(call.function.name, args)
            toolMsg.value.content = JSON.stringify(result)
            toolMsg.value.label = label
            const target = result as { id?: string, kind?: 'task' | 'note', error?: string }
            if (target && !target.error && target.id && (target.kind === 'task' || target.kind === 'note')) {
              toolMsg.value.targetId = target.id
              toolMsg.value.targetKind = target.kind
            }
          } catch (error) {
            toolMsg.value.content = JSON.stringify({ error: (error as Error).message })
            toolMsg.value.label = `${call.function.name} failed`
          }
          toolMsg.value.pending = false
        }
        // Loop: next round sends tool results back to the model.
      }
    } finally {
      _busy.value = false
      _abort = null
      // Trim trailing empty assistant messages (e.g. aborted before any token).
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
    stop,
    clearChat
  }
}
