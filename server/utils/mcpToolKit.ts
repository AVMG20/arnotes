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
  /** Advertised for the writes that cannot be undone, so a client can warn first. */
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
