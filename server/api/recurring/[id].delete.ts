// server/api/recurring/[id].delete.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { recurringItems } from '../../db/schema'
import { nowEpoch } from '../../utils/mytDate'
import { eq } from 'drizzle-orm'

export default defineEventHandler((event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }
  db.update(recurringItems).set({ is_active: false, updated_at: nowEpoch() }).where(eq(recurringItems.id, id)).run()
  return { ok: true }
})
