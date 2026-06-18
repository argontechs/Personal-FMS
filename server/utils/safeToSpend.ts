// server/utils/safeToSpend.ts
import { BUFFER_FLOOR } from './forecastConstants'
import { nextInflowDate, daysBetweenISO } from './nextInflow'

export interface StsInput {
  cashNowCents: number
  expectedInflowsBeforeNextCents: number
  committedOutflowsCents: number
  savingsTargetRemainingCents: number
  spentTodayVariableCents: number
  todayISO: string
}

export interface StsResult {
  cycleCents: number
  dailyCents: number
  weeklyCents: number
  isNegative: boolean
  shortfallCents: number
  nextInflowISO: string
  daysToNextInflow: number
}

export function computeSafeToSpend(input: StsInput): StsResult {
  const nextInflowISO = nextInflowDate(input.todayISO)
  const daysToNextInflow = Math.max(1, daysBetweenISO(input.todayISO, nextInflowISO))

  // STS_cycle (§4). committed_outflows already excludes discretionary variable spend.
  const rawCycle =
    input.cashNowCents +
    input.expectedInflowsBeforeNextCents -
    input.committedOutflowsCents -
    input.savingsTargetRemainingCents -
    BUFFER_FLOOR

  const isNegative = rawCycle < 0
  const cycleCents = isNegative ? 0 : rawCycle
  const shortfallCents = isNegative ? -rawCycle : 0

  // STS_daily = cycle / days − spent_today_variable (§4, §14 #20: spent_today keyed off client MYT date)
  const dailyCents = Math.max(
    0,
    Math.floor(cycleCents / daysToNextInflow) - input.spentTodayVariableCents,
  )

  // STS_weekly = cycle × min(7, days)/days (§4)
  const weeklyCents = Math.floor((cycleCents * Math.min(7, daysToNextInflow)) / daysToNextInflow)

  return { cycleCents, dailyCents, weeklyCents, isNegative, shortfallCents, nextInflowISO, daysToNextInflow }
}
