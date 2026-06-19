// server/api/holdings/index.get.ts
// GET /api/holdings — returns all holdings ordered by current_value_cents DESC.
// Session-gated (requireSession → 401 unauth).
import { defineEventHandler } from 'h3'
import { desc } from 'drizzle-orm'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { holdings } from '../../db/schema'

export default defineEventHandler((event) => {
  requireSession(event)
  return db.select().from(holdings).orderBy(desc(holdings.current_value_cents)).all()
})
