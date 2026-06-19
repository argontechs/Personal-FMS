// server/api/debts/card/reconcile.post.ts
// Reconcile the REAL credit-card statement balance vs the app's computed card debt.
// The user enters what they ACTUALLY owe (real_cents, a non-negative figure). We post a
// reconciling 'adjustment' ledger row on the CARD DEBT leg for the signed delta
// (real − computed) so the debt — and thus its mirror account (account.balance = −debt.balance)
// — recomputes to the real balance. The frozen payoff_baseline_cents is NEVER touched, so
// kill-the-card progress still measures against the original baseline.
//
// Auth: requireSession-gated (401 unauth). CSRF: covered by the existing same-origin middleware.
import { defineEventHandler, readBody, createError } from 'h3'
import { requireSession } from '../../../utils/requireSession'
import { db } from '../../../db/index'
import { readCard } from '../../../utils/debtReads'
import { postTransaction } from '../../../utils/post'
import { withinAmountCeiling } from '../../../utils/money'
import { todayMYT } from '../../../utils/mytDate'

export default defineEventHandler(async (event) => {
  requireSession(event) // §5 / §14 #22: session-gated → 401 unauth
  const b = await readBody(event)

  if (typeof b?.real_cents !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'real_cents required' })
  }
  if (!Number.isInteger(b.real_cents)) {
    throw createError({ statusCode: 400, statusMessage: 'real_cents must be an integer' })
  }
  // A real statement balance is what you owe — non-negative — and within the ceiling.
  if (b.real_cents < 0) {
    throw createError({ statusCode: 400, statusMessage: 'real_cents must be non-negative' })
  }
  if (!withinAmountCeiling(b.real_cents)) {
    throw createError({ statusCode: 400, statusMessage: 'real_cents exceeds maximum' })
  }

  const { debt } = readCard(db)
  if (!debt) {
    throw createError({ statusCode: 404, statusMessage: 'card debt not found' })
  }

  const computedCents = debt.balance_cents
  const realCents = b.real_cents
  // Debt leg adds amount_cents to debt.balance_cents (recompute = SUM over debt_id rows),
  // so the signed delta drives the debt to exactly the real balance.
  const delta = realCents - computedCents
  if (delta === 0) {
    return { id: null, adjustment_cents: 0, computedCents, realCents, deltaCents: 0 }
  }

  const { id } = postTransaction({
    uuid: `card-reconcile-${debt.id}-${Date.now()}`,
    date: todayMYT(),
    amount_cents: delta,
    // direction reflects the debt movement: a positive delta GROWS the debt (treat as expense),
    // a negative delta SHRINKS it (treat as income). The account leg is skipped (account_id null);
    // the debt leg + Step-3 card mirror do the work in recomputeBalances.
    direction: delta > 0 ? 'expense' : 'income',
    category: 'adjustment',
    account_id: null,
    debt_id: debt.id,
    note: `Card statement reconciled to ${realCents}`,
    source: 'adjustment',
  })

  return { id, adjustment_cents: delta, computedCents, realCents, deltaCents: delta }
})
