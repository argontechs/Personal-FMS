// server/utils/moneyMoves.ts
// §11/§15 money-move levers — shared constants + derivation.
// ADVISORY ONLY: this module never moves money. It derives the current high-value
// action items from live state and joins the persisted (user-chosen) status.
import { eq } from 'drizzle-orm'
import { holdings, moneyMoveState } from '../db/schema'
import { readCard } from './debtReads'

export const MOVE_KEYS = ['clear-card-with-aia', 'pause-ge-ilp'] as const
export type MoveKey = (typeof MOVE_KEYS)[number]

export const MOVE_STATUSES = ['todo', 'done', 'dismissed'] as const
export type MoveStatus = (typeof MOVE_STATUSES)[number]

export function isMoveKey(v: unknown): v is MoveKey {
  return typeof v === 'string' && (MOVE_KEYS as readonly string[]).includes(v)
}

export function isMoveStatus(v: unknown): v is MoveStatus {
  return typeof v === 'string' && (MOVE_STATUSES as readonly string[]).includes(v)
}

export interface MoneyMove {
  key: MoveKey
  kind: 'action' | 'confirm'
  title: string
  explanation: string
  suggestedAmountCents: number | null
  status: MoveStatus
}

type DB = any

function rmFromCents(cents: number): string {
  // 6352297 → "63,522.97" — RM thousands separators, 2dp.
  return (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusFor(db: DB, key: MoveKey): MoveStatus {
  const row = db.select().from(moneyMoveState).where(eq(moneyMoveState.move_key, key)).get()
  return (row?.status as MoveStatus) ?? 'todo'
}

/**
 * Derive the current money-move levers from LIVE state + persisted status.
 * Pure read — never mutates. Each move is gated on real conditions:
 *  - clear-card-with-aia: card balance > 0 AND a liquid holding (liquid=1) with
 *    current_value_cents >= card balance exists (the AIA Assurance Account).
 *  - pause-ge-ilp: always surfaced as a confirm-action (the recurring template is
 *    seeded is_active:false; the user confirms the real-world GE action).
 */
export function deriveMoneyMoves(db: DB): MoneyMove[] {
  const moves: MoneyMove[] = []

  // ── 1. Clear the 18% card with an AIA Assurance Account partial withdrawal ──
  const { debt } = readCard(db)
  const cardBalanceCents = Number(debt?.balance_cents ?? 0)

  const liquidRows: Array<{ current_value_cents: number }> = db
    .select({ current_value_cents: holdings.current_value_cents })
    .from(holdings)
    .where(eq(holdings.liquid, 1))
    .all()
  const qualifyingHolding = liquidRows.some((h) => Number(h.current_value_cents) >= cardBalanceCents)

  if (cardBalanceCents > 0 && qualifyingHolding) {
    moves.push({
      key: 'clear-card-with-aia',
      kind: 'action',
      title: 'Clear the 18% card with your AIA Assurance Account',
      explanation:
        `Withdraw ~RM${rmFromCents(cardBalanceCents)} from your AIA Assurance Account to clear the 18% card ` +
        `outright — a guaranteed ~18% return. Ask AIA about partial-withdrawal terms + coverage impact.`,
      suggestedAmountCents: cardBalanceCents,
      status: statusFor(db, 'clear-card-with-aia'),
    })
  }

  // ── 2. Pause the Great Eastern ILP (RM350/mo) ──────────────────────────────
  moves.push({
    key: 'pause-ge-ilp',
    kind: 'confirm',
    title: 'Pause the Great Eastern ILP',
    explanation: "Confirm you've paused the Great Eastern ILP (RM350/mo) with GE.",
    suggestedAmountCents: null,
    status: statusFor(db, 'pause-ge-ilp'),
  })

  return moves
}
