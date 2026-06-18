// server/api/recurring/index.get.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { recurringItems } from '../../db/schema'
import { eq, asc } from 'drizzle-orm'

export default defineEventHandler((event) => {
  requireSession(event)
  return db.select().from(recurringItems)
    .where(eq(recurringItems.is_active, true))
    .orderBy(asc(recurringItems.next_due_date))
    .all()
})
