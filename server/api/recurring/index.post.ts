// server/api/recurring/index.post.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { recurringItems } from '../../db/schema'
import { nextDueDate, todayMYT, nowEpoch } from '../../utils/mytDate'

const VALID_DIRECTIONS = ['income', 'expense'] as const
const VALID_CADENCES = ['monthly', 'weekly', 'biweekly', 'yearly'] as const
const VALID_CATEGORIES = ['food', 'transport', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'] as const

export default defineEventHandler(async (event) => {
  requireSession(event)
  const b = await readBody(event)

  if (!b?.name || typeof b.name !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'name required' })
  }
  if (!b?.direction || !VALID_DIRECTIONS.includes(b.direction)) {
    throw createError({ statusCode: 400, statusMessage: `direction must be one of: ${VALID_DIRECTIONS.join(', ')}` })
  }
  if (typeof b.amount_cents !== 'number' || !Number.isInteger(b.amount_cents) || b.amount_cents < 0) {
    throw createError({ statusCode: 400, statusMessage: 'amount_cents must be a non-negative integer' })
  }
  if (!b?.start_date || typeof b.start_date !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'start_date required' })
  }

  const cadence = b.cadence ?? 'monthly'
  if (!VALID_CADENCES.includes(cadence)) {
    throw createError({ statusCode: 400, statusMessage: `cadence must be one of: ${VALID_CADENCES.join(', ')}` })
  }

  const category = b.category ?? 'other'
  if (!VALID_CATEGORIES.includes(category)) {
    throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
  }

  const dom = b.day_of_month ?? null
  if (dom !== null && (!Number.isInteger(dom) || dom < 1 || dom > 31)) {
    throw createError({ statusCode: 400, statusMessage: 'day_of_month must be an integer 1–31' })
  }

  const now = nowEpoch()
  // Compute next_due_date from day_of_month — single source of truth; never accept client-supplied value.
  const from = b.start_date <= todayMYT() ? todayMYT() : b.start_date
  const next = dom != null ? nextDueDate(from, dom) : null

  const [row] = db.insert(recurringItems).values({
    name: b.name,
    direction: b.direction,
    amount_cents: b.amount_cents,
    is_variable: b.is_variable ?? false,
    cadence,
    day_of_month: dom,
    weekday: b.weekday ?? null,
    category,
    funding_account_id: b.funding_account_id ?? null,
    debt_id: b.debt_id ?? null,
    auto_post: b.auto_post ?? true,
    start_date: b.start_date,
    end_date: b.end_date ?? null,
    remaining_occurrences: b.remaining_occurrences ?? null,
    remaining_installments_json: b.remaining_installments_json ?? null,
    last_posted_date: null,
    next_due_date: next,
    is_active: b.is_active ?? true,
    created_at: now,
    updated_at: now,
  }).returning().all()

  return row
})
