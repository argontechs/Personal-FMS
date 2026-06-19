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

  // Card balances are mirrored from the linked DEBT — reconciling a card means setting
  // its real STATEMENT balance, which must adjust the debt leg (see /api/debts/card/reconcile),
  // not the account leg. A positive account adjustment here would be wrong (cards store debt
  // as a NEGATIVE balance). So this spendable-account path stays blocked for cards.
  if (acc.type === 'card') {
    throw createError({ statusCode: 400, statusMessage: 'correct-cash is not supported for card accounts (use /api/debts/card/reconcile)' })
  }

  // Spendable real balance must be non-negative (you cannot hold negative cash/bank/ewallet/savings).
  if (b.target_cents < 0) {
    throw createError({ statusCode: 400, statusMessage: 'target_cents must be non-negative' })
  }

  const computedCents = acc.balance_cents
  const realCents = b.target_cents
  const delta = realCents - computedCents
  if (delta === 0) {
    return { id: null, adjustment_cents: 0, computedCents, realCents, deltaCents: 0 }
  }

  const { id } = postTransaction({
    uuid: `adjust-${b.account_id}-${Date.now()}`,
    date: todayMYT(),
    amount_cents: delta,
    direction: delta > 0 ? 'income' : 'expense',
    category: 'adjustment',
    account_id: b.account_id,
    note: `Balance reconciled to ${realCents}`,
    source: 'adjustment',
  })

  return { id, adjustment_cents: delta, computedCents, realCents, deltaCents: delta }
})
