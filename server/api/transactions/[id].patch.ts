// server/api/transactions/[id].patch.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { transactions } from '../../db/schema'
import { recomputeBalances } from '../../utils/post'
import { withinAmountCeiling } from '../../utils/money'
import { isEditableTxn } from '../../../shared/txnEditable'
import { eq } from 'drizzle-orm'

const VALID_CATEGORIES = ['food', 'transport', 'car', 'fuel', 'groceries', 'shopping', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'] as const
// transfer rows exist in the ledger but are not editable through this sheet; direction must be a
// known enum value. We accept income/expense/transfer to preserve whatever the row already was.
const VALID_DIRECTIONS = ['income', 'expense', 'transfer'] as const

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
    if (!withinAmountCeiling(body.amount_cents)) {
      throw createError({ statusCode: 400, statusMessage: 'amount_cents exceeds maximum' })
    }
    patch.amount_cents = body.amount_cents
  }
  if (typeof body.direction === 'string') {
    if (!VALID_DIRECTIONS.includes(body.direction as any)) {
      throw createError({ statusCode: 400, statusMessage: `direction must be one of: ${VALID_DIRECTIONS.join(', ')}` })
    }
    patch.direction = body.direction
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

  const existing = db.select({
    id: transactions.id,
    amount_cents: transactions.amount_cents,
    direction: transactions.direction,
    category: transactions.category,
    debt_id: transactions.debt_id,
    source: transactions.source,
  }).from(transactions).where(eq(transactions.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'transaction not found' })
  }

  // Defense in depth: never edit a system/auto ledger row (card interest, debt payments,
  // savings legs, transfers, adjustments). Their sign + debt_id wiring carry ledger meaning;
  // re-saving them through the income/expense sheet would corrupt recomputeBalances.
  if (!isEditableTxn(existing)) {
    throw createError({ statusCode: 403, statusMessage: 'this transaction is system-managed and cannot be edited' })
  }

  // Canonical sign invariant: income amount_cents must be >= 0, expense must be <= 0.
  // Resolve the EFFECTIVE (post-patch) direction + amount and enforce they agree, so a partial
  // PATCH (e.g. amount only, or direction only) can never persist a sign that contradicts the
  // direction and corrupt single-ledger balances.
  const effDirection = (patch.direction ?? existing.direction) as string
  const effAmount = (patch.amount_cents ?? existing.amount_cents) as number
  if (effDirection === 'income' && effAmount < 0) {
    throw createError({ statusCode: 400, statusMessage: 'income amount_cents must be non-negative' })
  }
  if (effDirection === 'expense' && effAmount > 0) {
    throw createError({ statusCode: 400, statusMessage: 'expense amount_cents must be non-positive' })
  }

  db.update(transactions).set(patch).where(eq(transactions.id, id)).run()
  // Rebuild all account/debt balances from ledger — the ONLY way to keep balances correct after
  // an amount/date change without reimplementing the full double-entry math here.
  recomputeBalances()

  return db.select().from(transactions).where(eq(transactions.id, id)).get()
})
