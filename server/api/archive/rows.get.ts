import { archiveScope, getMemories, getTodos } from '../../utils/archiveStore'

// Cards draw from live rows. A reply usually arrives with its rows attached to
// the stream, so this is for the other case: scrolling back to an older message
// whose cards this tab has never fetched.
const MAX_IDS = 200

function ids(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  return [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))].slice(0, MAX_IDS)
}

export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const query = getQuery(event)

  const [memories, todos] = await Promise.all([
    getMemories(scope, ids(query.memories)),
    getTodos(scope, ids(query.todos))
  ])

  return { memories, todos }
})
