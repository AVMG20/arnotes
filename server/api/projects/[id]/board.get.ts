import { db } from '../../../db'
import { projectColumns, projectTasks, taskComments } from '../../../db/schema'
import { eq, asc, inArray, count } from 'drizzle-orm'
import { requireProject } from '../../../utils/projects'

// Full board in one payload: columns ordered, tasks grouped by column, and the
// per-task update count the cards render as a badge.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await requireProject(event, id)

  const columns = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.projectId, id))
    .orderBy(asc(projectColumns.position))

  const tasks = columns.length
    ? await db
        .select()
        .from(projectTasks)
        .where(inArray(projectTasks.columnId, columns.map(c => c.id)))
        .orderBy(asc(projectTasks.position))
    : []

  const counts = tasks.length
    ? await db
        .select({ taskId: taskComments.taskId, total: count() })
        .from(taskComments)
        .where(inArray(taskComments.taskId, tasks.map(t => t.id)))
        .groupBy(taskComments.taskId)
    : []

  return {
    columns,
    tasks,
    commentCounts: Object.fromEntries(counts.map(c => [c.taskId, Number(c.total)]))
  }
})
