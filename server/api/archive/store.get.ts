import { archiveScope, listAllMemories, listAllTodos } from '../../utils/archiveStore'

// Everything the assistant is keeping, for the sidebar. The assistant is meant
// to manage this on its own, but the user should be able to see what it holds
// and throw out what it got wrong without spending a turn on it.
export default defineEventHandler(async (event) => {
  const scope = await archiveScope(event)
  const [memories, todos] = await Promise.all([listAllMemories(scope), listAllTodos(scope)])
  return { memories, todos }
})
