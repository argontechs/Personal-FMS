// server/api/transactions/[id].delete.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { transactions } from '../../db/schema'
import { recomputeBalances } from '../../utils/post'
import { eq } from 'drizzle-orm'

export default defineEventHandler((event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const existing = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'transaction not found' })
  }

  db.delete(transactions).where(eq(transactions.id, id)).run()
  // Rebuild all account/debt balances from ledger to reverse the deleted transaction's effect.
  recomputeBalances()
  return { ok: true }
})
