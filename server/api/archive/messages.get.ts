import { and, desc, sql } from 'drizzle-orm'
import { db } from '../../db'
import { archiveMessages } from '../../db/schema'
import { archiveScope, messageScopeFilter } from '../../utils/archiveStore'

// One rolling conversation, newest page first. Archive has no chat list — you
// scroll this one back as far as you care to.
const PAGE = 30
const MAX_PAGE = 100

export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const query = getQuery(event)

  const limit = Math.min(MAX_PAGE, Math.max(1, Number(query.limit) || PAGE))

  const conditions = [messageScopeFilter(scope)]

  // Cursor is (createdAt, id) rather than createdAt alone: two messages can
  // share a millisecond, and a page boundary landing between them would drop
  // one from the transcript for good.
  if (typeof query.before === 'string' && query.before.includes(':')) {
    const [rawTs, ...rest] = query.before.split(':')
    const ts = Number(rawTs)
    const id = rest.join(':')
    if (Number.isFinite(ts) && id) {
      conditions.push(sql`(${archiveMessages.createdAt}, ${archiveMessages.id}) < (${ts}, ${id})`)
    }
  }

  const rows = await db.select().from(archiveMessages)
    .where(and(...conditions))
    .orderBy(desc(archiveMessages.createdAt), desc(archiveMessages.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse()
  const oldest = page[0]

  return {
    messages: page,
    hasMore,
    cursor: hasMore && oldest ? `${oldest.createdAt}:${oldest.id}` : null
  }
})
