// server/api/holdings/index.post.ts
// POST /api/holdings — create a new holding.
// Session-gated (requireSession → 401 unauth).
import { defineEventHandler, readBody, createError } from 'h3'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { holdings } from '../../db/schema'
import { nowEpoch } from '../../utils/mytDate'

const VALID_KINDS = ['investment', 'insurance', 'savings'] as const

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

  const now = nowEpoch()
  const [row] = db.insert(holdings).values({
    name: b.name.trim(),
    institution: b.institution.trim(),
    kind: b.kind,
    current_value_cents: b.current_value_cents,
    liquid: b.liquid ?? 0,
    note: b.note ?? null,
    sort_order: b.sort_order ?? 0,
    created_at: now,
    updated_at: now,
  }).returning().all()

  return row
})
