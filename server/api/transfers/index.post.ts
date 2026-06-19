// server/api/transfers/index.post.ts
// POST /api/transfers — records an EF transfer (two-leg atomic via postTransaction).
// Body: { from_account_id, to_account_id, amount_cents, goal_id?, note?, uuid?, date? }
// Returns: { id: number }
import { randomUUID } from 'node:crypto'
import { requireSession } from '../../utils/requireSession'
import { postEfTransfer } from '../../utils/efTransfer'
import { withinAmountCeiling } from '../../utils/money'
import { todayMYT } from '../../utils/mytDate'

export default defineEventHandler(async (event) => {
  requireSession(event)
  const body = await readBody(event)

  if (typeof body?.from_account_id !== 'number' || !Number.isInteger(body.from_account_id) || body.from_account_id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'from_account_id must be a positive integer' })
  }
  if (typeof body?.to_account_id !== 'number' || !Number.isInteger(body.to_account_id) || body.to_account_id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'to_account_id must be a positive integer' })
  }
  if (typeof body?.amount_cents !== 'number' || !Number.isInteger(body.amount_cents) || body.amount_cents <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'amount_cents must be a positive integer' })
  }
  if (!withinAmountCeiling(body.amount_cents)) {
    throw createError({ statusCode: 400, statusMessage: 'amount_cents exceeds maximum' })
  }
  if (body.goal_id !== undefined && (typeof body.goal_id !== 'number' || !Number.isInteger(body.goal_id) || body.goal_id <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'goal_id must be a positive integer' })
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'note must be a string' })
  }
  if (body.note && body.note.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'note must not exceed 200 characters' })
  }
  if (body.uuid !== undefined && (typeof body.uuid !== 'string' || body.uuid.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'uuid must be a non-empty string' })
  }
  if (body.date !== undefined && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) {
    throw createError({ statusCode: 400, statusMessage: 'date must be in YYYY-MM-DD format' })
  }

  if (body.from_account_id === body.to_account_id) {
    throw createError({ statusCode: 400, statusMessage: 'from and to must differ' })
  }

  return postEfTransfer({
    from_account_id: body.from_account_id,
    to_account_id: body.to_account_id,
    amount_cents: body.amount_cents,
    goal_id: body.goal_id,
    note: body.note,
    uuid: body.uuid ?? randomUUID(),
    date: body.date ?? todayMYT(),
  })
})
