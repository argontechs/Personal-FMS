// server/utils/monthlyRollup.ts
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { transactions } from '../db/schema'

type DB = any

const LIVING = ['food', 'transport', 'bills', 'other'] as const

export interface MonthlyRollup {
  incomeCents: number
  livingCents: number
  debtServiceCents: number
  interestCents: number
  rawSurplusCents: number
  surplusAfterInterestCents: number
}

function sumAbsForCategories(db: DB, monthPrefix: string, categories: readonly string[]): number {
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(ABS(${transactions.amount_cents})), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.direction, 'expense'),
        inArray(transactions.category, categories as unknown as string[]),
        like(transactions.date, `${monthPrefix}-%`),
      ),
    )
    .get()
  return Number(row?.total ?? 0)
}

export function computeMonthlyRollup(db: DB, monthPrefix: string): MonthlyRollup {
  const incomeRow = db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.amount_cents}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.direction, 'income'), like(transactions.date, `${monthPrefix}-%`)))
    .get()
  const incomeCents = Number(incomeRow?.total ?? 0)

  const livingCents = sumAbsForCategories(db, monthPrefix, LIVING)
  const debtServiceCents = sumAbsForCategories(db, monthPrefix, ['debt'])
  const interestCents = sumAbsForCategories(db, monthPrefix, ['interest'])

  // §4: surplus = income − living − debt_svc. §14 #9: interest is neither living nor debt_svc.
  const rawSurplusCents = incomeCents - livingCents - debtServiceCents
  const surplusAfterInterestCents = rawSurplusCents - interestCents // the ~RM623 (Jul) label

  return { incomeCents, livingCents, debtServiceCents, interestCents, rawSurplusCents, surplusAfterInterestCents }
}
