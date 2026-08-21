import { db } from '../../../db'
import { projects, projectColumns, projectTasks } from '../../../db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { requireColumn, renumberColumnTasks, RESTORED } from '../../../utils/projects'
import { publishFromEvent } from '../../../utils/realtime'

// Brings a column back out of the board's trash, along with the tasks that went
// down with it. Deleting a column moves its tasks rather than deleting them, so
// "the tasks that went down with it" is two different groups: the ones handed to
// a neighbour, and — when it was the board's only column — the ones that had
// nowhere to go and were trashed alongside it.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { column, project } = await requireColumn(event, id, { includeDeleted: true })

  if (!column.deletedAt) return { ok: true, column, restoredTasks: 0 }

  // Trashed with the column: same timestamp, written in one statement. Cards
  // the user trashed by hand before the column went carry a different one and
  // stay in the trash, which is what they asked for.
  const withColumn = await db
    .update(projectTasks)
    .set(RESTORED)
    .where(and(eq(projectTasks.columnId, id), eq(projectTasks.deletedAt, column.deletedAt)))
    .returning({ id: projectTasks.id })

  // Handed to a neighbour on the way out, and not filed anywhere deliberately
  // since — moving a task clears the marker, so one the user has since put
  // somewhere on purpose stays where they put it.
  const relocated = await db
    .update(projectTasks)
    .set({ columnId: id, previousColumnId: null })
    .where(and(eq(projectTasks.previousColumnId, id), isNull(projectTasks.deletedAt)))
    .returning({ id: projectTasks.id })

  await db.update(projectColumns).set(RESTORED).where(eq(projectColumns.id, id))

  // Both groups arrive holding the positions they had before, which by now may
  // collide with each other or with cards added since.
  await renumberColumnTasks(id)

  await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))
  await publishFromEvent(event, { type: 'board', projectId: project.id })

  const [restored] = await db.select().from(projectColumns).where(eq(projectColumns.id, id))
  return { ok: true, column: restored, restoredTasks: withColumn.length + relocated.length }
})
