import type { H3Event } from 'h3'
import { randomInt } from 'crypto'
import { db } from '../db'
import { member, notes } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'

export async function getUserActiveTeamId(event: H3Event): Promise<string | null> {
  const session = event.context.session
  if (!session) return null

  const activeOrgId = session.session?.activeOrganizationId || null
  if (!activeOrgId) return null

  // Verify membership
  const userId = session.user.id
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, activeOrgId), eq(member.userId, userId)))

  if (!membership) return null
  return activeOrgId
}

const TEAM_ADMIN_ROLES = ['owner', 'admin']

export async function requireTeamRole(event: H3Event, organizationId: string, allowedRoles: string[] = TEAM_ADMIN_ROLES) {
  const session = event.context.session
  if (!session) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const userId = session.user.id
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw createError({ statusCode: 403, message: 'You do not have permission to do this' })
  }

  return membership
}

export async function isTeamMember(userId: string, organizationId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))

  return Boolean(membership)
}

/**
 * Scopes a note query to the caller's current workspace: every note of the active
 * team, or only the caller's own team-less notes when in the personal workspace.
 */
export async function getNoteAccessFilter(event: H3Event) {
  const userId = event.context.session.user.id
  const activeTeamId = await getUserActiveTeamId(event)

  return activeTeamId
    ? eq(notes.teamId, activeTeamId)
    : and(eq(notes.userId, userId), isNull(notes.teamId))
}

const JOIN_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I/L/O/0/1 — avoids visual ambiguity

// A join code grants access to every note in a team, so it must not be guessable.
export function generateJoinCode(length = 16): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += JOIN_CODE_CHARS[randomInt(JOIN_CODE_CHARS.length)]
  }
  return code
}

// Users retype codes with spaces or dashes; normalise before comparing.
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}
