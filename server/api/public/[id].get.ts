import { findPublicNote } from '../../utils/publicAccess'

// A shared note, readable without a session. Only what the public page renders
// is returned — the row's owner and workspace are nobody else's business.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const note = await findPublicNote(id)
  if (!note) throw createError({ statusCode: 404, message: 'Note not found' })
  return note
})
