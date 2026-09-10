// The assistant's hands. Unlike the notes chat — where tools run in the browser
// because the browser owns the note store — Archive's rows live only on the
// server, so the whole loop runs here and the client is told what happened.
//
// Every tool that can take more than one thing takes a list. "Make me a todo
// list for this" has to be one call rather than seven: round trips are what a
// long agent turn actually costs.
import {
  createMemory,
  createTodos,
  dropTodos,
  forgetMemories,
  getMemories,
  listTodosForMemories,
  searchMemories,
  updateMemory,
  updateTodos,
  type ArchiveScope,
  type TodoInput
} from './archiveStore'
import type { ArchiveMemory, ArchiveTodo } from '../db/schema'

export interface ArchiveToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object', properties: Record<string, unknown>, required?: string[] }
  }
}

const todoFields = {
  title: { type: 'string', description: 'What needs doing, as a short imperative line.' },
  due: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (no # prefix).' },
  memory_id: { type: 'string', description: 'The memory this work belongs to, when it came out of one.' }
}

export const ARCHIVE_TOOLS: ArchiveToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: 'Full-text search over stored memories. The memory index is already in your context, so only search when the index titles are not enough to tell which memory holds what you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for in titles and bodies. Empty matches everything.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags every result must carry.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: 'Read the full body of one or more memories, plus any todos hanging off them. Always pass every id you need at once.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Memory ids from the index or from search_memory.' }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Store something new. Check the memory index first: if an entry already covers this ground, use revise instead of creating a second one. When this new memory replaces older ones, list them in supersedes and they are forgotten as part of the same call.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short label, specific enough to recognise in a list months from now.' },
          body: { type: 'string', description: 'Markdown body. Tables, ```mermaid diagrams and ```chart blocks are all rendered.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (no # prefix).' },
          supersedes: { type: 'array', items: { type: 'string' }, description: 'Ids of memories this one replaces. They are forgotten.' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'revise',
      description: 'Change a stored memory. Only the fields you pass change, and body and tags are replaced whole — send the complete new value, never a fragment.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id.' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Full replacement markdown body.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Full replacement tag list.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forget',
      description: 'Forget memories. This is a soft delete the user can have restored, but treat it as real: only forget what the user asked to drop, or duplicates you are consolidating.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Memory ids to forget.' },
          reason: { type: 'string', description: 'One line on why, for your own reply.' }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_todos',
      description: 'Add one or more todos in a single call. Use this whenever a memory implies work to do — a plan, a project, anything with steps.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Every todo to create, in order.',
            items: { type: 'object', properties: todoFields, required: ['title'] }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_todos',
      description: 'Change todos: tick them off, rename them, reschedule them. Pass every change in one call.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Todo id.' },
                done: { type: 'boolean', description: 'true ticks it off, false reopens it.' },
                ...todoFields
              },
              required: ['id']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'drop_todos',
      description: 'Remove todos that should never have existed or are no longer relevant. Ticking something off is update_todos with done:true — use that for finished work, not this.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Todo ids to drop.' }
        },
        required: ['ids']
      }
    }
  }
]

export const ARCHIVE_SYSTEM_PROMPT = `You are Archive: a chat window that is also the user's memory. There is no filing cabinet behind you and no folders for the user to keep tidy — you decide what is worth storing, where it goes, and when it is out of date. The user just talks to you.

You keep two kinds of thing:
- MEMORIES: anything worth knowing later — facts, preferences, decisions, plans, notes, reference material. A title, a markdown body and tags.
- TODOS: actual work with a done state. A plan almost always implies todos; create them without being asked.

Your context always carries an index of every memory and every open todo. Read it before you reach for a tool: it usually answers "does this already exist?" on its own.

## Cards

When you show the user something you have stored, emit it as a card — a fenced block whose info string is the ids, with nothing inside it:

\`\`\`memory:m_abc123
\`\`\`

\`\`\`todos:t_aaa,t_bbb,t_ccc
\`\`\`

A card draws the live row and is editable in place: the user ticks a todo, or fixes a wrong line in a memory, and it saves straight to storage without asking you. That is the fastest way for them to correct you, so prefer a card over retyping the contents as prose. You will see their corrections next turn, because you read storage fresh every time.

Rules for cards:
- Never write the contents inside the fence. The id is the whole card.
- Only ever put real ids in a card — ids you got from the index or from a tool result this turn.
- Show a card for anything you just created or changed, so the user can see and fix it.
- Do not card things you are merely mentioning in passing.

## Managing the store

- Prefer revise over remember. Two memories covering the same ground is the failure mode to avoid.
- Where two entries overlap, the one with the newer updated date wins. Fold the older into it and pass the old id in supersedes.
- Body and tags are replaced whole. Always send the complete new value.
- Keep memories small and single-subject. One memory per topic beats one per conversation.
- Split work out into todos rather than leaving checklists inside a memory body, and hang them off the memory with memory_id.
- Never tell the user to go and file something themselves. Storing it is your job.

## Replying

Ground every answer in what is actually stored. Be brief — a sentence or two around a card, not a summary of it. Never dump raw JSON or tool output. Use markdown; \`\`\`mermaid blocks render as diagrams and \`\`\`chart blocks as charts (lines of "type: bar|line|pie", "labels: a, b, c", then "Series: 1, 2, 3"). Dates are YYYY-MM-DD. Reply in the user's language.`

// ─── Execution ────────────────────────────────────────────────────────────────

export interface ArchiveToolOutcome {
  result: unknown
  /** One line for the transcript, e.g. "Remembered "Passport renewal"". */
  label: string
  /** Rows touched, pushed to the client so cards draw without a second request. */
  memories?: ArchiveMemory[]
  todos?: ArchiveTodo[]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).map(s => s.trim()).filter(Boolean)
}

/** The model writes YYYY-MM-DD; anything else is treated as "no date". */
function parseDue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null
  const ms = Date.parse(`${value.trim()}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

function memoryOut(row: ArchiveMemory) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    created: new Date(row.createdAt).toISOString().slice(0, 10),
    updated: new Date(row.updatedAt).toISOString().slice(0, 10)
  }
}

function todoOut(row: ArchiveTodo) {
  return {
    id: row.id,
    title: row.title,
    done: row.done,
    due: row.dueAt ? new Date(row.dueAt).toISOString().slice(0, 10) : null,
    tags: row.tags,
    memory_id: row.memoryId
  }
}

function quote(text: string): string {
  return text.length > 48 ? `"${text.slice(0, 47)}…"` : `"${text}"`
}

function toTodoInput(raw: Record<string, unknown>): TodoInput {
  return {
    title: String(raw.title ?? ''),
    dueAt: parseDue(raw.due),
    tags: asStringArray(raw.tags),
    memoryId: raw.memory_id ? String(raw.memory_id) : null
  }
}

export async function executeArchiveTool(
  scope: ArchiveScope,
  name: string,
  args: Record<string, unknown>
): Promise<ArchiveToolOutcome> {
  switch (name) {
    case 'search_memory': {
      const query = String(args.query ?? '')
      const rows = await searchMemories(scope, query, asStringArray(args.tags))
      return {
        result: {
          count: rows.length,
          results: rows.map(row => ({
            id: row.id,
            title: row.title,
            tags: row.tags,
            updated: new Date(row.updatedAt).toISOString().slice(0, 10),
            // A snippet, not the body: recall is one call away if it matters.
            snippet: row.body.slice(0, 200)
          }))
        },
        label: `Searched memory for ${quote(query || 'everything')}`,
        memories: rows
      }
    }

    case 'recall': {
      const ids = asStringArray(args.ids)
      const rows = (await getMemories(scope, ids)).filter(row => !row.deletedAt)
      const todos = await listTodosForMemories(scope, rows.map(row => row.id))
      return {
        result: {
          memories: rows.map(memoryOut),
          todos: todos.map(todoOut),
          missing: ids.filter(id => !rows.some(row => row.id === id))
        },
        label: rows.length === 1 ? `Recalled ${quote(rows[0]!.title)}` : `Recalled ${rows.length} memories`,
        memories: rows,
        todos
      }
    }

    case 'remember': {
      const row = await createMemory(scope, {
        title: String(args.title ?? 'Untitled'),
        body: String(args.body ?? ''),
        tags: asStringArray(args.tags)
      })
      // Consolidation is part of the same call so the store is never briefly
      // holding both the new memory and the ones it replaces.
      const superseded = await forgetMemories(scope, asStringArray(args.supersedes).filter(id => id !== row.id))
      return {
        result: { ...memoryOut(row), superseded: superseded.map(m => m.id) },
        label: `Remembered ${quote(row.title)}`,
        memories: [row, ...superseded]
      }
    }

    case 'revise': {
      const id = String(args.id ?? '')
      const patch: { title?: string, body?: string, tags?: string[] } = {}
      if (args.title !== undefined) patch.title = String(args.title)
      if (args.body !== undefined) patch.body = String(args.body)
      if (args.tags !== undefined) patch.tags = asStringArray(args.tags)

      const row = await updateMemory(scope, id, patch)
      if (!row) return { result: { error: `No memory with id ${id}` }, label: 'Memory not found' }
      return { result: memoryOut(row), label: `Revised ${quote(row.title)}`, memories: [row] }
    }

    case 'forget': {
      const rows = await forgetMemories(scope, asStringArray(args.ids))
      return {
        result: { forgotten: rows.map(row => row.id) },
        label: rows.length === 1 ? `Forgot ${quote(rows[0]!.title)}` : `Forgot ${rows.length} memories`,
        memories: rows
      }
    }

    case 'add_todos': {
      const raw = Array.isArray(args.todos) ? args.todos as Record<string, unknown>[] : []
      const rows = await createTodos(scope, raw.map(toTodoInput))
      return {
        result: { todos: rows.map(todoOut) },
        label: rows.length === 1 ? `Added a todo` : `Added ${rows.length} todos`,
        todos: rows
      }
    }

    case 'update_todos': {
      const raw = Array.isArray(args.todos) ? args.todos as Record<string, unknown>[] : []
      const patches = raw
        .filter(item => item.id)
        .map((item) => {
          const patch: TodoPatchWithId = { id: String(item.id) }
          if (item.title !== undefined) patch.title = String(item.title)
          if (item.done !== undefined) patch.done = item.done === true
          if (item.due !== undefined) patch.dueAt = parseDue(item.due)
          if (item.tags !== undefined) patch.tags = asStringArray(item.tags)
          if (item.memory_id !== undefined) patch.memoryId = item.memory_id ? String(item.memory_id) : null
          return patch
        })

      const rows = await updateTodos(scope, patches)
      const ticked = rows.filter(row => row.done).length
      return {
        result: { todos: rows.map(todoOut), missing: patches.length - rows.length },
        label: ticked && ticked === rows.length
          ? (rows.length === 1 ? 'Ticked off a todo' : `Ticked off ${rows.length} todos`)
          : `Updated ${rows.length} todos`,
        todos: rows
      }
    }

    case 'drop_todos': {
      const rows = await dropTodos(scope, asStringArray(args.ids))
      return {
        result: { dropped: rows.map(row => row.id) },
        label: rows.length === 1 ? 'Dropped a todo' : `Dropped ${rows.length} todos`,
        todos: rows
      }
    }

    default:
      return { result: { error: `Unknown tool ${name}` }, label: `Unknown tool ${name}` }
  }
}

type TodoPatchWithId = { id: string, title?: string, done?: boolean, dueAt?: number | null, tags?: string[], memoryId?: string | null }
