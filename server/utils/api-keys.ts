import type { H3Event } from 'h3'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { apiKeys, API_KEY_SCOPES } from '../db/schema'
import type { ApiKeyScope } from '../db/schema'
import { isTeamMember } from './auth-helpers'

// Keys are recognisable on sight so they can be spotted in configs and logs.
export const API_KEY_PREFIX = 'arn_'
const SECRET_BYTES = 32
// Enough of the key to tell two of them apart in the settings list.
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 6

export interface GeneratedApiKey {
  /** The full key. Returned to the creator once and never stored. */
  token: string
  hash: string
  displayPrefix: string
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateApiKey(): GeneratedApiKey {
  const token = API_KEY_PREFIX + randomBytes(SECRET_BYTES).toString('base64url')
  return {
    token,
    hash: hashApiKey(token),
    displayPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH)
  }
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value)
}

export interface ApiKeyContext {
  keyId: string
  userId: string
  /** The single workspace this key may touch; null for the owner's personal notes. */
  teamId: string | null
  scopes: ApiKeyScope[]
}

function readBearerToken(event: H3Event): string | null {
  const header = getRequestHeader(event, 'authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

// Only touch the database when the stored value is meaningfully stale, so a busy
// agent does not issue a write per tool call.
const LAST_USED_WRITE_INTERVAL = 60_000

function touchLastUsed(keyId: string, previous: number | null, now: number) {
  if (previous && now - previous < LAST_USED_WRITE_INTERVAL) return
  db.update(apiKeys)
    .set({ lastUsedAt: now })
    .where(eq(apiKeys.id, keyId))
    .catch(() => {
      // Usage tracking is best-effort; never fail a request over it.
    })
}

/**
 * Resolves the `Authorization: Bearer` key on a request into the workspace and
 * permissions it carries. Throws 401 when the key is missing, unknown, expired,
 * or no longer backed by a membership in the team it was issued for.
 */
export async function authenticateApiKey(event: H3Event): Promise<ApiKeyContext> {
  const token = readBearerToken(event)
  const unauthorized = () => createError({ statusCode: 401, message: 'Invalid or missing API key' })
  if (!token) throw unauthorized()

  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashApiKey(token)))
  if (!key) throw unauthorized()

  // The lookup already matched on a digest of the full secret; this compares the
  // digests themselves so the final decision does not depend on string timing.
  const presented = Buffer.from(hashApiKey(token), 'hex')
  const stored = Buffer.from(key.keyHash, 'hex')
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) throw unauthorized()

  const now = Date.now()
  if (key.expiresAt && key.expiresAt <= now) {
    throw createError({ statusCode: 401, message: 'API key has expired' })
  }

  // A key pinned to a team dies with the owner's membership in it.
  if (key.teamId && !(await isTeamMember(key.userId, key.teamId))) {
    throw createError({ statusCode: 403, message: 'API key owner is no longer a member of this team' })
  }

  touchLastUsed(key.id, key.lastUsedAt, now)

  return {
    keyId: key.id,
    userId: key.userId,
    teamId: key.teamId,
    scopes: key.scopes.filter(isApiKeyScope)
  }
}

export function hasScope(context: ApiKeyContext, scope: ApiKeyScope): boolean {
  return context.scopes.includes(scope)
}
