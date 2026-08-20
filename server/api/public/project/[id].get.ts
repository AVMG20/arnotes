import { db } from '../../../db'
import { projectColumns, projectTasks } from '../../../db/schema'
import { asc, eq, inArray } from 'drizzle-orm'
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
      position: projectColumns.position
    })
    .from(projectColumns)
    .where(eq(projectColumns.projectId, id))
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
        .where(inArray(projectTasks.columnId, columns.map(c => c.id)))
        .orderBy(asc(projectTasks.position))
    : []

  return { project, columns, tasks }
})
