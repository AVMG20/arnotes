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

// A task IS a note: same table, same search index, same editor. Only the
// presentation differs — the tasks view renders these rows as a checklist.
export type TaskProp = {
  id: string
  name: string
  type: 'text' | 'link' | 'note'
  value: string
}

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
    isTask: boolean('is_task').notNull().default(false),
    taskStatus: text('task_status').notNull().default('open'),
    dueAt: bigint('due_at', { mode: 'number' }),
    taskProps: json('task_props').$type<TaskProp[]>().notNull().default([]),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' })
  },
  table => [index('notes_team_id_idx').on(table.teamId)]
)

export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

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
