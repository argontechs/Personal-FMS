// server/api/money-moves/index.get.ts
// GET /api/money-moves — §11/§15 high-value "money-move levers".
// Session-gated (requireSession → 401 unauth). READ-ONLY: derives the current moves
// from live state and joins persisted status. NEVER mutates anything.
// Returns non-dismissed moves by default; ?all=1 includes dismissed too.
import { defineEventHandler, getQuery } from 'h3'
import { requireSession } from '../../utils/requireSession'
import { db } from '../../db/index'
import { deriveMoneyMoves } from '../../utils/moneyMoves'

export default defineEventHandler((event) => {
  requireSession(event)

  const q = getQuery(event)
  const includeAll = q.all === '1' || q.all === 'true'

  const moves = deriveMoneyMoves(db)
  return includeAll ? moves : moves.filter((m) => m.status !== 'dismissed')
})
