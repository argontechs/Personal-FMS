// server/api/recurring/index.get.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { recurringItems } from '../../db/schema'
import { eq, asc } from 'drizzle-orm'

export default defineEventHandler((event) => {
  requireSession(event)
  // Default: active items only (back-compat). `?all=1` includes paused items so the
  // Bills screen can show + resume them (a paused bill must not vanish from the UI).
  const includeInactive = getQuery(event).all === '1'
  const base = db.select().from(recurringItems)
  return (includeInactive ? base : base.where(eq(recurringItems.is_active, true)))
    .orderBy(asc(recurringItems.next_due_date))
    .all()
})
