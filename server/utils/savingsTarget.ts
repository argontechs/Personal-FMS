// server/utils/savingsTarget.ts
// §14 #8: Per-cycle remaining EF savings target.
// Buffer phase (EF goal active): RM500/mo split across the 3 inflows = 16667 sen/cycle.
// Attack phase (EF goal achieved/paused): 0 — surplus routes to the card.
import { and, eq } from 'drizzle-orm'
import { db, goals } from '../db'

const BUFFER_PHASE_MONTHLY_SEN = 50000 // RM500/mo
const INFLOWS_PER_MONTH = 3            // salary ~1st–3rd, the 1st, the 23rd

/**
 * Returns the single canonical per-cycle savings target remaining (in sen).
 * Resolves the §14.8 single-figure rule: callers must use THIS function,
 * not show a separate monthly figure.
 */
export function currentCycleSavingsRemainingSen(_todayISO: string): number {
  const ef = db
    .select()
    .from(goals)
    .where(and(eq(goals.type, 'savings'), eq(goals.status, 'active')))
    .get()
  if (!ef) return 0
  return Math.round(BUFFER_PHASE_MONTHLY_SEN / INFLOWS_PER_MONTH) // 16667
}
