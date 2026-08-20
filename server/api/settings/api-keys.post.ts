import { db } from '../../db'
import { apiKeys, API_KEY_SCOPES } from '../../db/schema'
import type { ApiKeyScope } from '../../db/schema'
import { generateApiKey, isApiKeyScope } from '../../utils/api-keys'
import { getUserActiveTeamId } from '../../utils/auth-helpers'

const MAX_NAME_LENGTH = 60
const MAX_EXPIRY_DAYS = 3650

interface CreateApiKeyBody {
  name?: string
  scopes?: string[]
  /** Days until the key stops working. Omit or pass null for a key that never expires. */
  expiresInDays?: number | null
}

/**
 * Issues an API key for the caller's active workspace. The key itself is returned
 * exactly once — only its SHA-256 digest is stored — so the response is the one
 * chance the user has to copy it.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<CreateApiKeyBody>(event)
  const userId = event.context.session.user.id
  const teamId = await getUserActiveTeamId(event)

  const name = (body.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, message: 'Give the key a name' })
  if (name.length > MAX_NAME_LENGTH) {
    throw createError({ statusCode: 400, message: `Key names are limited to ${MAX_NAME_LENGTH} characters` })
  }

  const scopes = [...new Set(body.scopes ?? [])].filter(isApiKeyScope)
  if (!scopes.length) {
    throw createError({ statusCode: 400, message: `Pick at least one permission (${API_KEY_SCOPES.join(', ')})` })
  }

  let expiresAt: number | null = null
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    const days = Number(body.expiresInDays)
    if (!Number.isFinite(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
      throw createError({ statusCode: 400, message: 'Expiry must be between 1 and 3650 days' })
    }
    expiresAt = Date.now() + Math.floor(days) * 86_400_000
  }

  const generated = generateApiKey()

  const [created] = await db.insert(apiKeys).values({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    userId,
    teamId,
    name,
    keyHash: generated.hash,
    keyPrefix: generated.displayPrefix,
    scopes: scopes as ApiKeyScope[],
    expiresAt,
    createdAt: Date.now()
  }).returning()

  return {
    // Shown once, never retrievable again.
    token: generated.token,
    key: {
      id: created!.id,
      name: created!.name,
      keyPrefix: created!.keyPrefix,
      scopes: created!.scopes,
      createdAt: created!.createdAt,
      lastUsedAt: created!.lastUsedAt,
      expiresAt: created!.expiresAt
    }
  }
})
