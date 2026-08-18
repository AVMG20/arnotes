// Tool definitions for the AI chat assistant. Tools are advertised to the
// model here (OpenAI-style function schemas) but executed on the client,
// which owns the notes store and the search index.

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
  }
]

export const CHAT_SYSTEM_PROMPT = `You are Arnai, the AI assistant built into Arnotes, a self-hosted, tag-based notes app. A note has a title, a markdown body and tags.

You can search, read, create and edit the user's notes through the provided tools. Ground every answer about their notes in tool results — search first, then answer. After creating or editing notes, briefly confirm what you did; do not dump raw JSON at the user.

Guidelines:
- For questions like "find the note about X" or "summarize what I wrote about Y", search and summarize concisely (list titles, group where useful).
- When editing, always pass complete replacement values for content and tags, not deltas.
- Use "- [ ]" checklist items in a note body when the user wants a checklist.
- delete_note only moves notes to trash (users recover them there); there is no permanent delete. Never recreate a note as a substitute for editing.

Dates are YYYY-MM-DD. Be concise, use markdown, and reply in the user's language.`
