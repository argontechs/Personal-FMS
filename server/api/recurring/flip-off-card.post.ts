// server/api/recurring/flip-off-card.post.ts
// Session-gated endpoint: flips active card-funded recurring templates to a bank account.
// ILP templates are paused instead of flipped (§3 exception).
import { requireSession } from '../../utils/requireSession'
import { flipCardFundedToBank } from '../../utils/killCardFlip'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const b = await readBody(event)
  if (typeof b?.card_account_id !== 'number' || typeof b?.bank_account_id !== 'number') {
    throw createError({ statusCode: 400, statusMessage: 'card_account_id and bank_account_id required' })
  }
  return flipCardFundedToBank(b.card_account_id, b.bank_account_id)
})
