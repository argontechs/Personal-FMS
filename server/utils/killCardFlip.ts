// server/utils/killCardFlip.ts
// §3/§14 kill-the-card: flip active card-funded recurring templates to a bank account.
// Exception: templates whose name contains 'ILP' or 'Great Wealth' are PAUSED (not flipped).
import { db } from '../db/index'
import { recurringItems } from '../db/schema'
import { nowEpoch } from './mytDate'
import { and, eq } from 'drizzle-orm'

const ILP_MARKERS = ['ILP', 'Great Wealth']

export function flipCardFundedToBank(
  cardAccountId: number,
  bankAccountId: number,
): { flipped: number; paused: number } {
  return db.transaction((tx) => {
    const now = nowEpoch()
    // Only touch ACTIVE templates funded by the card account.
    const cardFunded = tx
      .select()
      .from(recurringItems)
      .where(
        and(
          eq(recurringItems.funding_account_id, cardAccountId),
          eq(recurringItems.is_active, true),
        ),
      )
      .all()

    let flipped = 0
    let paused = 0

    for (const item of cardFunded) {
      const isIlp = ILP_MARKERS.some((m) => item.name.includes(m))
      if (isIlp) {
        // §3 exception: the ILP is PAUSED (not flipped) — stops auto-charging entirely.
        tx.update(recurringItems)
          .set({ is_active: false, auto_post: false, updated_at: now })
          .where(eq(recurringItems.id, item.id))
          .run()
        paused++
      } else {
        tx.update(recurringItems)
          .set({ funding_account_id: bankAccountId, updated_at: now })
          .where(eq(recurringItems.id, item.id))
          .run()
        flipped++
      }
    }

    return { flipped, paused }
  })
}
