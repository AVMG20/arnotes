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
      name: 'search_items',
      description: 'Full-text search across the user\'s tasks and notes (titles, content, tags). Use this before answering questions about their data, or to find items to link, open or edit.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Empty string matches everything.' },
          kind: { type: 'string', enum: ['task', 'note', 'both'], description: 'Restrict results to tasks, notes, or both. Default: both.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags all results must have.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_item',
      description: 'Read one task or note in full: description as markdown, tags, status, due date and custom properties. Use ids returned by search_items.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The item id from a previous search or creation result.' }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task. Pass a clear title and a markdown description. Custom properties can store metadata such as a link back to the source tool (e.g. Asana).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title.' },
          description: { type: 'string', description: 'Markdown description. Use "- [ ]" checklist items for subtasks.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (no # prefix).' },
          due_date: { type: 'string', description: 'Due date as YYYY-MM-DD, or empty to leave unset.' },
          custom_properties: {
            type: 'array',
            description: 'Custom properties for this task.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Property name, e.g. "Asana".' },
                type: { type: 'string', enum: ['text', 'link', 'note'], description: 'Value type. Use "link" for URLs.' },
                value: { type: 'string', description: 'Property value (URL for type "link").' }
              },
              required: ['name', 'value']
            }
          }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Create a new note (not a task) with markdown content.',
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
      name: 'update_item',
      description: 'Edit an existing task or note. Only provided fields change; description/tags/tags-lists are replaced as a whole when given. Tasks support status, due_date and custom_properties.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The item id.' },
          title: { type: 'string', description: 'New title.' },
          description: { type: 'string', description: 'Full replacement markdown description/body.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Full replacement tag list (no # prefix).' },
          status: { type: 'string', enum: ['open', 'done'], description: 'Task status.' },
          due_date: { type: 'string', description: 'New due date as YYYY-MM-DD, or empty string to clear.' },
          custom_properties: {
            type: 'array',
            description: 'Full replacement custom property list (existing ones not repeated here are removed).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: ['text', 'link', 'note'] },
                value: { type: 'string' }
              },
              required: ['name', 'value']
            }
          }
        },
        required: ['id']
      }
    }
  }
]

export const CHAT_SYSTEM_PROMPT = `You are Arnai, the AI assistant built into Arnotes, a self-hosted notes and tasks app. In this app a task is also a note: tasks have an open/done status, an optional due date, tags, and custom properties (each has a name, a type — text, link or note — and a value).

You can search, read, create and edit the user's tasks and notes through the provided tools. Ground every answer about their data in tool results — search first, then answer. After creating or editing items, briefly confirm what you did; do not dump raw JSON at the user.

Common flows:
- The user often pastes tasks exported from Asana or similar tools (tab/pipe separated rows, bullet lists, or links). Parse them and create one task each: a short actionable title and a markdown description with the details. Turn subtasks into "- [ ]" checklist items in the description. If a row or the pasted text contains a source URL (e.g. app.asana.com/...), store it as a custom property named "Asana" with type "link" on that task. Extract due dates when present and set due_date.
- For questions like "what do I still need to do" or "find the note about X", search and summarize concisely (group, count, list titles with due dates when relevant).
- When editing, always pass complete replacement values for description/tags/custom_properties, not deltas.

Dates are YYYY-MM-DD. Be concise, use markdown, and reply in the user's language.`
