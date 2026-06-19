// server/api/streaks.get.ts
// §streak: Streak & Milestone endpoint — derived entirely from ledger, no new tables.
import { defineEventHandler } from 'h3'
import { notInArray, sql } from 'drizzle-orm'
import { requireSession } from '../utils/requireSession'
import { db } from '../db'
import { transactions } from '../db/schema'
import { computeStreaks } from '../utils/streaks'
import { efBalanceCents, readGoals } from '../utils/goalReads'
import { todayMYT } from '../utils/mytDate'

// Categories that represent internal/system transactions — exclude from streak/spend counts.
const SYSTEM_CATEGORIES = ['income', 'savings', 'debt', 'interest', 'adjustment'] as const

export interface Milestone {
  key: string
  label: string
  achieved: boolean
  progress: number  // 0..1
  detail: string
}

export default defineEventHandler((event) => {
  requireSession(event)

  const today = todayMYT()

  // ── 1. Fetch distinct user-facing spend dates ──────────────────────────────
  // Use the transaction's `date` column (YYYY-MM-DD, user-intended MYT date).
  // Exclude system categories; direction='transfer' rows use savings/debt categories anyway.
  const distinctDates: Array<{ d: string }> = db
    .select({ d: transactions.date })
    .from(transactions)
    .where(notInArray(transactions.category, SYSTEM_CATEGORIES as unknown as string[]))
    .groupBy(transactions.date)
    .orderBy(transactions.date)
    .all()

  const sortedDates = distinctDates.map((r) => r.d)

  // ── 2. Streaks ─────────────────────────────────────────────────────────────
  const { current: currentStreak, longest: longestStreak } = computeStreaks(sortedDates, today)
  const loggedToday = sortedDates.includes(today)
  const lastLoggedDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null

  // ── 3. EF balance & CC debt ────────────────────────────────────────────────
  const { ef, killCard } = readGoals(db)
  const efBal = efBalanceCents(db, ef.accountId)

  // Credit-card debt balance — the canonical card balance (via the debt_payoff
  // goal's linked debt), NOT the sum of every debt. Same read goals/debt views use.
  const ccDebtTotal = killCard.currentCents

  // ── 4. Total user-facing spend transaction count ───────────────────────────
  const countRow = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(notInArray(transactions.category, SYSTEM_CATEGORIES as unknown as string[]))
    .get()
  const totalSpendTxns = Number(countRow?.n ?? 0)

  // ── 5. Milestones ──────────────────────────────────────────────────────────
  const milestones: Milestone[] = [
    {
      key: 'first-log',
      label: 'First spend logged',
      achieved: totalSpendTxns >= 1,
      progress: totalSpendTxns >= 1 ? 1 : 0,
      detail: 'Log your first spend',
    },
    {
      key: 'streak-7',
      label: '7-day streak',
      achieved: longestStreak >= 7,
      progress: Math.min(longestStreak / 7, 1),
      detail: '7 days in a row',
    },
    {
      key: 'streak-30',
      label: '30-day streak',
      achieved: longestStreak >= 30,
      progress: Math.min(longestStreak / 30, 1),
      detail: '30 days in a row',
    },
    {
      key: 'ef-1000',
      label: 'RM 1,000 emergency fund',
      achieved: efBal >= 100_000,
      progress: Math.min(efBal / 100_000, 1),
      detail: 'RM 1,000 saved',
    },
    {
      key: 'card-paid',
      label: 'Credit card cleared',
      achieved: ccDebtTotal <= 0,
      progress:
        killCard.baselineCents > 0
          ? Math.min(Math.max((killCard.baselineCents - ccDebtTotal) / killCard.baselineCents, 0), 1)
          : ccDebtTotal <= 0
            ? 1
            : 0,
      detail: 'Zero card debt',
    },
    {
      key: 'ef-15000',
      label: 'RM 15,000 emergency fund',
      achieved: efBal >= 1_500_000,
      progress: Math.min(efBal / 1_500_000, 1),
      detail: 'RM 15,000 saved',
    },
  ]

  return {
    currentStreak,
    longestStreak,
    lastLoggedDate,
    loggedToday,
    milestones,
  }
})
