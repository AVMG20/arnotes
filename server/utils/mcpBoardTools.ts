// The kanban tools Arnotes exposes over MCP: everything the board UI can do —
// boards, columns, tasks, ordering and updates — reachable by an agent with a
// `boards:*` key. They run against the database here, scoped to the workspace of
// the API key, and mirror the HTTP endpoints the browser uses so a board changed
// by an agent is indistinguishable from one changed by hand.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { projects, projectColumns, projectTasks, taskComments, user } from '../db/schema'
import type { Project, ProjectColumn, ProjectTask } from '../db/schema'
import type { ApiKeyContext } from './api-keys'
import { projectAccessFilter } from './auth-helpers'
import { htmlToMarkdown, htmlToPlainText, markdownToHtml } from './markdown'
import { columnTasksOrdered, positionBetween, projectColumnsOrdered, renumberColumnTasks } from './projects'
import { McpToolError, newId, optionalLimit, optionalString, optionalStringArray, requireString } from './mcpToolKit'
import type { McpToolDefinition } from './mcpToolKit'

const MAX_LABELS = 10
const DEFAULT_COLUMN_NAMES = ['Backlog', 'To do', 'Verify', 'Done']

// ─── lookups ──────────────────────────────────────────────────────────────────

function workspaceFilter(context: ApiKeyContext) {
  return projectAccessFilter(context.userId, context.teamId)
}

async function accessibleBoards(context: ApiKeyContext): Promise<Project[]> {
  return db.select().from(projects).where(workspaceFilter(context))
}

/** Boards are addressable by id or by name, so an agent can use whichever it saw last. */
async function findBoard(ref: string, context: ApiKeyContext): Promise<Project> {
  const boards = await accessibleBoards(context)
  const match = boards.find(board => board.id === ref)
    ?? boards.find(board => board.name.toLowerCase() === ref.trim().toLowerCase())

  if (!match) {
    const known = boards.map(board => board.name).join(', ')
    throw new McpToolError(
      `No board "${ref}" in this workspace.`
      + (known ? ` Available boards: ${known}.` : ' The workspace has no boards yet; create one with create_board.')
    )
  }
  return match
}

/** Columns likewise: an id, or the column name as it reads on the board. */
async function findColumn(board: Project, ref: string): Promise<ProjectColumn> {
  const columns = await projectColumnsOrdered(board.id)
  const match = columns.find(column => column.id === ref)
    ?? columns.find(column => column.name.toLowerCase() === ref.trim().toLowerCase())

  if (!match) {
    throw new McpToolError(
      `Board "${board.name}" has no column "${ref}". Its columns are: ${columns.map(c => c.name).join(', ')}.`
    )
  }
  return match
}

async function findTask(id: string, context: ApiKeyContext): Promise<{ task: ProjectTask, board: Project }> {
  const [task] = await db.select().from(projectTasks).where(eq(projectTasks.id, id))
  if (!task) throw new McpToolError(`No task with id "${id}" exists.`)

  const [board] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, task.projectId), workspaceFilter(context)))
  if (!board) throw new McpToolError(`Task "${id}" is not in this workspace.`)

  return { task, board }
}

function touchBoard(boardId: string) {
  return db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, boardId))
}

// ─── shapes ───────────────────────────────────────────────────────────────────

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map(label => label.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, MAX_LABELS)
}

async function commentCounts(taskIds: string[]): Promise<Map<string, number>> {
  if (!taskIds.length) return new Map()
  const rows = await db
    .select({ taskId: taskComments.taskId })
    .from(taskComments)
    .where(inArray(taskComments.taskId, taskIds))

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.taskId, (counts.get(row.taskId) ?? 0) + 1)
  return counts
}

function boardSummary(board: Project, columns: number, tasks: number) {
  return {
    id: board.id,
    name: board.name,
    columns,
    tasks,
    createdAt: new Date(board.createdAt).toISOString(),
    updatedAt: new Date(board.updatedAt).toISOString()
  }
}

function taskSummary(task: ProjectTask, columnName: string, updates?: number) {
  return {
    id: task.id,
    column: columnName,
    title: task.title,
    labels: task.tags,
    description: task.description ? htmlToMarkdown(task.description) : '',
    ...(updates === undefined ? {} : { updates }),
    updatedAt: new Date(task.updatedAt).toISOString()
  }
}

async function taskDetail(task: ProjectTask, board: Project) {
  const columns = await projectColumnsOrdered(board.id)
  const column = columns.find(c => c.id === task.columnId)

  const updates = await db
    .select({
      body: taskComments.body,
      createdAt: taskComments.createdAt,
      authorName: user.name
    })
    .from(taskComments)
    .leftJoin(user, eq(user.id, taskComments.userId))
    .where(eq(taskComments.taskId, task.id))
    .orderBy(asc(taskComments.createdAt))

  return {
    id: task.id,
    board: { id: board.id, name: board.name },
    column: column?.name ?? task.columnId,
    title: task.title,
    labels: task.tags,
    description: task.description ? htmlToMarkdown(task.description) : '',
    createdAt: new Date(task.createdAt).toISOString(),
    updatedAt: new Date(task.updatedAt).toISOString(),
    updates: updates.map(update => ({
      author: update.authorName ?? 'Unknown',
      body: update.body,
      at: new Date(update.createdAt).toISOString()
    }))
  }
}

// ─── ordering ─────────────────────────────────────────────────────────────────

async function renumberTasks(ids: string[]) {
  for (const [index, id] of ids.entries()) {
    await db.update(projectTasks).set({ position: index * 1000 }).where(eq(projectTasks.id, id))
  }
}

async function renumberColumns(ids: string[]) {
  for (const [index, id] of ids.entries()) {
    await db.update(projectColumns).set({ position: index * 1000 }).where(eq(projectColumns.id, id))
  }
}

type Placement = 'top' | 'bottom'

function readPlacement(args: Record<string, unknown>): Placement {
  const value = optionalString(args, 'position')
  if (value === undefined) return 'bottom'
  if (value !== 'top' && value !== 'bottom') {
    throw new McpToolError('"position" must be either "top" or "bottom".')
  }
  return value
}

/**
 * Where a task lands in a column: at either end, or directly after a named task.
 * `after` wins over `position` when both are given.
 */
async function taskPosition(columnId: string, placement: Placement, afterTaskId: string | undefined, excludeTaskId?: string) {
  const siblings = (await columnTasksOrdered(columnId))
    .filter(task => task.id !== excludeTaskId)
    .map(task => ({ id: task.id, position: task.position }))

  let beforeId: string | null = null
  let afterId: string | null = null

  if (afterTaskId) {
    const index = siblings.findIndex(task => task.id === afterTaskId)
    if (index < 0) throw new McpToolError(`Task "${afterTaskId}" is not in the target column, so nothing can be placed after it.`)
    beforeId = siblings[index]!.id
    afterId = siblings[index + 1]?.id ?? null
  } else if (placement === 'top') {
    afterId = siblings[0]?.id ?? null
  } else {
    beforeId = siblings.at(-1)?.id ?? null
  }

  return positionBetween(siblings, beforeId, afterId, renumberTasks)
}

// Where a column sits on the board: at either end, or directly after another.
type ColumnSpot = { at: 'start' } | { at: 'end' } | { at: 'after', columnId: string }

async function columnPosition(boardId: string, spot: ColumnSpot, excludeColumnId?: string) {
  const siblings = (await projectColumnsOrdered(boardId))
    .filter(column => column.id !== excludeColumnId)
    .map(column => ({ id: column.id, position: column.position }))

  if (spot.at === 'start') return positionBetween(siblings, null, siblings[0]?.id ?? null, renumberColumns)
  if (spot.at === 'end') return positionBetween(siblings, siblings.at(-1)?.id ?? null, null, renumberColumns)

  const index = siblings.findIndex(column => column.id === spot.columnId)
  if (index < 0) throw new McpToolError('The column named in "after" is not on this board.')
  return positionBetween(siblings, siblings[index]!.id, siblings[index + 1]?.id ?? null, renumberColumns)
}

/** Reads the optional "after" argument into a spot on the board. */
function columnSpot(afterRef: string | undefined, resolvedId: string | undefined): ColumnSpot {
  if (afterRef === undefined) return { at: 'end' }
  // An explicit empty "after" means "nothing before it" — the far left.
  if (!afterRef.trim()) return { at: 'start' }
  return { at: 'after', columnId: resolvedId! }
}

// ─── tools ────────────────────────────────────────────────────────────────────

export const MCP_BOARD_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_boards',
    title: 'List boards',
    description: 'List the kanban boards in the workspace, most recently updated first, with how many columns and tasks each holds. Start here when you do not know which board the user means.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum boards to return (default 25, max 200).' }
      }
    },
    async handler(args, context) {
      const limit = optionalLimit(args, 'limit', 25, 200)
      const boards = (await accessibleBoards(context)).sort((a, b) => b.updatedAt - a.updatedAt)
      if (!boards.length) return { total: 0, boards: [] }

      const ids = boards.map(board => board.id)
      const columns = await db
        .select({ id: projectColumns.id, projectId: projectColumns.projectId })
        .from(projectColumns)
        .where(inArray(projectColumns.projectId, ids))
      const tasks = await db
        .select({ id: projectTasks.id, projectId: projectTasks.projectId })
        .from(projectTasks)
        .where(inArray(projectTasks.projectId, ids))

      const countBy = (rows: { projectId: string }[]) => {
        const counts = new Map<string, number>()
        for (const row of rows) counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1)
        return counts
      }
      const columnCounts = countBy(columns)
      const taskCounts = countBy(tasks)

      return {
        total: boards.length,
        boards: boards.slice(0, limit).map(board =>
          boardSummary(board, columnCounts.get(board.id) ?? 0, taskCounts.get(board.id) ?? 0)
        )
      }
    }
  },
  {
    name: 'get_board',
    title: 'Read a board',
    description: 'Read one board in full: its columns in order and every task in them, with each task\'s Markdown description, labels and update count. Call this before creating or moving tasks so board, column and task names match exactly.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' }
      },
      required: ['board']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const columns = await projectColumnsOrdered(board.id)
      const tasks = columns.length
        ? await db
            .select()
            .from(projectTasks)
            .where(inArray(projectTasks.columnId, columns.map(column => column.id)))
            .orderBy(asc(projectTasks.position))
        : []
      const counts = await commentCounts(tasks.map(task => task.id))

      return {
        id: board.id,
        name: board.name,
        updatedAt: new Date(board.updatedAt).toISOString(),
        columns: columns.map(column => ({
          id: column.id,
          name: column.name,
          tasks: tasks
            .filter(task => task.columnId === column.id)
            .map(task => taskSummary(task, column.name, counts.get(task.id) ?? 0))
        }))
      }
    }
  },
  {
    name: 'get_task',
    title: 'Read a task',
    description: 'Read one task in full: its column, Markdown description, labels and the whole thread of updates posted on it.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context)
      return taskDetail(task, board)
    }
  },
  {
    name: 'search_tasks',
    title: 'Search tasks',
    description: 'Search tasks across every board by text and labels. All words in the query must appear in the title or description. Narrow to one board or column when you know it.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for. An empty string matches every task.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Only return tasks carrying all of these labels.' },
        board: { type: 'string', description: 'Restrict the search to one board (id or name).' },
        column: { type: 'string', description: 'Restrict the search to one column name, e.g. "Done". Requires "board".' },
        limit: { type: 'number', description: 'Maximum tasks to return (default 25, max 100).' }
      },
      required: ['query']
    },
    async handler(args, context) {
      const query = optionalString(args, 'query') ?? ''
      const labels = normalizeLabels(optionalStringArray(args, 'labels') ?? [])
      const boardRef = optionalString(args, 'board')
      const columnRef = optionalString(args, 'column')
      const limit = optionalLimit(args, 'limit', 25, 100)
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

      if (columnRef && !boardRef) {
        throw new McpToolError('Pass "board" as well when filtering by "column" — column names repeat across boards.')
      }

      const boards = boardRef
        ? [await findBoard(boardRef, context)]
        : await accessibleBoards(context)
      if (!boards.length) return { total: 0, tasks: [] }

      const boardsById = new Map(boards.map(board => [board.id, board]))
      const columns = await db
        .select()
        .from(projectColumns)
        .where(inArray(projectColumns.projectId, [...boardsById.keys()]))
      const columnsById = new Map(columns.map(column => [column.id, column]))

      const targetColumn = columnRef ? await findColumn(boards[0]!, columnRef) : null

      const rows = await db
        .select()
        .from(projectTasks)
        .where(inArray(projectTasks.projectId, [...boardsById.keys()]))
        .orderBy(asc(projectTasks.position))

      const matches = rows.filter((task) => {
        if (targetColumn && task.columnId !== targetColumn.id) return false
        if (!labels.every(label => task.tags.includes(label))) return false
        if (!terms.length) return true
        const haystack = `${task.title} ${htmlToPlainText(task.description)}`.toLowerCase()
        return terms.every(term => haystack.includes(term))
      })

      return {
        total: matches.length,
        tasks: matches.slice(0, limit).map(task => ({
          ...taskSummary(task, columnsById.get(task.columnId)?.name ?? task.columnId),
          board: boardsById.get(task.projectId)?.name ?? task.projectId
        }))
      }
    }
  },
  {
    name: 'list_task_labels',
    title: 'List task labels',
    description: 'List the labels used on tasks with how many tasks carry each. Use it to match the user\'s existing labels instead of inventing near-duplicates.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Only count labels on this board (id or name). Omit for the whole workspace.' }
      }
    },
    async handler(args, context) {
      const boardRef = optionalString(args, 'board')
      const boards = boardRef ? [await findBoard(boardRef, context)] : await accessibleBoards(context)
      if (!boards.length) return { labels: [] }

      const rows = await db
        .select({ tags: projectTasks.tags })
        .from(projectTasks)
        .where(inArray(projectTasks.projectId, boards.map(board => board.id)))

      const counts = new Map<string, number>()
      for (const row of rows) {
        for (const label of row.tags) counts.set(label, (counts.get(label) ?? 0) + 1)
      }

      return {
        labels: [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([label, count]) => ({ label, count }))
      }
    }
  },
  {
    name: 'create_board',
    title: 'Create a board',
    description: 'Create a kanban board. It starts with the columns Backlog, To do, Verify and Done unless you pass your own.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Board name.' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Column names, left to right. Defaults to Backlog, To do, Verify, Done.' }
      },
      required: ['name']
    },
    async handler(args, context) {
      const name = requireString(args, 'name').trim()
      const requested = (optionalStringArray(args, 'columns') ?? [])
        .map(columnName => columnName.trim())
        .filter(Boolean)
      const columnNames = requested.length ? requested : DEFAULT_COLUMN_NAMES
      const now = Date.now()
      const id = newId()

      const [board] = await db.insert(projects).values({
        id,
        userId: context.userId,
        teamId: context.teamId,
        name,
        createdAt: now,
        updatedAt: now
      }).returning()

      await db.insert(projectColumns).values(
        columnNames.map((columnName, index) => ({
          id: newId(),
          projectId: id,
          name: columnName,
          position: index * 1000,
          createdAt: now
        }))
      )

      return { ...boardSummary(board!, columnNames.length, 0), columnNames }
    }
  },
  {
    name: 'update_board',
    title: 'Rename a board',
    description: 'Rename an existing board.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or current name.' },
        name: { type: 'string', description: 'New board name.' }
      },
      required: ['board', 'name']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const name = requireString(args, 'name').trim()

      const [updated] = await db
        .update(projects)
        .set({ name, updatedAt: Date.now() })
        .where(eq(projects.id, board.id))
        .returning()

      return { renamed: true, from: board.name, id: updated!.id, name: updated!.name }
    }
  },
  {
    name: 'delete_board',
    title: 'Delete a board',
    description: 'Permanently delete a board with every column, task and update on it. This cannot be undone — there is no trash for boards, so confirm with the user before calling it.',
    scope: 'boards:write',
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' }
      },
      required: ['board']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      await db.delete(projects).where(eq(projects.id, board.id))
      return { deleted: true, id: board.id, name: board.name }
    }
  },
  {
    name: 'create_column',
    title: 'Add a column',
    description: 'Add a column to a board. It goes on the right unless you name the column it should follow.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        name: { type: 'string', description: 'Column name.' },
        after: { type: 'string', description: 'Place the new column directly after this one (id or name).' }
      },
      required: ['board', 'name']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const name = requireString(args, 'name').trim()
      const afterRef = optionalString(args, 'after')
      const after = afterRef?.trim() ? await findColumn(board, afterRef) : undefined

      const [column] = await db.insert(projectColumns).values({
        id: newId(),
        projectId: board.id,
        name,
        position: await columnPosition(board.id, columnSpot(afterRef, after?.id)),
        createdAt: Date.now()
      }).returning()

      await touchBoard(board.id)
      const columns = await projectColumnsOrdered(board.id)
      return {
        created: true,
        board: { id: board.id, name: board.name },
        column: { id: column!.id, name: column!.name },
        columnOrder: columns.map(c => c.name)
      }
    }
  },
  {
    name: 'update_column',
    title: 'Rename or move a column',
    description: 'Rename a column, move it to another place on the board, or both. Renaming keeps every task in it.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        column: { type: 'string', description: 'Column id or current name.' },
        name: { type: 'string', description: 'New column name.' },
        after: { type: 'string', description: 'Move the column to directly after this one (id or name). Pass an empty string to move it to the far left.' }
      },
      required: ['board', 'column']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const column = await findColumn(board, requireString(args, 'column'))
      const name = optionalString(args, 'name')?.trim()
      const afterRef = optionalString(args, 'after')

      if (!name && afterRef === undefined) {
        throw new McpToolError('Pass "name" to rename the column, "after" to move it, or both.')
      }

      const patch: { name?: string, position?: number } = {}
      if (name) patch.name = name
      if (afterRef !== undefined) {
        const after = afterRef.trim() ? await findColumn(board, afterRef) : undefined
        patch.position = await columnPosition(board.id, columnSpot(afterRef, after?.id), column.id)
      }

      const [updated] = await db
        .update(projectColumns)
        .set(patch)
        .where(eq(projectColumns.id, column.id))
        .returning()

      await touchBoard(board.id)
      const columns = await projectColumnsOrdered(board.id)
      return {
        updated: true,
        board: { id: board.id, name: board.name },
        column: { id: updated!.id, name: updated!.name },
        columnOrder: columns.map(c => c.name)
      }
    }
  },
  {
    name: 'delete_column',
    title: 'Delete a column',
    description: 'Delete a column. Its tasks are not lost: they move to the column on its left, or to the one on its right when it was the first. Deleting the only column of a board takes its tasks with it.',
    scope: 'boards:write',
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        column: { type: 'string', description: 'Column id or name.' }
      },
      required: ['board', 'column']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const column = await findColumn(board, requireString(args, 'column'))

      const columns = await projectColumnsOrdered(board.id)
      const index = columns.findIndex(candidate => candidate.id === column.id)
      const target = columns[index > 0 ? index - 1 : index + 1]
      const affected = (await columnTasksOrdered(column.id)).length

      if (target) {
        await db.update(projectTasks).set({ columnId: target.id }).where(eq(projectTasks.columnId, column.id))
        // The moved tasks carry the old column's positions, which collide with
        // the ones already there; a renumber gives the merged column one order.
        await renumberColumnTasks(target.id)
      }
      await db.delete(projectColumns).where(eq(projectColumns.id, column.id))
      await touchBoard(board.id)

      return {
        deleted: true,
        board: { id: board.id, name: board.name },
        column: column.name,
        // Without a column left to hold them, the tasks go with it.
        ...(target ? { tasksMovedTo: target.name, tasksMoved: affected } : { tasksDeleted: affected })
      }
    }
  },
  {
    name: 'create_task',
    title: 'Create a task',
    description: 'Create a task in a column. The description is Markdown and labels are the board\'s task labels (priority, workstream, …). New tasks go to the bottom of the column unless told otherwise.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id or name.' },
        column: { type: 'string', description: 'Column id or name, e.g. "Backlog".' },
        title: { type: 'string', description: 'Task title. Keep it short — detail belongs in the description.' },
        description: { type: 'string', description: 'Markdown description. Supports headings, lists, "- [ ]" checklists, tables and fenced code.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels for the task, without the # prefix.' },
        position: { type: 'string', description: '"top" or "bottom" of the column. Defaults to "bottom".' },
        after: { type: 'string', description: 'Place the task directly after this task id instead.' }
      },
      required: ['board', 'column', 'title']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const column = await findColumn(board, requireString(args, 'column'))
      const title = requireString(args, 'title').trim()
      const markdown = optionalString(args, 'description') ?? ''
      const labels = normalizeLabels(optionalStringArray(args, 'labels') ?? [])
      const now = Date.now()

      const [task] = await db.insert(projectTasks).values({
        id: newId(),
        projectId: board.id,
        columnId: column.id,
        title,
        description: markdown ? markdownToHtml(markdown) : '',
        tags: labels,
        position: await taskPosition(column.id, readPlacement(args), optionalString(args, 'after')),
        createdAt: now,
        updatedAt: now
      }).returning()

      await touchBoard(board.id)
      return taskDetail(task!, board)
    }
  },
  {
    name: 'update_task',
    title: 'Update a task',
    description: 'Update a task\'s title, description or labels. Only the fields you pass change, and each replaces its value entirely — read the task first when editing part of a description. Use move_task to change its column.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' },
        title: { type: 'string', description: 'New title.' },
        description: { type: 'string', description: 'Complete replacement Markdown description.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Complete replacement label list, without the # prefix. Pass an empty array to clear them.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context)
      const title = optionalString(args, 'title')?.trim()
      const markdown = optionalString(args, 'description')
      const labels = optionalStringArray(args, 'labels')

      if (title === undefined && markdown === undefined && labels === undefined) {
        throw new McpToolError('Pass at least one of "title", "description" or "labels".')
      }

      const [updated] = await db
        .update(projectTasks)
        .set({
          ...(title ? { title } : {}),
          ...(markdown !== undefined ? { description: markdown ? markdownToHtml(markdown) : '' } : {}),
          ...(labels !== undefined ? { tags: normalizeLabels(labels) } : {}),
          updatedAt: Date.now()
        })
        .where(eq(projectTasks.id, task.id))
        .returning()

      await touchBoard(board.id)
      return taskDetail(updated!, board)
    }
  },
  {
    name: 'move_task',
    title: 'Move a task',
    description: 'Move a task to another column of its board — this is how a task is marked done — or reorder it inside the column it is already in.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' },
        column: { type: 'string', description: 'Target column id or name. Omit to reorder within the current column.' },
        position: { type: 'string', description: '"top" or "bottom" of the target column. Defaults to "bottom".' },
        after: { type: 'string', description: 'Place the task directly after this task id in the target column instead.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context)
      const columnRef = optionalString(args, 'column')
      const column = columnRef ? await findColumn(board, columnRef) : await findColumn(board, task.columnId)

      const [updated] = await db
        .update(projectTasks)
        .set({
          columnId: column.id,
          position: await taskPosition(column.id, readPlacement(args), optionalString(args, 'after'), task.id),
          updatedAt: Date.now()
        })
        .where(eq(projectTasks.id, task.id))
        .returning()

      await touchBoard(board.id)
      return { moved: true, task: await taskDetail(updated!, board) }
    }
  },
  {
    name: 'delete_task',
    title: 'Delete a task',
    description: 'Permanently delete a task and its updates. This cannot be undone — moving it to a "Done" column with move_task is usually what the user wants instead.',
    scope: 'boards:write',
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context)
      await db.delete(projectTasks).where(eq(projectTasks.id, task.id))
      await touchBoard(board.id)
      return { deleted: true, id: task.id, title: task.title, board: { id: board.id, name: board.name } }
    }
  },
  {
    name: 'add_task_update',
    title: 'Post a task update',
    description: 'Post an update on a task — the short running log the team reads for progress, blockers and decisions. Plain text, posted under the API key owner\'s name.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' },
        body: { type: 'string', description: 'The update. One or two sentences beats a wall of text.' }
      },
      required: ['id', 'body']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context)
      const body = requireString(args, 'body').trim()

      await db.insert(taskComments).values({
        id: newId(),
        taskId: task.id,
        userId: context.userId,
        body,
        createdAt: Date.now()
      })

      await touchBoard(board.id)
      return { posted: true, board: { id: board.id, name: board.name }, task: task.title, update: body }
    }
  }
]
