import { db } from '../db'
import { projects, projectTasks } from '../db/schema'
import { and, eq, asc, desc, inArray, isNull } from 'drizzle-orm'
import { getProjectAccessFilter } from '../utils/projects'

// Flat task list across every accessible project — powers global search and
// deep links into boards without loading each board first.
export default defineEventHandler(async (event) => {
  const filter = await getProjectAccessFilter(event)
  const visibleProjects = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(filter)

  if (!visibleProjects.length) return []

  return db
    .select({
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      projectName: projects.name,
      columnId: projectTasks.columnId,
      title: projectTasks.title,
      description: projectTasks.description,
      tags: projectTasks.tags,
      updatedAt: projectTasks.updatedAt
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(and(
      inArray(projectTasks.projectId, visibleProjects.map(p => p.id)),
      // Trashed cards stay out of global search and out of the deep links it
      // hands back, so a hit never opens a board on a card that is not drawn.
      isNull(projectTasks.deletedAt)
    ))
    .orderBy(desc(projectTasks.updatedAt), asc(projectTasks.id))
})
