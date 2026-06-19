// shared/txnEditable.ts — single source of truth for "is this ledger row user-editable?".
//
// The Activity sheet edits ONLY genuine user-logged rows. System / auto-generated ledger
// rows (card interest, debt payments, savings legs, transfers, adjustments) must never be
// editable or deletable: their amount_cents sign and debt_id wiring carry ledger meaning
// (debt-grows convention: interest rows are category 'interest', POSITIVE, with a debt_id),
// and re-saving them through the income/expense sheet would flip signs and corrupt
// recomputeBalances. This guard is enforced on BOTH client (no edit/delete affordance) and
// server (PATCH/DELETE reject) so corruption is impossible even if a client bypasses the UI.

import { SPEND_CATEGORIES } from './categories'

/** Categories that are system/auto ledger legs — never user-editable through Activity. */
export const NON_EDITABLE_CATEGORIES = new Set([
  'interest',
  'savings',
  'debt',
  'adjustment',
  'transfer',
  'opening-balance',
])

const SPEND_KEYS = new Set(SPEND_CATEGORIES.map((c) => c.key))

/** Minimal row shape needed to decide editability. */
export interface EditableTxnLike {
  direction?: string | null
  category?: string | null
  debt_id?: number | null
  source?: string | null
}

/**
 * TRUE only for genuine user-logged rows:
 *   - an income row (direction === 'income'), OR
 *   - an expense whose category is a real SPEND_CATEGORY.
 * FALSE for anything carrying a debt_id, a system/auto category, a transfer direction,
 * or an auto/system source.
 */
export function isEditableTxn(t: EditableTxnLike): boolean {
  // Disqualifiers first — any of these makes the row read-only system history.
  if (t.debt_id != null) return false
  if (t.direction === 'transfer') return false
  if (t.source === 'auto' || t.source === 'adjustment') return false
  if (t.category != null && NON_EDITABLE_CATEGORIES.has(t.category)) return false

  // Genuine user rows.
  if (t.direction === 'income') return true
  if (t.category != null && SPEND_KEYS.has(t.category)) return true

  return false
}
