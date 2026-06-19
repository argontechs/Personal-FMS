// server/api/budgets/index.get.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { budgets, transactions } from '../../db/schema'
import { eq, and, like } from 'drizzle-orm'
import { todayMYT } from '../../utils/mytDate'
import { SPEND_CATEGORIES } from '../../../shared/categories'

export default defineEventHandler(async (event) => {
  requireSession(event)

  const monthPrefix = todayMYT().slice(0, 7) // YYYY-MM

  const result = []
  for (const cat of SPEND_CATEGORIES) {
    // Get budget row if exists
    const budgetRow = db.select()
      .from(budgets)
      .where(eq(budgets.category, cat.key))
      .get()

    // Sum expense transactions for this category in current MYT month
    const rows = db.select({ amount_cents: transactions.amount_cents })
      .from(transactions)
      .where(
        and(
          eq(transactions.direction, 'expense'),
          eq(transactions.category, cat.key),
          like(transactions.date, `${monthPrefix}-%`),
        )
      )
      .all()

    const spent_cents = rows.length > 0
      ? Math.abs(rows.reduce((sum, r) => sum + r.amount_cents, 0))
      : 0

    result.push({
      category: cat.key,
      limit_cents: budgetRow ? budgetRow.limit_cents : null,
      spent_cents,
    })
  }

  return result
})
