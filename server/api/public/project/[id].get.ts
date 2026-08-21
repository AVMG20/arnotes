import { db } from '../../../db'
import { projectColumns, projectTasks } from '../../../db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { findPublicProject } from '../../../utils/publicAccess'

// A shared board, readable without a session: the columns and the cards on
// them, and nothing else. Task updates stay behind the workspace — sharing a
// board publishes the work, not the discussion around it.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const project = await findPublicProject(id)
  if (!project) throw createError({ statusCode: 404, message: 'Board not found' })

  const columns = await db
    .select({
      id: projectColumns.id,
      name: projectColumns.name,
      color: projectColumns.color,
      position: projectColumns.position
    })
    .from(projectColumns)
    .where(and(eq(projectColumns.projectId, id), isNull(projectColumns.deletedAt)))
    .orderBy(asc(projectColumns.position))

  const tasks = columns.length
    ? await db
        .select({
          id: projectTasks.id,
          columnId: projectTasks.columnId,
          title: projectTasks.title,
          description: projectTasks.description,
          tags: projectTasks.tags,
          position: projectTasks.position,
          createdAt: projectTasks.createdAt,
          updatedAt: projectTasks.updatedAt
        })
        .from(projectTasks)
        .where(and(
          inArray(projectTasks.columnId, columns.map(c => c.id)),
          isNull(projectTasks.deletedAt)
        ))
        .orderBy(asc(projectTasks.position))
    : []

  return { project, columns, tasks }
})
