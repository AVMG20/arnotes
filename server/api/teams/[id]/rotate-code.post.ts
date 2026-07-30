import { db } from '../../../db'
import { organization } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireTeamRole, generateJoinCode } from '../../../utils/auth-helpers'

export default defineEventHandler(async (event) => {
  const organizationId = getRouterParam(event, 'id')!
  await requireTeamRole(event, organizationId)

  let joinCode = generateJoinCode()
  for (let attempt = 0; attempt < 5; attempt++) {
    const [existing] = await db.select({ id: organization.id }).from(organization).where(eq(organization.joinCode, joinCode))
    if (!existing) break
    joinCode = generateJoinCode()
  }

  const [updated] = await db
    .update(organization)
    .set({ joinCode })
    .where(eq(organization.id, organizationId))
    .returning()

  if (!updated) throw createError({ statusCode: 404, message: 'Team not found' })

  return { joinCode: updated.joinCode }
})
