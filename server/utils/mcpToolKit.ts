// Shared shape and argument parsing for MCP tools. Notes and boards each own a
// registry file; both build tools out of the pieces here so a tool behaves the
// same whichever feature it belongs to.
import type { ApiKeyScope } from '../db/schema'
import type { ApiKeyContext } from './api-keys'

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  scope: ApiKeyScope
  /** Advertised to clients so they can surface which tools change data. */
  readOnly: boolean
  /**
   * Advertised for the writes that cannot be undone, so a client can warn
   * first. Nothing sets it today: every delete an agent can reach goes to a
   * trash the user can empty or undo, and boards cannot be deleted over MCP
   * at all.
   */
  destructive?: boolean
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: (args: Record<string, unknown>, context: ApiKeyContext) => Promise<unknown>
}

/** A failure the model should read and retry, rather than a transport-level error. */
export class McpToolError extends Error {}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new McpToolError(`"${key}" is required and must be a non-empty string.`)
  }
  return value
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new McpToolError(`"${key}" must be a string.`)
  return value
}

export function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new McpToolError(`"${key}" must be an array of strings.`)
  }
  return value as string[]
}

export function optionalLimit(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    throw new McpToolError(`"${key}" must be a positive number.`)
  }
  return Math.min(Math.floor(value), max)
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/**
 * The id inside a reference someone pasted.
 *
 * Arnotes already addresses everything by a URL the user can copy straight out
 * of the address bar — /note/<id>, /projects/<id>, /projects/<id>?task=<id> and
 * their /public/ equivalents — so a pasted link is the easiest way to point an
 * agent at one exact thing, with no title to describe and no id to retype.
 *
 * `prefer: 'task'` reads the task a board link has open; 'page' reads the note
 * or board the link is for. Anything that is not a link comes back untouched
 * and goes on being used as an id or a name, so a board actually named
 * "Q1/Q2 roadmap" is still found by its name.
 */
export function idFromReference(ref: string, prefer: 'task' | 'page' = 'page'): string {
  const trimmed = ref.trim()
  if (!/^(https?:\/\/|\/)/i.test(trimmed)) return trimmed

  let path: string
  let taskId: string | null
  try {
    // A bare path needs a base to parse against; the origin is discarded anyway.
    const url = new URL(trimmed, 'https://arnotes.invalid')
    path = url.pathname
    taskId = url.searchParams.get('task')
  } catch {
    return trimmed
  }

  if (prefer === 'task' && taskId) return taskId
  return decodeURIComponent(path.split('/').filter(Boolean).at(-1) ?? '') || trimmed
}

/**
 * A short excerpt of plain text, for the list-shaped results that show what a
 * note or task is about without spending the whole body on it.
 *
 * With search terms it centres on the first one that hits, keeping `lead`
 * characters of run-up; with none it takes the opening of the text, which is
 * what a card shows. Either end that was cut is marked with an ellipsis so the
 * model can tell an excerpt from a complete body and fetch the rest.
 */
export function excerpt(text: string, terms: string[] = [], length = 200, lead = 60): string {
  if (!text) return ''
  const lowered = text.toLowerCase()
  const firstHit = terms.map(term => lowered.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, firstHit - lead)
  const snippet = text.slice(start, start + length).trim()
  return (start > 0 ? '…' : '') + snippet + (start + length < text.length ? '…' : '')
}
