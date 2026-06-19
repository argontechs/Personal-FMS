// server/api/holdings/index.post.ts
// POST /api/holdings — create a new holding.
// Session-gated (requireSession → 401 unauth).
import { defineEventHandler, readBody, createError } from 'h3'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { holdings } from '../../db/schema'
import { nowEpoch } from '../../utils/mytDate'

const VALID_KINDS = ['investment', 'insurance', 'savings'] as const
// RM1,000,000,000 expressed in sen — a sane upper bound to reject fat-finger / overflow values.
const MAX_VALUE_CENTS = 100_000_000_00

export default defineEventHandler(async (event) => {
  requireSession(event)
  const b = await readBody(event)

  if (!b?.name || typeof b.name !== 'string' || b.name.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'name must be a non-empty string' })
  }
  if (!b?.institution || typeof b.institution !== 'string' || b.institution.trim() === '') {
    throw createError({ statusCode: 400, statusMessage: 'institution must be a non-empty string' })
  }
  if (!b?.kind || !VALID_KINDS.includes(b.kind)) {
    throw createError({ statusCode: 400, statusMessage: `kind must be one of: ${VALID_KINDS.join(', ')}` })
  }
  if (typeof b.current_value_cents !== 'number' || !Number.isInteger(b.current_value_cents) || b.current_value_cents <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'current_value_cents must be a positive integer' })
  }
  if (b.current_value_cents > MAX_VALUE_CENTS) {
    throw createError({ statusCode: 400, statusMessage: 'current_value_cents exceeds the maximum allowed value' })
  }
  // liquid: optional, but if present must be exactly 0 or 1.
  if ('liquid' in b && b.liquid !== 0 && b.liquid !== 1) {
    throw createError({ statusCode: 400, statusMessage: 'liquid must be exactly 0 or 1' })
  }
  // sort_order: optional, but if present must be a non-negative integer.
  if ('sort_order' in b && (typeof b.sort_order !== 'number' || !Number.isInteger(b.sort_order) || b.sort_order < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'sort_order must be a non-negative integer' })
  }

  const now = nowEpoch()
  const [row] = db.insert(holdings).values({
    name: b.name.trim(),
    institution: b.institution.trim(),
    kind: b.kind,
    current_value_cents: b.current_value_cents,
    liquid: b.liquid === 1, // schema is {mode:'boolean'}; store as boolean
    note: b.note ?? null,
    sort_order: b.sort_order ?? 0,
    created_at: now,
    updated_at: now,
  }).returning().all()

  // Normalise the boolean back to integer 0/1 for the wire/UI contract.
  return { ...row, liquid: row.liquid ? 1 : 0 }
})
