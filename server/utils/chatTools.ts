// Tool definitions for the AI chat assistant. Tools are advertised to the
// model here (OpenAI-style function schemas) but executed on the client,
// which owns the notes/projects stores and the search index.

export interface ChatToolCallDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export const CHAT_TOOLS: ChatToolCallDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Full-text search across the user\'s notes (titles, content, tags). Use this before answering questions about their notes, or to find notes to open or edit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Empty string matches everything.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags all results must have.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_note',
      description: 'Read one note in full: body as markdown and tags. Use ids returned by search_notes.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The note id from a previous search or creation result.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Create a new note with markdown content.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title.' },
          content: { type: 'string', description: 'Markdown body of the note.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (no # prefix).' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_note',
      description: 'Edit an existing note. Only provided fields change; body and tags are replaced as a whole when given.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The note id.' },
          title: { type: 'string', description: 'New title.' },
          content: { type: 'string', description: 'Full replacement markdown body.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Full replacement tag list (no # prefix).' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: 'Move a note to the trash (soft delete, recoverable from the trash view).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The note id.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_boards',
      description: 'List the user\'s kanban project boards (id, name, last updated).',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_board',
      description: 'Read one board in full: its columns (in order) and every task (id, column, title, markdown description, tags, updated). Use before creating or moving tasks so names match.',
      parameters: {
        type: 'object',
        properties: {
          board: { type: 'string', description: 'Board id or name (case-insensitive).' }
        },
        required: ['board']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_board',
      description: 'Create a new kanban board. It starts with the default columns: Backlog, To do, Verify, Done.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Board name.' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_tasks',
      description: 'Search across the tasks of every board by text and/or tags (labels like priority or workstream).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Empty string matches all tasks.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags all results must have.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a task on a board. Description is markdown; tags are kanban labels (e.g. priority, workstream).',
      parameters: {
        type: 'object',
        properties: {
          board: { type: 'string', description: 'Board id or name.' },
          column: { type: 'string', description: 'Column name, e.g. Backlog, To do, Verify, Done.' },
          title: { type: 'string', description: 'Task title.' },
          description: { type: 'string', description: 'Markdown description.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Labels (no # prefix).' }
        },
        required: ['board', 'column', 'title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Edit an existing task. Only provided fields change; description and tags are replaced as a whole when given.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id.' },
          title: { type: 'string', description: 'New title.' },
          description: { type: 'string', description: 'Full replacement markdown description.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Full replacement label list.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_task',
      description: 'Move a task to another column of its board, e.g. mark it done.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id.' },
          column: { type: 'string', description: 'Target column name.' }
        },
        required: ['id', 'column']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_task',
      description: 'Move a task to its board\'s trash. Recoverable: the user can restore it from "Show trashed" on the board for 7 days.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task id.' }
        },
        required: ['id']
      }
    }
  }
]

export const CHAT_SYSTEM_PROMPT = `You are Arnai, the AI assistant built into Arnotes, a self-hosted notes and kanban app. A note has a title, a markdown body and tags. A board (project) has columns (kanban stages like Backlog, To do, Verify, Done) and tasks; a task has a title, a markdown description and labels used for priority or workstream.

You can search, read, create and edit the user's notes and boards through the provided tools. Ground every answer in tool results — search or inspect first, then answer. After creating or editing anything, briefly confirm what you did; do not dump raw JSON at the user.

Guidelines:
- For questions like "find the note about X" or "summarize what I wrote about Y", search and summarize concisely (list titles, group where useful).
- For board work, use get_board before create_task or move_task so board, column and task names match exactly.
- When editing, always pass complete replacement values for content, description and tags, not deltas.
- Use "- [ ]" checklist items when the user wants a checklist in a note or task description.
- delete_note and delete_task both only move things to the trash, where the user can restore them — confirm intent in your reply, not with an extra question, when the request was explicit.

Dates are YYYY-MM-DD. Be concise, use markdown, and reply in the user's language.`
