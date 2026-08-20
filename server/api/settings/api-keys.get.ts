import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { apiKeys, organization } from '../../db/schema'
import { getUserActiveTeamId } from '../../utils/auth-helpers'

/**
 * Lists the caller's API keys for the workspace they are currently in. Keys are
 * bound to one workspace, so the list follows the active team the same way the
 * notes list does.
 */
export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const teamId = await getUserActiveTeamId(event)

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), teamId ? eq(apiKeys.teamId, teamId) : isNull(apiKeys.teamId)))
    .orderBy(desc(apiKeys.createdAt))

  let workspaceName = 'Personal'
  if (teamId) {
    const [team] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, teamId))
    workspaceName = team?.name ?? 'Team'
  }

  return {
    workspace: { id: teamId, name: workspaceName },
    keys: rows.map(key => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt
    }))
  }
})
