// server/api/debt.get.ts
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import { readCard } from '../utils/debtReads'
import { cardMonthlyInterestCents, cardFreeDate } from '../utils/cardPayoff'
import { payoffProgress, btRecommendation } from '../utils/payoff'
import { computeMonthlyRollup } from '../utils/monthlyRollup'
import { readEFBalance } from '../utils/debtReads'
import { todayMYT } from '../utils/mytDate'
import { CARD_UTIL_WARN, CARD_UTIL_DECLINE, EF_STARTER_TARGET, SAVINGS_TARGET_PER_CYCLE } from '../utils/forecastConstants'

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

  // §14 D3: card-routed payment = surplus after interest MINUS the monthly EF allocation
  // (0 once the RM1,000 starter buffer is funded), per §14 D3.
  // While the EF balance < EF_STARTER_TARGET, allocate 3 × SAVINGS_TARGET_PER_CYCLE/mo to the EF;
  // once funded the allocation drops to 0 and the full surplus routes to the card.
  const { surplusAfterInterestCents } = computeMonthlyRollup(db, todayISO.slice(0, 7))
  const efBalanceCents = readEFBalance(db)
  const efMonthlyAllocationCents = efBalanceCents < EF_STARTER_TARGET
    ? 3 * SAVINGS_TARGET_PER_CYCLE
    : 0
  const monthlyPaymentCents = Math.max(0, surplusAfterInterestCents - efMonthlyAllocationCents)

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
