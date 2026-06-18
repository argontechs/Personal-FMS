// server/api/debt.get.ts
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import { readCard } from '../utils/debtReads'
import { cardMonthlyInterestCents, cardFreeDate } from '../utils/cardPayoff'
import { payoffProgress, btRecommendation } from '../utils/payoff'
import { computeMonthlyRollup } from '../utils/monthlyRollup'
import { todayMYT } from '../utils/mytDate'
import { CARD_UTIL_WARN, CARD_UTIL_DECLINE } from '../utils/forecastConstants'

export default defineEventHandler((event) => {
  requireSession(event) // §5 / §14 #22: session-gated → 401 unauth

  const q = getQuery(event)
  const todayISO = typeof q.today === 'string' ? q.today : todayMYT()

  const { debt, account } = readCard(db)
  const cardBalanceCents = debt.balance_cents
  const creditLimitCents = account.credit_limit_cents ?? 0

  // §14 #2: available credit is DERIVED at read time — never read from accounts.available_credit_cents.
  const availableCreditCents = Math.max(0, creditLimitCents - cardBalanceCents)
  const utilization = creditLimitCents > 0 ? cardBalanceCents / creditLimitCents : 0

  const monthlyInterestCents = cardMonthlyInterestCents({
    balance_cents: cardBalanceCents,
    apr_bps: debt.apr_bps,
    bt_status: debt.bt_status,
  })

  // §14 D3: surplus routed at the card = surplusAfterInterestCents from the monthly rollup.
  // This is the post-EF/savings allocation figure; NOT the raw surplus.
  const monthlyPaymentCents = computeMonthlyRollup(db, todayISO.slice(0, 7)).surplusAfterInterestCents

  const { months: cardFreeMonths, cardFreeISO } = cardFreeDate(
    { balance_cents: cardBalanceCents, apr_bps: debt.apr_bps, bt_status: debt.bt_status },
    monthlyPaymentCents,
    todayISO,
  )

  return {
    cardBalanceCents,
    creditLimitCents,
    availableCreditCents,
    utilization,
    utilWarn: utilization >= CARD_UTIL_WARN,
    utilDecline: utilization >= CARD_UTIL_DECLINE,
    monthlyInterestCents,
    btStatus: debt.bt_status,
    btRecommendation: btRecommendation(debt.bt_status),
    payoffProgress: payoffProgress(debt.payoff_baseline_cents, cardBalanceCents),
    cardFreeISO,
    cardFreeMonths,
  }
})
