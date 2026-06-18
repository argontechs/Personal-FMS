// server/utils/dispatchRun.ts
// Pure dispatch selection + idempotency core. No push I/O in this file.
// Orchestrator (runDispatch) wires selection → claim → fan-out.
import { and, eq, sql } from 'drizzle-orm'
import { db, recurringItems, notificationsSent, transactions } from '../db'
import { todayMYT } from './mytDate'
import {
  daysUntil, dueWindow, buildBillDuePayload, buildPaydayPayload, suggestedSavingsSen,
  spayLaterNextAmount,
} from './dispatchBuilders'
import { currentCycleSavingsRemainingSen } from './savingsTarget'
import type { PushPayload } from './push'
import { sendToAll } from './sendToAll'

export type Dispatch = {
  kind: 'bill_due' | 'payday_save'
  ref_id: number
  scheduled_for: string
  payload: PushPayload
}

/** Check notifications_sent for an existing row with this (kind, ref_id, scheduled_for) triple. */
function alreadySent(kind: string, ref_id: number, scheduled_for: string): boolean {
  return !!db
    .select({ id: notificationsSent.id })
    .from(notificationsSent)
    .where(
      and(
        eq(notificationsSent.kind, kind as any),
        eq(notificationsSent.ref_id, ref_id),
        eq(notificationsSent.scheduled_for, scheduled_for),
      ),
    )
    .get()
}

/**
 * Count auto-posted transactions for a given SPayLater template.
 * This is the postedCount passed to spayLaterNextAmount — it mirrors the same
 * query used by post-recurring so the reminder always shows the correct next installment.
 */
function countPostedInstallments(recurringItemId: number): number {
  const row = db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.recurring_item_id, recurringItemId),
        eq(transactions.source, 'auto'),
      ),
    )
    .get()
  return Number(row?.cnt ?? 0)
}

/**
 * Pure read: return the set of Dispatch objects to be sent for `todayISO`.
 *
 * MYT-time gate: if nowHourMyt < minHourMyt (default 9), returns [].
 * Catch-up: any recurring item in a due window (0, 1, or 3 days out)
 *   whose scheduled_for row is absent from notifications_sent is included,
 *   regardless of how late in the day it is. The 5-minute cron means any
 *   previously-missed window fires on the next run after recovery.
 *
 * @param todayISO  MYT calendar date, e.g. '2026-06-19'
 * @param minHourMyt  earliest MYT hour to allow sends (9 = 09:00)
 * @param nowHourMyt  current MYT hour (0-23)
 */
export function selectDispatches(
  todayISO: string,
  minHourMyt: number,
  nowHourMyt: number,
): Dispatch[] {
  // Hard MYT gate: do nothing before 09:00 MYT.
  if (nowHourMyt < minHourMyt) return []

  const items = db
    .select()
    .from(recurringItems)
    .where(eq(recurringItems.is_active, true))
    .all()

  const out: Dispatch[] = []

  for (const item of items) {
    if (!item.next_due_date) continue

    const offset = daysUntil(todayISO, item.next_due_date)
    const win = dueWindow(offset) // 'today'|'1-day'|'3-day'|null

    // Only act on items in a reminder window (today, 1 day out, or 3 days out).
    // Catch-up: items due today (offset 0) are always included regardless of
    // how late in the day — the run is idempotent via notifications_sent.
    if (!win) continue

    const scheduledFor = item.next_due_date

    if (item.direction === 'income') {
      // Payday prompt: only on income day itself (offset 0 / 'today' window).
      if (win !== 'today') continue
      if (alreadySent('payday_save', item.id, scheduledFor)) continue

      const remaining = currentCycleSavingsRemainingSen(todayISO)
      const suggested = suggestedSavingsSen(remaining)
      out.push({
        kind: 'payday_save',
        ref_id: item.id,
        scheduled_for: scheduledFor,
        payload: buildPaydayPayload(item.name, item.amount_cents, suggested, scheduledFor),
      })
    } else {
      // Expense (bill) reminder.
      if (alreadySent('bill_due', item.id, scheduledFor)) continue

      // SPayLater: compute postedCount to pass to buildBillDuePayload so it shows
      // arr[postedCount] (declining amount) not arr[0] (4.5 contract).
      const postedCount = item.remaining_installments_json
        ? countPostedInstallments(item.id)
        : 0

      // Skip SPayLater items where all installments are already posted.
      if (item.remaining_installments_json) {
        const next = spayLaterNextAmount(item.remaining_installments_json, postedCount)
        if (next === null) continue // all done
      }

      out.push({
        kind: 'bill_due',
        ref_id: item.id,
        scheduled_for: scheduledFor,
        payload: buildBillDuePayload(item, win, postedCount),
      })
    }
  }

  return out
}

/**
 * Insert a notifications_sent row for (kind, ref_id, scheduled_for).
 * Returns true on success, false if the UNIQUE constraint fires (duplicate claim).
 */
export function markSent(kind: string, ref_id: number, scheduled_for: string): boolean {
  try {
    db.insert(notificationsSent)
      .values({ kind: kind as any, ref_id, scheduled_for, sent_at: Date.now() })
      .run()
    return true
  } catch {
    // UNIQUE(kind, ref_id, scheduled_for) violated → a concurrent run already claimed it.
    return false
  }
}

/**
 * Orchestrator: select → claim (synchronous) → fan-out (async push I/O).
 * The markSent claim is a synchronous DB insert; push I/O happens strictly outside
 * any db.transaction so a failed push does not rollback the claim.
 */
export async function runDispatch(): Promise<{ sent: number; skipped: number }> {
  const today = todayMYT()
  const nowHour = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }),
  ).getHours()

  const dispatches = selectDispatches(today, 9, nowHour)

  let sent = 0
  let skipped = 0

  for (const d of dispatches) {
    // Claim BEFORE sending. Synchronous — no await — so a concurrent run sees the row immediately.
    if (!markSent(d.kind, d.ref_id, d.scheduled_for)) {
      skipped++
      continue
    }
    // Push I/O is entirely outside any db.transaction.
    await sendToAll(d.payload)
    sent++
  }

  return { sent, skipped }
}
