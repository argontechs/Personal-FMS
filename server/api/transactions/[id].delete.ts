// server/api/transactions/[id].delete.ts
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { transactions } from '../../db/schema'
import { recomputeBalances } from '../../utils/post'
import { isEditableTxn } from '../../../shared/txnEditable'
import { eq } from 'drizzle-orm'

export default defineEventHandler((event) => {
  requireSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'bad id' })
  }

  const existing = db.select({
    id: transactions.id,
    direction: transactions.direction,
    category: transactions.category,
    debt_id: transactions.debt_id,
    source: transactions.source,
  }).from(transactions).where(eq(transactions.id, id)).get()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'transaction not found' })
  }

  // Defense in depth: never delete a system/auto ledger row — deleting an interest/debt
  // leg would silently rewrite balances. These rows stay as read-only history.
  if (!isEditableTxn(existing)) {
    throw createError({ statusCode: 403, statusMessage: 'this transaction is system-managed and cannot be deleted' })
  }

  db.delete(transactions).where(eq(transactions.id, id)).run()
  // Rebuild all account/debt balances from ledger to reverse the deleted transaction's effect.
  recomputeBalances()
  return { ok: true }
})
