// server/api/transactions/index.get.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { transactions } from '../../db/schema'
import { like, desc } from 'drizzle-orm'
import { todayMYT } from '../../utils/mytDate'

export default defineEventHandler((event) => {
  requireSession(event)
  const q = getQuery(event)
  const month = typeof q.month === 'string' ? q.month : todayMYT().slice(0, 7)
  return db.select().from(transactions)
    .where(like(transactions.date, `${month}-%`))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .all()
})
