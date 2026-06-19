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
  const rows = db.select().from(holdings).orderBy(desc(holdings.current_value_cents)).all()
  // schema.liquid is {mode:'boolean'} (drizzle returns true/false). The wire/UI contract is
  // integer 0/1, so normalise back here — keeps the API stable + the AIA-lever query honest.
  return rows.map((r) => ({ ...r, liquid: r.liquid ? 1 : 0 }))
})
