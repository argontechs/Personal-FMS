// server/api/holdings/[id].patch.ts
// PATCH /api/holdings/:id — update fields; bumps updated_at to Date.now().
// Session-gated (requireSession → 401 unauth).
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { holdings } from '../../db/schema'
import { nowEpoch } from '../../utils/mytDate'

const VALID_KINDS = ['investment', 'insurance', 'savings'] as const
const PATCHABLE_FIELDS = ['name', 'institution', 'kind', 'current_value_cents', 'liquid', 'note', 'sort_order'] as const

export default defineEventHandler(async (event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const cur = db.select().from(holdings).where(eq(holdings.id, id)).get()
  if (!cur) throw createError({ statusCode: 404, statusMessage: 'not found' })

  const b = await readBody(event)

  if ('name' in b && (typeof b.name !== 'string' || b.name.trim() === '')) {
    throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' })
  }
  if ('kind' in b && !VALID_KINDS.includes(b.kind)) {
    throw createError({ statusCode: 400, statusMessage: `kind must be one of: ${VALID_KINDS.join(', ')}` })
  }
  if ('current_value_cents' in b) {
    const v = b.current_value_cents
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'current_value_cents must be a positive integer' })
    }
  }

  const patch: Record<string, unknown> = { updated_at: nowEpoch() }
  for (const f of PATCHABLE_FIELDS) {
    if (f in b) patch[f] = f === 'name' || f === 'institution' ? String(b[f]).trim() : b[f]
  }

  db.update(holdings).set(patch).where(eq(holdings.id, id)).run()
  return db.select().from(holdings).where(eq(holdings.id, id)).get()
})
