// server/api/forecast.get.ts
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import {
  cashNowCents,
  committedOutflowsBeforeCents,
  spentTodayVariableCents,
  savingsTargetRemainingCents,
} from '../utils/forecastReads'
import { nextInflowDate } from '../utils/nextInflow'
import { computeSafeToSpend } from '../utils/safeToSpend'
import { computeMonthlyRollup } from '../utils/monthlyRollup'
import { deltaCashThisMonth } from '../utils/deltaCash'
import { todayMYT } from '../utils/mytDate'

export default defineEventHandler((event) => {
  requireSession(event) // §14 #22: every server/api/** handler is session-gated → 401 unauth

  const q = getQuery(event)
  const todayISO = typeof q.today === 'string' ? q.today : todayMYT()
  const nextInflowISO = nextInflowDate(todayISO)

  // §14 #8: current-cycle savings target; caller may override (Attack phase routes to card → 0).
  const savingsTargetRemainingCentsValue =
    typeof q.savingsTargetRemaining === 'string'
      ? Number(q.savingsTargetRemaining)
      : savingsTargetRemainingCents(db, todayISO, nextInflowISO)

  const sts = computeSafeToSpend({
    cashNowCents: cashNowCents(db),
    expectedInflowsBeforeNextCents: 0, // §4: v1 flat projection — no mid-cycle income credited
    committedOutflowsCents: committedOutflowsBeforeCents(db, todayISO, nextInflowISO),
    savingsTargetRemainingCents: savingsTargetRemainingCentsValue,
    spentTodayVariableCents: spentTodayVariableCents(db, todayISO),
    todayISO,
  })

  const rollup = computeMonthlyRollup(db, todayISO.slice(0, 7)) // 'YYYY-MM'

  // §14 D2 — surplus-leak Δcash: net liquid cash change this month so the dashboard can
  // surface "you cleared RMx but it didn't land in savings".
  const deltaCashThisMonthCents = deltaCashThisMonth(db, todayISO.slice(0, 7))

  return {
    sts,
    rollup,
    cashNowCents: cashNowCents(db),
    todayISO,
    deltaCashThisMonthCents,
    savingsTargetRemainingCents: savingsTargetRemainingCentsValue,
  }
})
