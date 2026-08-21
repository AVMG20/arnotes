import { pgTable, text, boolean, timestamp, bigint, integer, numeric, index, json } from 'drizzle-orm/pg-core'

// ─── Better Auth tables ───────────────────────────────────────────────────────

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('active_organization_id')
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull()
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at')
})

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: timestamp('created_at').notNull(),
  metadata: text('metadata'),
  joinCode: text('join_code').unique()
})

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamp('created_at').notNull()
  },
  // Every authenticated note request resolves membership for the active team.
  table => [index('member_org_user_idx').on(table.organizationId, table.userId)]
)

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull(),
  inviterId: text('inviter_id').notNull().references(() => user.id, { onDelete: 'cascade' })
})

// ─── App tables ───────────────────────────────────────────────────────────────

export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // NULL means the note lives in the author's personal workspace. Existing notes
    // predating teams keep NULL, so they stay exactly where they were.
    teamId: text('team_id').references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Untitled'),
    content: text('content').notNull().default(''),
    tags: json('tags').$type<string[]>().notNull().default([]),
    attachments: json('attachments').$type<string[]>().notNull().default([]),
    isPublic: boolean('is_public').notNull().default(false),
    publicUntil: bigint('public_until', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' })
  },
  table => [index('notes_team_id_idx').on(table.teamId)]
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

// ─── Projects (kanban) ────────────────────────────────────────────────────────

// Where a delete came from. Recorded on the row so the board's trash can tell
// the user's own tidying apart from an agent's, and so a runaway MCP key's work
// can be picked out and restored in one go.
export const DELETION_SOURCES = ['ui', 'mcp', 'ai'] as const
export type DeletionSource = typeof DELETION_SOURCES[number]

// How long a trashed column or task is kept before the purge job removes it.
export const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // NULL = personal workspace, same scoping rule as notes.
    teamId: text('team_id').references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Untitled project'),
    // Colours the user has pinned to this board's task labels, keyed by label.
    // A label with no entry keeps the colour derived from its own text, so a
    // board reads the same as it always did until someone changes one.
    labelColors: json('label_colors').$type<Record<string, string>>().notNull().default({}),
    // Same share model as notes: a link anyone can open, optionally until a date.
    isPublic: boolean('is_public').notNull().default(false),
    publicUntil: bigint('public_until', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
  },
  table => [index('projects_team_id_idx').on(table.teamId)]
)

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

export const projectColumns = pgTable(
  'project_columns',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    // A colour the user picked, from the same palette as the accent in Settings.
    // NULL means the column has not been given one and its dot is still derived
    // from its name, so renaming "To do" to "Done" still turns it green.
    color: text('color'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    // Soft delete, same shape as notes. A trashed column keeps its position so
    // restoring puts it back between the same two neighbours it sat between.
    deletedAt: bigint('deleted_at', { mode: 'number' }),
    // Who emptied it and through which door. An agent working overnight is the
    // case this exists for: the board can say "deleted by an MCP key" rather
    // than leaving the user to guess where their column went.
    deletedBy: text('deleted_by').references(() => user.id, { onDelete: 'set null' }),
    deletedVia: text('deleted_via').$type<DeletionSource>()
  },
  table => [index('project_columns_project_id_idx').on(table.projectId)]
)

export type ProjectColumn = typeof projectColumns.$inferSelect

export const projectTasks = pgTable(
  'project_tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    columnId: text('column_id').notNull().references(() => projectColumns.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Untitled'),
    // Rich text (tiptap HTML) — rendered with prose in cards and drawer.
    description: text('description').notNull().default(''),
    // Kanban labels: unlike note tags they do not group boards, they annotate
    // tasks (priority, workstream, …) and filter the board view.
    tags: json('tags').$type<string[]>().notNull().default([]),
    position: integer('position').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    // Deleting a column hands its tasks to a neighbour rather than taking them
    // down with it. This remembers where they came from, so restoring the
    // column can bring them home; any later move clears it, because a task the
    // user has since filed somewhere deliberately should stay where they put it.
    previousColumnId: text('previous_column_id'),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
    deletedBy: text('deleted_by').references(() => user.id, { onDelete: 'set null' }),
    deletedVia: text('deleted_via').$type<DeletionSource>()
  },
  table => [
    index('project_tasks_project_id_idx').on(table.projectId),
    index('project_tasks_column_id_idx').on(table.columnId),
    // The trash view and the purge job both ask for "what is deleted here".
    index('project_tasks_deleted_at_idx').on(table.deletedAt)
  ]
)

export type ProjectTask = typeof projectTasks.$inferSelect

export const taskComments = pgTable(
  'task_comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => projectTasks.id, { onDelete: 'cascade' }),
    // The account the update belongs to. An agent posts under the key owner's
    // account because that is whose workspace it is, but it does not get to
    // wear their name — see `createdVia` below.
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // Inline Markdown, stored as written. A person types it in the drawer and an
    // agent posts it over MCP; both speak the same narrow subset.
    body: text('body').notNull(),
    // Which door the update came through, the same three as a deletion. An
    // update posted by an agent is signed with the key's name rather than the
    // owner's, so a log the user reads back says who was really working.
    createdVia: text('created_via').$type<DeletionSource>().notNull().default('ui'),
    apiKeyId: text('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  table => [index('task_comments_task_id_idx').on(table.taskId)]
)

export type TaskComment = typeof taskComments.$inferSelect

// ─── User settings ────────────────────────────────────────────────────────────

export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  primaryColor: text('primary_color').notNull().default('emerald'),
  neutralColor: text('neutral_color').notNull().default('zinc'),
  openrouterApiKey: text('openrouter_api_key'),
  openrouterModel: text('openrouter_model').notNull().default('openai/gpt-4o-mini'),
  updatedAt: timestamp('updated_at').notNull()
})

export type UserSettings = typeof userSettings.$inferSelect

// Stores usage metadata only. Prompt and response text are intentionally never persisted.
export const aiUsageRecords = pgTable(
  'ai_usage_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cost: numeric('cost', { precision: 14, scale: 8 }).notNull().default('0'),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  table => [index('ai_usage_records_user_created_at_idx').on(table.userId, table.createdAt)]
)

export type AiUsageRecord = typeof aiUsageRecords.$inferSelect

export const AI_SETTINGS_DEFAULTS = {
  openrouterModel: 'openai/gpt-4o-mini'
} as const

export const POPULAR_OPENROUTER_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'openai/gpt-4.1-mini',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-flash-1.5',
  'google/gemini-pro-1.5',
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-large',
  'deepseek/deepseek-chat'
] as const

// ─── API keys (MCP + programmatic access) ─────────────────────────────────────

// Permissions a key can carry, one pair per feature. Read covers listing,
// searching and reading; write covers everything that changes data. Notes and
// boards are separate so a key can be given one without the other.
export const API_KEY_SCOPES = ['notes:read', 'notes:write', 'boards:read', 'boards:write'] as const
export type ApiKeyScope = typeof API_KEY_SCOPES[number]

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    // The workspace this key can reach. NULL means the owner's personal workspace;
    // otherwise the key is pinned to one team and never follows the owner around.
    teamId: text('team_id').references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Only the SHA-256 digest is stored — the key itself is shown once, at creation.
    keyHash: text('key_hash').notNull().unique(),
    // Leading characters of the key, kept so the UI can identify it after the fact.
    keyPrefix: text('key_prefix').notNull(),
    scopes: json('scopes').$type<ApiKeyScope[]>().notNull().default([]),
    lastUsedAt: bigint('last_used_at', { mode: 'number' }),
    expiresAt: bigint('expires_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  table => [index('api_keys_user_idx').on(table.userId)]
)

export type ApiKey = typeof apiKeys.$inferSelect
