// server/api/accounts/index.get.ts
import { db } from '../../db/index'
import { accounts } from '../../db/schema'
import { requireSession } from '../../utils/requireSession'

export default defineEventHandler((event) => {
  requireSession(event) // throws 401 if no valid session
  return db.select().from(accounts).all()
})
