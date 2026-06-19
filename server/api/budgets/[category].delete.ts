// server/api/budgets/[category].delete.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { budgets } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { SPEND_CATEGORIES } from '../../../shared/categories'

const VALID_CATS = SPEND_CATEGORIES.map(c => c.key)

export default defineEventHandler(async (event) => {
  requireSession(event)

  const category = getRouterParam(event, 'category')
  if (!category || !VALID_CATS.includes(category)) {
    throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATS.join(', ')}` })
  }

  db.delete(budgets).where(eq(budgets.category, category)).run()

  return { ok: true }
})
