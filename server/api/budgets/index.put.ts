// server/api/budgets/index.put.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { budgets } from '../../db/schema'
import { SPEND_CATEGORIES } from '../../../shared/categories'

const VALID_CATS = SPEND_CATEGORIES.map(c => c.key)

export default defineEventHandler(async (event) => {
  requireSession(event)

  const body = await readBody(event)

  if (!body?.category || !VALID_CATS.includes(body.category)) {
    throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATS.join(', ')}` })
  }

  if (
    typeof body.limit_cents !== 'number' ||
    !Number.isInteger(body.limit_cents) ||
    body.limit_cents <= 0
  ) {
    throw createError({ statusCode: 400, statusMessage: 'limit_cents must be a positive integer' })
  }

  const now = Date.now()

  const [row] = db.insert(budgets)
    .values({
      category: body.category,
      limit_cents: body.limit_cents,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: budgets.category,
      set: {
        limit_cents: body.limit_cents,
        updated_at: now,
      },
    })
    .returning()
    .all()

  return row
})
