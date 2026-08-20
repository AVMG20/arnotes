// Arnotes' MCP server, spoken over the Streamable HTTP transport: one JSON-RPC
// request per POST, answered with a single JSON response. There is no session
// state, so any agent that can send an `Authorization: Bearer` header can
// connect, and every request is authorised on its own.
import { authenticateApiKey, hasScope } from '../../utils/api-keys'
import type { ApiKeyContext } from '../../utils/api-keys'
import { toolsForScopes } from '../../utils/mcpTools'
import { McpToolError } from '../../utils/mcpToolKit'
import { API_KEY_SCOPES } from '../../db/schema'
import type { ApiKeyScope } from '../../db/schema'
import { publish, workspaceTopic } from '../../utils/realtime'
import type { RealtimeEvent } from '../../utils/realtime'

const SERVER_NAME = 'arnotes'
const SERVER_VERSION = '0.1.0'

// Newest first. The client's requested version is echoed when we speak it,
// otherwise we answer with the newest one we do speak and let it decide.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]!

const INSTRUCTIONS = `Arnotes is a tag-based note-taking app with kanban boards beside the notes.

A note has a title, a Markdown body and tags, and tags are written inline in the body as #hashtags. A board has columns (kanban stages such as Backlog, To do, Verify, Done) holding tasks; a task has a title, a Markdown description, labels, and a running log of short updates.

Search or list before answering questions about the user's notes or boards, and ground answers in what the tools return. Read the board with get_board before creating or moving tasks so board, column and task names match. When editing, send the complete replacement body or description rather than a fragment — read the note or task first if you are only changing part of it.

delete_note only moves a note to the trash, where restore_note can bring it back. Boards, columns and tasks have no trash: delete_board, delete_column and delete_task are permanent, so prefer move_task into a "Done" column over deleting, and confirm with the user before deleting anything.`

const JSON_RPC_VERSION = '2.0'

const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603
} as const

type JsonRpcId = string | number | null

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: JsonRpcId
  method?: unknown
  params?: unknown
}

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: JSON_RPC_VERSION, id, result: value }
}

function failure(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const ALL_SCOPES: ApiKeyScope[] = [...API_KEY_SCOPES]

/**
 * Tells the workspace's open browsers that an agent changed something, so a
 * board or note list on screen refreshes instead of going stale. Board results
 * carry the board they touched; anything else falls back to the coarse signal.
 */
function announceWrite(tool: { scope: ApiKeyScope }, value: unknown, context: ApiKeyContext) {
  const topic = workspaceTopic(context.userId, context.teamId)
  if (tool.scope === 'notes:write') {
    publish(topic, { type: 'notes' })
    return
  }
  if (tool.scope !== 'boards:write') return

  const board = asRecord(value).board
  const projectId = typeof board === 'object' && board !== null
    ? (board as Record<string, unknown>).id
    : undefined

  const event: RealtimeEvent = typeof projectId === 'string'
    ? { type: 'board', projectId }
    // Creating, renaming or deleting a board changes the list itself, and the
    // client reloads the open board along with it.
    : { type: 'projects' }
  publish(topic, event)
}

/** Tool failures are reported inside the result so the model can read and retry them. */
function toolFailure(id: JsonRpcId, message: string) {
  return result(id, { content: [{ type: 'text', text: message }], isError: true })
}

async function handleMessage(message: JsonRpcMessage, context: ApiKeyContext) {
  const id = message.id ?? null

  if (message.jsonrpc !== JSON_RPC_VERSION || typeof message.method !== 'string') {
    return failure(id, ErrorCode.InvalidRequest, 'Expected a JSON-RPC 2.0 request with a "method".')
  }

  const method = message.method
  const params = asRecord(message.params)

  // Notifications carry no id and get no reply.
  if (method.startsWith('notifications/')) return null

  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion
      const protocolVersion = typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION

      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: 'Arnotes', version: SERVER_VERSION },
        instructions: INSTRUCTIONS
      })
    }

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, {
        tools: toolsForScopes(context.scopes).map(tool => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            title: tool.title,
            readOnlyHint: tool.readOnly,
            destructiveHint: tool.destructive === true,
            idempotentHint: tool.readOnly
          }
        }))
      })

    case 'tools/call': {
      const name = params.name
      if (typeof name !== 'string') {
        return failure(id, ErrorCode.InvalidParams, 'Expected a tool "name".')
      }

      const tool = toolsForScopes(context.scopes).find(candidate => candidate.name === name)
      if (!tool) {
        // A tool that exists but is out of scope gets a message the model can act
        // on, rather than one that reads like a client bug.
        const outOfScope = toolsForScopes(ALL_SCOPES).find(candidate => candidate.name === name)
        return outOfScope
          ? toolFailure(id, `This API key does not carry the "${outOfScope.scope}" permission that "${name}" requires.`)
          : failure(id, ErrorCode.MethodNotFound, `Unknown tool "${name}".`)
      }

      try {
        const value = await tool.handler(asRecord(params.arguments), context)
        if (!tool.readOnly) announceWrite(tool, value, context)
        return result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
      } catch (error) {
        if (error instanceof McpToolError) return toolFailure(id, error.message)
        console.error(`[mcp] ${name} failed`, error)
        return toolFailure(id, `The "${name}" tool failed. Check the Arnotes server logs for details.`)
      }
    }

    // Advertised capabilities cover tools only, but clients probe these anyway.
    case 'resources/list':
      return result(id, { resources: [] })
    case 'prompts/list':
      return result(id, { prompts: [] })

    default:
      return failure(id, ErrorCode.MethodNotFound, `Unknown method "${method}".`)
  }
}

export default defineEventHandler(async (event) => {
  let context: ApiKeyContext
  try {
    context = await authenticateApiKey(event)
  } catch (error) {
    // Point unauthenticated clients at the scheme they should use.
    setResponseHeader(event, 'WWW-Authenticate', 'Bearer realm="Arnotes MCP"')
    throw error
  }

  if (!ALL_SCOPES.some(scope => hasScope(context, scope))) {
    throw createError({ statusCode: 403, message: 'This API key carries no permissions' })
  }

  const raw = await readRawBody(event, 'utf8')
  let payload: unknown
  try {
    payload = JSON.parse(raw || '')
  } catch {
    setResponseStatus(event, 400)
    return failure(null, ErrorCode.ParseError, 'Request body is not valid JSON.')
  }

  // JSON-RPC batches were dropped in the current MCP revision but older clients
  // still send them, so both shapes are accepted.
  const messages = Array.isArray(payload) ? payload : [payload]
  if (!messages.length) {
    setResponseStatus(event, 400)
    return failure(null, ErrorCode.InvalidRequest, 'Request body is empty.')
  }

  const responses = (await Promise.all(
    messages.map(message => handleMessage(asRecord(message) as JsonRpcMessage, context))
  )).filter(response => response !== null)

  // Nothing but notifications — acknowledge without a body, as the transport requires.
  if (!responses.length) {
    setResponseStatus(event, 202)
    return null
  }

  setResponseHeader(event, 'Content-Type', 'application/json')
  return Array.isArray(payload) ? responses : responses[0]
})
