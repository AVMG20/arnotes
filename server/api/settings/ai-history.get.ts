import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { aiUsageRecords } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const userId = event.context.session.user.id
  const [totals] = await db
    .select({
      prompts: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageRecords.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageRecords.outputTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageRecords.totalTokens}), 0)::int`,
      cost: sql<string>`coalesce(sum(${aiUsageRecords.cost}), 0)`
    })
    .from(aiUsageRecords)
    .where(eq(aiUsageRecords.userId, userId))

  const prompts = await db
    .select({
      id: aiUsageRecords.id,
      action: aiUsageRecords.action,
      model: aiUsageRecords.model,
      inputTokens: aiUsageRecords.inputTokens,
      outputTokens: aiUsageRecords.outputTokens,
      totalTokens: aiUsageRecords.totalTokens,
      cost: aiUsageRecords.cost,
      createdAt: aiUsageRecords.createdAt
    })
    .from(aiUsageRecords)
    .where(eq(aiUsageRecords.userId, userId))
    .orderBy(desc(aiUsageRecords.createdAt))
    .limit(50)

  return {
    totals: { ...totals, cost: Number(totals?.cost ?? 0) },
    prompts: prompts.map(prompt => ({ ...prompt, cost: Number(prompt.cost) }))
  }
})
