// server/api/transactions/index.post.ts
import { requireSession } from '../../utils/requireSession'
import { postTransaction } from '../../utils/post'
import { db } from '../../db/index'
import { transactions } from '../../db/schema'
import { eq } from 'drizzle-orm'

const VALID_CATEGORIES = ['food', 'transport', 'fuel', 'groceries', 'shopping', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'] as const
const VALID_DIRECTIONS = ['income', 'expense', 'transfer'] as const
const VALID_SOURCES = ['auto', 'manual', 'adjustment'] as const

export default defineEventHandler(async (event) => {
  requireSession(event)
  const body = await readBody(event)

  if (!body?.uuid || typeof body.uuid !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'uuid required' })
  }
  if (!body?.date || typeof body.date !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'date required' })
  }
  if (typeof body.amount_cents !== 'number' || !Number.isInteger(body.amount_cents)) {
    throw createError({ statusCode: 400, statusMessage: 'amount_cents must be an integer' })
  }
  if (!body?.account_id || typeof body.account_id !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'account_id required' })
  }

  const category = body.category ?? 'other'
  if (!VALID_CATEGORIES.includes(category)) {
    throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
  }

  const direction = body.direction ?? (body.amount_cents >= 0 ? 'income' : 'expense')
  if (!VALID_DIRECTIONS.includes(direction)) {
    throw createError({ statusCode: 400, statusMessage: `direction must be one of: ${VALID_DIRECTIONS.join(', ')}` })
  }

  const source = body.source ?? 'manual'
  if (!VALID_SOURCES.includes(source)) {
    throw createError({ statusCode: 400, statusMessage: `source must be one of: ${VALID_SOURCES.join(', ')}` })
  }

  // Idempotent upsert: if the uuid already exists, return its id (offline double-flush safe).
  // postTransaction throws on duplicate uuid — so we pre-check and short-circuit.
  const existing = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.uuid, body.uuid)).get()
  if (existing) return { id: existing.id }

  return postTransaction({
    uuid: body.uuid,
    date: body.date,
    amount_cents: body.amount_cents,
    direction,
    category,
    account_id: body.account_id,
    counter_account_id: body.counter_account_id ?? null,
    debt_id: body.debt_id ?? null,
    goal_id: body.goal_id ?? null,
    note: body.note ?? null,
    source,
    recurring_item_id: body.recurring_item_id ?? null,
    is_estimate: body.is_estimate ?? false,
  })
})
