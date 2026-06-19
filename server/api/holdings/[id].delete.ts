// server/api/holdings/[id].delete.ts
// DELETE /api/holdings/:id — remove a holding by id.
// Session-gated (requireSession → 401 unauth).
import { defineEventHandler, createError, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { holdings } from '../../db/schema'

export default defineEventHandler((event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const existing = db.select({ id: holdings.id }).from(holdings).where(eq(holdings.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'not found' })
  }

  db.delete(holdings).where(eq(holdings.id, id)).run()
  return { ok: true }
})
