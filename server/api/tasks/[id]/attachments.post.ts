import { requireTask } from '../../../utils/projects'
import { countAttachments, MAX_ATTACHMENTS, storeImageUpload, taskAttachmentDir } from '../../../utils/attachments'

// Images pasted or dropped into a task description. Same rules as a note's
// attachments; the file lives with the task and goes when the task does.
export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'id')!
  const { task } = await requireTask(event, taskId)

  const dir = taskAttachmentDir(task.id)
  if (countAttachments(dir) >= MAX_ATTACHMENTS) {
    throw createError({ statusCode: 400, message: `Attachment limit reached (max ${MAX_ATTACHMENTS})` })
  }

  const form = await readMultipartFormData(event)
  const filename = storeImageUpload(dir, form?.find(p => p.name === 'file'))

  return { url: `/api/attachments/tasks/${task.id}/${filename}` }
})
