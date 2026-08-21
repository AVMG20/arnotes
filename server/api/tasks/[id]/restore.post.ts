import { db } from '../../../db'
import { projects, projectColumns, projectTasks } from '../../../db/schema'
import { eq } from 'drizzle-orm'
import { requireTask, projectColumnsOrdered, renumberColumnTasks, RESTORED } from '../../../utils/projects'
import { publishFromEvent } from '../../../utils/realtime'

// Brings one card back out of the board's trash. It kept its column and its
// position, so it lands where it was — unless that column has gone in the
// meantime, which the two branches below are about.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { task, project } = await requireTask(event, id, { includeDeleted: true })

  if (!task.deletedAt) return { ok: true, task, restoredColumn: null }

  const [column] = await db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.id, task.columnId))

  let columnId = task.columnId
  let restoredColumn: string | null = null

  if (column?.deletedAt) {
    // Its column is in the trash too. Bringing the column back with it is the
    // only way the card has somewhere to be drawn; the rest of that column's
    // trashed cards stay where they are, since only this one was asked for.
    await db.update(projectColumns).set(RESTORED).where(eq(projectColumns.id, column.id))
    restoredColumn = column.name
  } else if (!column) {
    // The column was removed for good while the card sat in the trash. The
    // board's first column is the one place it can still go.
    const [first] = await projectColumnsOrdered(task.projectId)
    if (!first) throw createError({ statusCode: 409, message: 'This board has no column to restore the task into' })
    columnId = first.id
    restoredColumn = first.name
  }

  await db
    .update(projectTasks)
    .set({ ...RESTORED, columnId, updatedAt: Date.now() })
    .where(eq(projectTasks.id, id))

  // It arrives holding the position it had, which may since have been taken.
  await renumberColumnTasks(columnId)

  await db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, project.id))
  await publishFromEvent(event, { type: 'board', projectId: project.id })

  const [restored] = await db.select().from(projectTasks).where(eq(projectTasks.id, id))
  return { ok: true, task: restored, restoredColumn }
})
