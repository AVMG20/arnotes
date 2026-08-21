import { db } from '../../../db'
import { projectColumns, projectTasks, taskComments } from '../../../db/schema'
import { and, eq, asc, inArray, count, isNull, isNotNull } from 'drizzle-orm'
import { requireProject } from '../../../utils/projects'

// Full board in one payload: columns ordered, tasks grouped by column, and the
// per-task update count the cards render as a badge.
//
// `?trashed=1` additionally returns the board's soft-deleted columns and tasks,
// which is what the board's "Show trashed" mode draws. The count of them comes
// back either way — the header needs to know there is something in the trash
// before the user has asked to see it, which is the whole point when the delete
// happened overnight through an agent.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await requireProject(event, id)

  const includeTrashed = getQuery(event).trashed === '1'
  const liveColumns = isNull(projectColumns.deletedAt)
  const liveTasks = isNull(projectTasks.deletedAt)

  const columns = await db
    .select()
    .from(projectColumns)
    .where(and(
      eq(projectColumns.projectId, id),
      includeTrashed ? undefined : liveColumns
    ))
    .orderBy(asc(projectColumns.position))

  // A task trashed on its own sits in a column that is still there; a task
  // trashed along with its column sits in one that is not. Selecting by column
  // covers both, because the column list above already widened with the flag.
  const tasks = columns.length
    ? await db
        .select()
        .from(projectTasks)
        .where(and(
          inArray(projectTasks.columnId, columns.map(c => c.id)),
          includeTrashed ? undefined : liveTasks
        ))
        .orderBy(asc(projectTasks.position))
    : []

  const counts = tasks.length
    ? await db
        .select({ taskId: taskComments.taskId, total: count() })
        .from(taskComments)
        .where(inArray(taskComments.taskId, tasks.map(t => t.id)))
        .groupBy(taskComments.taskId)
    : []

  // Counted rather than derived from the rows above, so the number is right
  // even when the trashed rows were not asked for. A live task never sits in a
  // trashed column — deleting one hands its tasks to a neighbour — so the two
  // counts do not overlap.
  const [trashedTasks] = await db
    .select({ total: count() })
    .from(projectTasks)
    .where(and(eq(projectTasks.projectId, id), isNotNull(projectTasks.deletedAt)))

  const [trashedColumns] = await db
    .select({ total: count() })
    .from(projectColumns)
    .where(and(eq(projectColumns.projectId, id), isNotNull(projectColumns.deletedAt)))

  return {
    columns,
    tasks,
    commentCounts: Object.fromEntries(counts.map(c => [c.taskId, Number(c.total)])),
    trashedCount: Number(trashedTasks?.total ?? 0) + Number(trashedColumns?.total ?? 0)
  }
})
