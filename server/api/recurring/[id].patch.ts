// server/api/recurring/[id].patch.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { recurringItems } from '../../db/schema'
import { nextDueDate, todayMYT, nowEpoch } from '../../utils/mytDate'
import { eq } from 'drizzle-orm'

const PATCHABLE_FIELDS = [
  'name', 'amount_cents', 'is_variable', 'cadence', 'day_of_month', 'weekday',
  'category', 'funding_account_id', 'debt_id', 'auto_post', 'end_date',
  'remaining_occurrences', 'remaining_installments_json', 'is_active',
] as const

// Shared validation constants (mirrored from index.post.ts)
const VALID_CADENCES = ['monthly', 'weekly', 'biweekly', 'yearly'] as const
const VALID_CATEGORIES = ['food', 'transport', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'] as const

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const b = await readBody(event)
  const cur = db.select().from(recurringItems).where(eq(recurringItems.id, id)).get()
  if (!cur) throw createError({ statusCode: 404, statusMessage: 'not found' })

  if ('amount_cents' in b) {
    const ac = b.amount_cents
    // Match POST: non-negative (0 is valid — e.g. SPayLater base template carries amounts in remaining_installments_json).
    if (typeof ac !== 'number' || !Number.isInteger(ac) || ac < 0) {
      throw createError({ statusCode: 400, statusMessage: 'amount_cents must be a non-negative integer' })
    }
  }

  if ('cadence' in b && !VALID_CADENCES.includes(b.cadence)) {
    throw createError({ statusCode: 400, statusMessage: `cadence must be one of: ${VALID_CADENCES.join(', ')}` })
  }

  if ('category' in b && !VALID_CATEGORIES.includes(b.category)) {
    throw createError({ statusCode: 400, statusMessage: `category must be one of: ${VALID_CATEGORIES.join(', ')}` })
  }

  if ('auto_post' in b && typeof b.auto_post !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'auto_post must be a boolean' })
  }

  if ('day_of_month' in b && b.day_of_month !== null) {
    const dom = b.day_of_month
    if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
      throw createError({ statusCode: 400, statusMessage: 'day_of_month must be an integer 1–31' })
    }
  }

  if ('weekday' in b && b.weekday !== null) {
    const wd = b.weekday
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
      throw createError({ statusCode: 400, statusMessage: 'weekday must be an integer 0–6' })
    }
  }

  const patch: Record<string, unknown> = { updated_at: nowEpoch() }
  for (const f of PATCHABLE_FIELDS) {
    if (f in b) patch[f] = b[f]
  }

  // Recompute next_due_date as single source of truth when anchor day changes (including clearing to null).
  // next_due_date is never directly client-settable.
  if ('day_of_month' in b) {
    if (b.day_of_month == null) {
      patch.next_due_date = null
    } else {
      const from = cur.last_posted_date ?? todayMYT()
      patch.next_due_date = nextDueDate(from, b.day_of_month)
    }
  }

  db.update(recurringItems).set(patch).where(eq(recurringItems.id, id)).run()
  return db.select().from(recurringItems).where(eq(recurringItems.id, id)).get()
})
