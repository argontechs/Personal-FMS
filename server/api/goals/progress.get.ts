// server/api/goals/progress.get.ts
// §7 / §14 #3, #13, #16: EF progress from ledger two-leg; Kill-Card from frozen baseline.
import { defineEventHandler } from 'h3'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db'
import { efBalanceCents, readGoals } from '../../utils/goalReads'
import { payoffProgress } from '../../utils/payoff'

export default defineEventHandler((event) => {
  requireSession(event) // 401 unauth if no valid session

  const { ef, killCard } = readGoals(db)

  // §14 #13: EF balance = full two-leg ledger sum (not positive-amount filter).
  const efCurrent = efBalanceCents(db, ef.accountId)
  // §14 #16: starter target 100000 sen (RM1,000) stored in goal.target_amount_cents.
  const efProgress = ef.targetCents > 0
    ? Math.min(1, Math.max(0, efCurrent / ef.targetCents))
    : 0

  return {
    ef: {
      currentCents: efCurrent,
      targetCents: ef.targetCents,
      progress: efProgress,
    },
    killCard: {
      currentCents: killCard.currentCents,
      baselineCents: killCard.baselineCents,
      // §14 #3: frozen baseline; payoffProgress is null-safe and clamped [0,1].
      progress: payoffProgress(killCard.baselineCents, killCard.currentCents),
    },
  }
})
