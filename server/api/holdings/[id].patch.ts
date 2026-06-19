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
// RM1,000,000,000 expressed in sen — a sane upper bound to reject fat-finger / overflow values.
const MAX_VALUE_CENTS = 100_000_000_00

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
  // Match POST: reject empty / whitespace institution.
  if ('institution' in b && (typeof b.institution !== 'string' || b.institution.trim() === '')) {
    throw createError({ statusCode: 400, statusMessage: 'institution must be a non-empty string' })
  }
  if ('kind' in b && !VALID_KINDS.includes(b.kind)) {
    throw createError({ statusCode: 400, statusMessage: `kind must be one of: ${VALID_KINDS.join(', ')}` })
  }
  if ('current_value_cents' in b) {
    const v = b.current_value_cents
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'current_value_cents must be a positive integer' })
    }
    if (v > MAX_VALUE_CENTS) {
      throw createError({ statusCode: 400, statusMessage: 'current_value_cents exceeds the maximum allowed value' })
    }
  }
  if ('liquid' in b && b.liquid !== 0 && b.liquid !== 1) {
    throw createError({ statusCode: 400, statusMessage: 'liquid must be exactly 0 or 1' })
  }
  if ('sort_order' in b && (typeof b.sort_order !== 'number' || !Number.isInteger(b.sort_order) || b.sort_order < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'sort_order must be a non-negative integer' })
  }

  const patch: Record<string, unknown> = { updated_at: nowEpoch() }
  for (const f of PATCHABLE_FIELDS) {
    if (!(f in b)) continue
    if (f === 'name' || f === 'institution') patch[f] = String(b[f]).trim()
    else if (f === 'liquid') patch[f] = b.liquid === 1 // schema is {mode:'boolean'}
    else patch[f] = b[f]
  }

  db.update(holdings).set(patch).where(eq(holdings.id, id)).run()
  const row = db.select().from(holdings).where(eq(holdings.id, id)).get()!
  // Normalise the boolean back to integer 0/1 for the wire/UI contract.
  return { ...row, liquid: row.liquid ? 1 : 0 }
})
