// server/api/money-moves/[key].patch.ts
// PATCH /api/money-moves/:key — set the persisted status of a known money-move.
// Session-gated (requireSession → 401 unauth). Validates key + status, upserts into
// money_move_state. ADVISORY ONLY: changes status only — never moves money.
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { moneyMoveState } from '../../db/schema'
import { isMoveKey, isMoveStatus } from '../../utils/moneyMoves'
import { nowEpoch } from '../../utils/mytDate'

export default defineEventHandler(async (event) => {
  requireSession(event)

  const key = getRouterParam(event, 'key')
  if (!isMoveKey(key)) {
    throw createError({ statusCode: 400, statusMessage: 'unknown money-move key' })
  }

  const body = await readBody(event)
  const status = body?.status
  if (!isMoveStatus(status)) {
    throw createError({ statusCode: 400, statusMessage: "status must be one of: todo, done, dismissed" })
  }

  const now = nowEpoch()
  const existing = db.select().from(moneyMoveState).where(eq(moneyMoveState.move_key, key)).get()
  if (existing) {
    db.update(moneyMoveState).set({ status, updated_at: now }).where(eq(moneyMoveState.move_key, key)).run()
  } else {
    db.insert(moneyMoveState).values({ move_key: key, status, updated_at: now }).run()
  }

  return { key, status }
})
