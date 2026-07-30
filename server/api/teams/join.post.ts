import { db } from '../../db'
import { organization, member } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { normalizeJoinCode } from '../../utils/auth-helpers'

export default defineEventHandler(async (event) => {
  const session = event.context.session
  if (!session) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const userId = session.user.id
  const body = await readBody<{ code?: string }>(event)
  const code = normalizeJoinCode(body?.code ?? '')

  if (!code) {
    throw createError({ statusCode: 400, message: 'Team code is required' })
  }

  // Find organization by join code
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.joinCode, code))

  if (!org) {
    throw createError({ statusCode: 404, message: 'Invalid team code. Team not found.' })
  }

  // Check if already a member
  const [existingMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, org.id), eq(member.userId, userId)))

  if (!existingMember) {
    // Add user as member
    await db.insert(member).values({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      organizationId: org.id,
      userId,
      role: 'member',
      createdAt: new Date()
    })
  }

  return { ok: true, organization: org }
})
