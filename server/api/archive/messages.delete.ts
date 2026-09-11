import { db } from '../../db'
import { archiveMessages } from '../../db/schema'
import { archiveScope, messageScopeFilter } from '../../utils/archiveStore'

// Clears the conversation only. Memories and todos are the point of Archive and
// survive this — dropping the chat is not the same as forgetting.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)

  await db.delete(archiveMessages).where(messageScopeFilter(scope))

  return { ok: true }
})
