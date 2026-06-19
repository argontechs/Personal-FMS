// server/api/transactions/[id].patch.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { transactions } from '../../db/schema'
import { recomputeBalances } from '../../utils/post'
import { eq } from 'drizzle-orm'

const VALID_CATEGORIES = ['food', 'transport', 'fuel', 'groceries', 'shopping', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'] as const

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const body = await readBody(event)
  const patch: Record<string, unknown> = {}

  if (typeof body.amount_cents === 'number') {
    if (!Number.isInteger(body.amount_cents)) {
      throw createError({ statusCode: 400, statusMessage: 'amount_cents must be an integer' })
    }
    patch.amount_cents = body.amount_cents
  }
  if (typeof body.category === 'string') {
    if (!VALID_CATEGORIES.includes(body.category as any)) {
      throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
    }
    patch.category = body.category
  }
  if (typeof body.note === 'string' || body.note === null) {
    patch.note = body.note
  }
  if (typeof body.date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      throw createError({ statusCode: 400, statusMessage: 'date must be YYYY-MM-DD' })
    }
    patch.date = body.date
  }

  if (Object.keys(patch).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'nothing to patch' })
  }

  const existing = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'transaction not found' })
  }

  db.update(transactions).set(patch).where(eq(transactions.id, id)).run()
  // Rebuild all account/debt balances from ledger — the ONLY way to keep balances correct after
  // an amount/date change without reimplementing the full double-entry math here.
  recomputeBalances()

  return db.select().from(transactions).where(eq(transactions.id, id)).get()
})
