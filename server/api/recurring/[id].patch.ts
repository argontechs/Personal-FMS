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

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const b = await readBody(event)
  const cur = db.select().from(recurringItems).where(eq(recurringItems.id, id)).get()
  if (!cur) throw createError({ statusCode: 404, statusMessage: 'not found' })

  const patch: Record<string, unknown> = { updated_at: nowEpoch() }
  for (const f of PATCHABLE_FIELDS) {
    if (f in b) patch[f] = b[f]
  }

  // Recompute next_due_date as single source of truth when anchor day changes.
  if ('day_of_month' in b && b.day_of_month != null) {
    const from = cur.last_posted_date ?? todayMYT()
    patch.next_due_date = nextDueDate(from, b.day_of_month)
  }

  db.update(recurringItems).set(patch).where(eq(recurringItems.id, id)).run()
  return db.select().from(recurringItems).where(eq(recurringItems.id, id)).get()
})
