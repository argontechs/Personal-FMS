// server/api/transfers/index.post.ts
// POST /api/transfers — records an EF transfer (two-leg atomic via postTransaction).
// Body: { from_account_id, to_account_id, amount_cents, goal_id?, note?, uuid?, date? }
// Returns: { id: number }
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { requireSession } from '../../utils/requireSession'
import { postEfTransfer } from '../../utils/efTransfer'
import { todayMYT } from '../../utils/mytDate'

const Body = z.object({
  from_account_id: z.number().int().positive(),
  to_account_id: z.number().int().positive(),
  amount_cents: z.number().int().positive(),
  goal_id: z.number().int().positive().optional(),
  note: z.string().max(200).optional(),
  uuid: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export default defineEventHandler(async (event) => {
  requireSession(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid transfer' })
  const b = parsed.data
  if (b.from_account_id === b.to_account_id) {
    throw createError({ statusCode: 400, statusMessage: 'from and to must differ' })
  }
  return postEfTransfer({
    from_account_id: b.from_account_id,
    to_account_id: b.to_account_id,
    amount_cents: b.amount_cents,
    goal_id: b.goal_id,
    note: b.note,
    uuid: b.uuid ?? randomUUID(),
    date: b.date ?? todayMYT(),
  })
})
