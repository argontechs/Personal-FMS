// server/api/accounts/correct-cash.post.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { accounts } from '../../db/schema'
import { postTransaction } from '../../utils/post'
import { todayMYT } from '../../utils/mytDate'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const b = await readBody(event)

  if (!b?.account_id || typeof b.target_cents !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'account_id and target_cents required' })
  }

  const acc = db.select().from(accounts).where(eq(accounts.id, b.account_id)).get()
  if (!acc) {
    throw createError({ statusCode: 404, statusMessage: 'account not found' })
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
