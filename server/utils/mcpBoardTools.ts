// The kanban tools Arnotes exposes over MCP: everything the board UI can do —
// boards, columns, tasks, ordering and updates — reachable by an agent with a
// `boards:*` key. They run against the database here, scoped to the workspace of
// the API key, and mirror the HTTP endpoints the browser uses so a board changed
// by an agent is indistinguishable from one changed by hand.
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../db'
import { projects, projectColumns, projectTasks, taskComments, user } from '../db/schema'
import type { Project, ProjectColumn, ProjectTask } from '../db/schema'
import type { ApiKeyContext } from './api-keys'
import { projectAccessFilter } from './auth-helpers'
import { htmlToMarkdown, htmlToPlainText, markdownToHtml } from './markdown'
import { columnTasksOrdered, positionBetween, projectColumnsOrdered, renumberColumnTasks, RESTORED } from './projects'
import { McpToolError, excerpt, idFromReference, newId, optionalLimit, optionalString, optionalStringArray, requireString } from './mcpToolKit'
import type { McpToolDefinition } from './mcpToolKit'

const MAX_LABELS = 10
const DEFAULT_COLUMN_NAMES = ['Backlog', 'To do', 'Verify', 'Done']

// The kanban card shows one line of the description; board-shaped results carry
// the same 160 characters so what an agent reads matches what the user sees.
const SUMMARY_LENGTH = 160

// A board is read column by column. The cap is per column rather than per board
// so a long Backlog cannot crowd out the Done column an agent came to look at.
const DEFAULT_COLUMN_TASKS = 50
const MAX_COLUMN_TASKS = 200

// Nothing an agent can reach removes a board, a column or a task for good. A
// delete over MCP puts the row in the board's trash, where the user can see it
// under "Show trashed" and put it back — and where it is removed on its own
// after a week. Permanent deletion stays in the app, in front of a human.
function agentDeletion(context: ApiKeyContext) {
  return {
    deletedAt: Date.now(),
    deletedBy: context.userId,
    deletedVia: 'mcp' as const
  }
}

// ─── lookups ──────────────────────────────────────────────────────────────────

function workspaceFilter(context: ApiKeyContext) {
  return projectAccessFilter(context.userId, context.teamId)
}

async function accessibleBoards(context: ApiKeyContext): Promise<Project[]> {
  return db.select().from(projects).where(workspaceFilter(context))
}

/**
 * Boards are addressable by id, by name, or by a link copied out of the app, so
 * an agent can use whichever the user handed it.
 */
async function findBoard(reference: string, context: ApiKeyContext): Promise<Project> {
  const ref = idFromReference(reference)
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

async function findTask(
  reference: string,
  context: ApiKeyContext,
  options: { includeDeleted?: boolean } = {}
): Promise<{ task: ProjectTask, board: Project }> {
  // A board link with a task open names that task, which is what a user copying
  // out of the address bar will have in hand.
  const id = idFromReference(reference, 'task')
  const [task] = await db
    .select()
    .from(projectTasks)
    .where(and(
      eq(projectTasks.id, id),
      options.includeDeleted ? undefined : isNull(projectTasks.deletedAt)
    ))
  if (!task) {
    throw new McpToolError(
      options.includeDeleted
        ? `No task with id "${id}" exists.`
        : `No task with id "${id}" exists, or it is in the board's trash — restore_task brings it back.`
    )
  }

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
    .select({ taskId: taskComments.taskId, total: count() })
    .from(taskComments)
    .where(inArray(taskComments.taskId, taskIds))
    .groupBy(taskComments.taskId)

  return new Map(rows.map(row => [row.taskId, Number(row.total)]))
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

/**
 * How much of a task a list-shaped result carries. Reading a board used to hand
 * back every description in full, which on a real board is most of the payload
 * and almost none of what the caller asked for.
 *
 * - `titles`: the card without its text — the cheapest way to see the shape of a board
 * - `summary`: the card as it renders, with the opening of the description (default)
 * - `full`: every description in Markdown, for the rare sweep that really needs them
 */
export type TaskDetail = 'titles' | 'summary' | 'full'

function readDetail(args: Record<string, unknown>): TaskDetail {
  const value = optionalString(args, 'detail')
  if (value === undefined) return 'summary'
  if (value !== 'titles' && value !== 'summary' && value !== 'full') {
    throw new McpToolError('"detail" must be one of "titles", "summary" or "full".')
  }
  return value
}

/**
 * A task as the board draws it: title, labels and a line of the description.
 * The whole description and the thread of updates live behind get_task, so a
 * board of 200 tasks reads as a board and not as 200 documents.
 *
 * `column` and `board` are named only where the nesting does not already say so
 * — search results carry them, a board's own columns do not.
 */
function taskCard(task: ProjectTask, options: {
  detail?: TaskDetail
  updates?: number
  terms?: string[]
  column?: string
  board?: string
} = {}) {
  const detail = options.detail ?? 'summary'
  const terms = options.terms ?? []

  return {
    id: task.id,
    ...(options.board ? { board: options.board } : {}),
    ...(options.column ? { column: options.column } : {}),
    title: task.title,
    labels: task.tags,
    ...(detail === 'titles'
      ? {}
      : detail === 'full'
        ? { description: task.description ? htmlToMarkdown(task.description) : '' }
        // An excerpt centred on the query when there is one, otherwise the
        // opening of the text. A trailing ellipsis is the signal that get_task
        // has more to give.
        : { summary: excerpt(htmlToPlainText(task.description), terms, SUMMARY_LENGTH, terms.length ? 60 : 0) }),
    // A task nobody has posted on says so by leaving the field out.
    ...(options.updates ? { updates: options.updates } : {}),
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

      // Only the boards that are actually returned need counting.
      const ids = boards.slice(0, limit).map(board => board.id)
      const [columns, tasks] = await Promise.all([
        db
          .select({ projectId: projectColumns.projectId, total: count() })
          .from(projectColumns)
          .where(and(inArray(projectColumns.projectId, ids), isNull(projectColumns.deletedAt)))
          .groupBy(projectColumns.projectId),
        db
          .select({ projectId: projectTasks.projectId, total: count() })
          .from(projectTasks)
          .where(and(inArray(projectTasks.projectId, ids), isNull(projectTasks.deletedAt)))
          .groupBy(projectTasks.projectId)
      ])

      const countBy = (rows: { projectId: string, total: number }[]) =>
        new Map(rows.map(row => [row.projectId, Number(row.total)]))
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
    description: 'Read a board the way it is drawn: its columns in order, and in each the tasks with their title, labels and the opening line of the description. Call this before creating or moving tasks so board, column and task names match exactly, then get_task for the full description and updates of the one you care about. Narrow a big board with "columns", and pass detail:"titles" for the cheapest overview.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        board: { type: 'string', description: 'Board id, board name, or a link to the board copied from the app.' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Only read these columns (ids or names, e.g. ["To do", "Verify"]). Omit for the whole board.' },
        detail: { type: 'string', description: '"titles" for titles and labels only, "summary" (default) to add the opening of each description, "full" for every description in Markdown — expensive on a large board.' },
        limit: { type: 'number', description: `Maximum tasks per column (default ${DEFAULT_COLUMN_TASKS}, max ${MAX_COLUMN_TASKS}). Anything past it is reported as "omitted" on the column.` }
      },
      required: ['board']
    },
    async handler(args, context) {
      const board = await findBoard(requireString(args, 'board'), context)
      const detail = readDetail(args)
      const perColumn = optionalLimit(args, 'limit', DEFAULT_COLUMN_TASKS, MAX_COLUMN_TASKS)
      const requested = optionalStringArray(args, 'columns')
        ?.map(ref => ref.trim().toLowerCase())
        .filter(Boolean)

      const allColumns = await projectColumnsOrdered(board.id)
      const columns = requested?.length
        ? allColumns.filter(column => requested.includes(column.id.toLowerCase()) || requested.includes(column.name.toLowerCase()))
        : allColumns

      if (requested?.length && !columns.length) {
        throw new McpToolError(
          `Board "${board.name}" has none of those columns. Its columns are: ${allColumns.map(column => column.name).join(', ')}.`
        )
      }

      const tasks = columns.length
        ? await db
            .select()
            .from(projectTasks)
            .where(and(
              inArray(projectTasks.columnId, columns.map(column => column.id)),
              isNull(projectTasks.deletedAt)
            ))
            .orderBy(asc(projectTasks.position))
        : []

      // The board's real size, which `tasks` does not carry when the read was
      // narrowed to a few columns.
      const [total] = await db
        .select({ tasks: count() })
        .from(projectTasks)
        .where(and(eq(projectTasks.projectId, board.id), isNull(projectTasks.deletedAt)))

      // Clip each column before counting updates: the counts are only needed for
      // the tasks that make it into the answer.
      const grouped = columns.map((column) => {
        const all = tasks.filter(task => task.columnId === column.id)
        return { column, total: all.length, shown: all.slice(0, perColumn) }
      })
      const counts = await commentCounts(grouped.flatMap(group => group.shown.map(task => task.id)))

      return {
        id: board.id,
        name: board.name,
        updatedAt: new Date(board.updatedAt).toISOString(),
        taskCount: Number(total?.tasks ?? 0),
        // Say which columns were left out, so a narrowed read does not look like
        // the whole board to whoever reads the result.
        ...(columns.length < allColumns.length
          ? { otherColumns: allColumns.filter(column => !columns.includes(column)).map(column => column.name) }
          : {}),
        columns: grouped.map(({ column, total, shown }) => ({
          id: column.id,
          name: column.name,
          taskCount: total,
          ...(total > shown.length ? { omitted: total - shown.length } : {}),
          tasks: shown.map(task => taskCard(task, { detail, updates: counts.get(task.id) }))
        }))
      }
    }
  },
  {
    name: 'get_task',
    title: 'Read a task',
    description: 'Read one task in full: its column, Markdown description, labels and the whole thread of updates posted on it. This is where the complete description lives — get_board and search_tasks only carry the opening of it.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id, or a link to the task copied from the app.' }
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
    description: 'Search tasks across every board by text and labels. All words in the query must appear in the title or description. Results carry an excerpt around the match — follow up with get_task to read one in full. Narrow to one board or column when you know it.',
    scope: 'boards:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for. An empty string matches every task.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Only return tasks carrying all of these labels.' },
        board: { type: 'string', description: 'Restrict the search to one board (id or name).' },
        column: { type: 'string', description: 'Restrict the search to one column name, e.g. "Done". Requires "board".' },
        detail: { type: 'string', description: '"titles", "summary" (default, an excerpt around the match) or "full" for whole descriptions.' },
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
      const detail = readDetail(args)
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
        .where(and(
          inArray(projectColumns.projectId, [...boardsById.keys()]),
          isNull(projectColumns.deletedAt)
        ))
      const columnsById = new Map(columns.map(column => [column.id, column]))

      const targetColumn = columnRef ? await findColumn(boards[0]!, columnRef) : null

      const rows = await db
        .select()
        .from(projectTasks)
        .where(and(
          inArray(projectTasks.projectId, [...boardsById.keys()]),
          isNull(projectTasks.deletedAt)
        ))
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
        tasks: matches.slice(0, limit).map(task => taskCard(task, {
          detail,
          terms,
          board: boardsById.get(task.projectId)?.name ?? task.projectId,
          column: columnsById.get(task.columnId)?.name ?? task.columnId
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
        .where(and(
          inArray(projectTasks.projectId, boards.map(board => board.id)),
          isNull(projectTasks.deletedAt)
        ))

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
  // There is deliberately no delete_board tool. A board is the one thing here
  // whose loss an agent cannot undo — its columns, tasks and updates go with it
  // — and no agent workflow needs to destroy one. Deleting a board stays in the
  // app, behind a confirmation, in front of the person who owns it.
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
    title: 'Trash a column',
    description: 'Move a column to the board\'s trash. Its tasks are not lost: they move to the column on its left, or to the one on its right when it was the first; the only column of a board takes its tasks into the trash with it. Reversible with restore_column, and the user can restore it from the board.',
    scope: 'boards:write',
    readOnly: false,
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
      const stamp = agentDeletion(context)

      if (target) {
        // Where they came from is recorded, so restore_column brings them home
        // rather than handing back an empty column.
        await db.update(projectTasks)
          .set({ columnId: target.id, previousColumnId: column.id })
          .where(and(eq(projectTasks.columnId, column.id), isNull(projectTasks.deletedAt)))
        // The moved tasks carry the old column's positions, which collide with
        // the ones already there; a renumber gives the merged column one order.
        await renumberColumnTasks(target.id)
      } else {
        // No neighbour to hand them to, so they go to the trash alongside the
        // column, carrying its exact timestamp — that is how restore_column
        // later tells them from cards trashed on their own.
        await db.update(projectTasks)
          .set(stamp)
          .where(and(eq(projectTasks.columnId, column.id), isNull(projectTasks.deletedAt)))
      }

      await db.update(projectColumns).set(stamp).where(eq(projectColumns.id, column.id))
      await touchBoard(board.id)

      return {
        trashed: true,
        board: { id: board.id, name: board.name },
        column: { id: column.id, name: column.name },
        restoreWith: 'restore_column',
        ...(target
          ? { tasksMovedTo: target.name, tasksMoved: affected }
          : { tasksTrashed: affected })
      }
    }
  },
  {
    name: 'restore_column',
    title: 'Restore a column',
    description: 'Bring a column back out of the board\'s trash, along with the tasks that went with it. Use this to undo a delete_column — yours or anyone else\'s — while it is still in the trash.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The column id, as returned by delete_column.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const id = requireString(args, 'id')
      const [column] = await db.select().from(projectColumns).where(eq(projectColumns.id, id))
      if (!column) throw new McpToolError(`No column with id "${id}" exists. It may have been removed for good.`)

      const board = await findBoard(column.projectId, context)
      if (!column.deletedAt) return { id, alreadyActive: true, column: column.name }

      const withColumn = await db
        .update(projectTasks)
        .set(RESTORED)
        .where(and(eq(projectTasks.columnId, id), eq(projectTasks.deletedAt, column.deletedAt)))
        .returning({ id: projectTasks.id })

      // Tasks handed to a neighbour on the way out, unless they have since been
      // filed somewhere on purpose — moving a task clears the marker.
      const relocated = await db
        .update(projectTasks)
        .set({ columnId: id, previousColumnId: null })
        .where(and(eq(projectTasks.previousColumnId, id), isNull(projectTasks.deletedAt)))
        .returning({ id: projectTasks.id })

      await db.update(projectColumns).set(RESTORED).where(eq(projectColumns.id, id))
      await renumberColumnTasks(id)
      await touchBoard(board.id)

      return {
        restored: true,
        board: { id: board.id, name: board.name },
        column: { id: column.id, name: column.name },
        tasksRestored: withColumn.length + relocated.length
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
      // The caller wrote the description; echoing it back with an empty update
      // thread teaches it nothing. The ids and the card are the useful receipt.
      return { created: true, board: { id: board.id, name: board.name }, task: taskCard(task!, { column: column.name }) }
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

      const column = await findColumn(board, task.columnId)
      await touchBoard(board.id)
      return { updated: true, board: { id: board.id, name: board.name }, task: taskCard(updated!, { column: column.name }) }
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
      const from = await findColumn(board, task.columnId)
      const column = columnRef ? await findColumn(board, columnRef) : from

      const [updated] = await db
        .update(projectTasks)
        .set({
          columnId: column.id,
          // Filing a card somewhere deliberately overrides where it came from,
          // so restoring its old column later leaves this one where it is.
          previousColumnId: null,
          position: await taskPosition(column.id, readPlacement(args), optionalString(args, 'after'), task.id),
          updatedAt: Date.now()
        })
        .where(eq(projectTasks.id, task.id))
        .returning()

      await touchBoard(board.id)
      // `board` sits at the top level because the MCP endpoint reads it to tell
      // the open browsers which board changed — without it a move only raises
      // the coarse signal, and the readers of a shared board see nothing at all.
      return {
        moved: true,
        board: { id: board.id, name: board.name },
        from: from.name,
        to: column.name,
        task: taskCard(updated!, { column: column.name })
      }
    }
  },
  {
    name: 'delete_task',
    title: 'Trash a task',
    description: 'Move a task to the board\'s trash, where restore_task or the user can bring it back. Nothing is permanently deleted, but the trash is emptied after 7 days — and moving a finished task to a "Done" column with move_task is usually what the user actually wants.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context)
      await db.update(projectTasks).set(agentDeletion(context)).where(eq(projectTasks.id, task.id))
      await touchBoard(board.id)
      return {
        trashed: true,
        id: task.id,
        title: task.title,
        board: { id: board.id, name: board.name },
        restoreWith: 'restore_task'
      }
    }
  },
  {
    name: 'restore_task',
    title: 'Restore a task',
    description: 'Bring a task back out of the board\'s trash, into the column it was in. Use this to undo a delete_task while it is still in the trash.',
    scope: 'boards:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' }
      },
      required: ['id']
    },
    async handler(args, context) {
      const { task, board } = await findTask(requireString(args, 'id'), context, { includeDeleted: true })
      if (!task.deletedAt) return { id: task.id, alreadyActive: true, title: task.title }

      const [column] = await db.select().from(projectColumns).where(eq(projectColumns.id, task.columnId))
      let columnId = task.columnId

      if (column?.deletedAt) {
        // Its column is in the trash too; the card needs it back to be drawn at
        // all. The column's other trashed cards stay where they are.
        await db.update(projectColumns).set(RESTORED).where(eq(projectColumns.id, column.id))
      } else if (!column) {
        const [first] = await projectColumnsOrdered(board.id)
        if (!first) throw new McpToolError(`Board "${board.name}" has no column to restore this task into.`)
        columnId = first.id
      }

      await db
        .update(projectTasks)
        .set({ ...RESTORED, columnId, updatedAt: Date.now() })
        .where(eq(projectTasks.id, task.id))
      await renumberColumnTasks(columnId)
      await touchBoard(board.id)

      const [restored] = await db.select().from(projectColumns).where(eq(projectColumns.id, columnId))
      return {
        restored: true,
        id: task.id,
        title: task.title,
        board: { id: board.id, name: board.name },
        column: restored?.name ?? columnId
      }
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
