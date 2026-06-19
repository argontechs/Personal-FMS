// server/api/accounts/correct-cash.post.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { accounts } from '../../db/schema'
import { postTransaction } from '../../utils/post'
import { withinAmountCeiling } from '../../utils/money'
import { todayMYT } from '../../utils/mytDate'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const b = await readBody(event)

  if (typeof b?.account_id !== 'number' || typeof b.target_cents !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'account_id and target_cents required' })
  }

  if (!Number.isInteger(b.target_cents)) {
    throw createError({ statusCode: 400, statusMessage: 'target_cents must be an integer' })
  }
  if (!withinAmountCeiling(b.target_cents)) {
    throw createError({ statusCode: 400, statusMessage: 'target_cents exceeds maximum' })
  }

  const acc = db.select().from(accounts).where(eq(accounts.id, b.account_id)).get()
  if (!acc) {
    throw createError({ statusCode: 404, statusMessage: 'account not found' })
  }

  if (acc.type === 'card') {
    throw createError({ statusCode: 400, statusMessage: 'correct-cash is not supported for card accounts' })
  }

  const delta = b.target_cents - acc.balance_cents
  if (delta === 0) {
    return { id: null, adjustment_cents: 0 }
  }

  const { id } = postTransaction({
    uuid: `adjust-${b.account_id}-${Date.now()}`,
    date: todayMYT(),
    amount_cents: delta,
    direction: delta > 0 ? 'income' : 'expense',
    category: 'adjustment',
    account_id: b.account_id,
    note: `Cash correction to ${b.target_cents}`,
    source: 'adjustment',
  })

  return { id, adjustment_cents: delta }
})
