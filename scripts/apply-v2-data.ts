// scripts/apply-v2-data.ts
// One-time, IDEMPOTENT, no-data-loss data fix for an EXISTING deployed DB.
// Brings a v1-seeded database up to the v2 corrected state WITHOUT re-seeding
// (preserves the login user, logged transactions, balances, budgets, etc.):
//   1. Seeds the holdings list (AIA / GE / ASNB) — only if the holdings table is empty.
//   2. GE ILP recurring template → is_active (the user is still paying RM350/mo).
//   3. Unifi recurring template → due day 10 (was 19).
//   4. Splits the single "Subscriptions" bundle into Netflix / Spotify / YouTube Premium,
//      bank-funded (flipped off the credit card), with their real due dates.
// Safe to run multiple times — every step is guarded. Usage: `npm run apply:v2-data`.
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { createDb } from '../server/db/index'
import { runMigrations } from '../server/db/migrate'
import { holdings, recurringItems, accounts } from '../server/db/schema'
import { todayMYT, nextDueDate, nowEpoch } from '../server/utils/mytDate'

type Db = BetterSQLite3Database<Record<string, unknown>>

// Mirrors server/db/seed.ts §15 holdings (≈ RM143,649.97).
const HOLDING_ROWS = [
  { name: 'ASN Sara 1',            institution: 'ASNB',          kind: 'savings'    as const, current_value_cents: 2600,    liquid: true,  note: null,                                                                          sort_order: 1 },
  { name: 'ASN Equity 5',          institution: 'ASNB',          kind: 'savings'    as const, current_value_cents: 10124,   liquid: true,  note: null,                                                                          sort_order: 2 },
  { name: 'ASM 3',                 institution: 'ASNB',          kind: 'savings'    as const, current_value_cents: 20000,   liquid: true,  note: null,                                                                          sort_order: 3 },
  { name: 'A-LifeJoy',             institution: 'AIA',           kind: 'investment' as const, current_value_cents: 534080,  liquid: false, note: 'Investment-linked — keep',                                                   sort_order: 4 },
  { name: 'AIA Assurance Account', institution: 'AIA',           kind: 'investment' as const, current_value_cents: 6352297, liquid: true,  note: 'May allow low-penalty partial withdrawal — the lever to clear the 18% card', sort_order: 5 },
  { name: 'Empower Edu Plan',      institution: 'AIA',           kind: 'investment' as const, current_value_cents: 7303270, liquid: false, note: 'Locked — education purpose; do not surrender',                              sort_order: 6 },
  { name: 'GE Critical Illness',   institution: 'Great Eastern', kind: 'insurance'  as const, current_value_cents: 142626,  liquid: false, note: 'Protection — keep',                                                          sort_order: 7 },
]

const SPLIT_SUBS = [
  { name: 'Netflix',         amount_cents: 5000, day: 8 },
  { name: 'Spotify',         amount_cents: 2000, day: 2 },
  { name: 'YouTube Premium', amount_cents: 1200, day: 2 },
]

export function applyV2Data(db: Db): string[] {
  const out: string[] = []
  const ts = nowEpoch()
  const today = todayMYT()

  // 1. Holdings — seed only if empty (preserves any the user already added/edited).
  if (db.select().from(holdings).all().length === 0) {
    for (const h of HOLDING_ROWS) db.insert(holdings).values({ ...h, created_at: ts, updated_at: ts }).run()
    out.push(`seeded ${HOLDING_ROWS.length} holdings (~RM143,649.97)`)
  } else {
    out.push('holdings: already present — skipped')
  }

  // 2. GE ILP → active (still being paid; modelling it paused understates Safe-to-Spend).
  const ilp = db.select().from(recurringItems).where(eq(recurringItems.name, 'GE ILP')).get() as any
  if (ilp && !ilp.is_active) {
    db.update(recurringItems)
      .set({ is_active: true, next_due_date: nextDueDate(today, ilp.day_of_month ?? 17), updated_at: ts })
      .where(eq(recurringItems.id, ilp.id)).run()
    out.push('GE ILP → active')
  } else {
    out.push('GE ILP: already active or absent — skipped')
  }

  // 3. Unifi → due day 10.
  const unifi = db.select().from(recurringItems).where(eq(recurringItems.name, 'Unifi')).get() as any
  if (unifi && unifi.day_of_month !== 10) {
    db.update(recurringItems)
      .set({ day_of_month: 10, next_due_date: nextDueDate(today, 10), updated_at: ts })
      .where(eq(recurringItems.id, unifi.id)).run()
    out.push('Unifi → due day 10')
  } else {
    out.push('Unifi: already day 10 or absent — skipped')
  }

  // 4. Split "Subscriptions" bundle → 3 bank-funded items (only if not already split).
  const alreadySplit = db.select().from(recurringItems).where(eq(recurringItems.name, 'Netflix')).get()
  const bundle = db.select().from(recurringItems).where(eq(recurringItems.name, 'Subscriptions')).get() as any
  if (!alreadySplit && bundle) {
    // Fund the splits from the primary bank (first 'bank'-type account = Main Bank); never the card.
    const bank = db.select().from(accounts).where(eq(accounts.type, 'bank')).get() as any
    const bankId = bank?.id ?? bundle.funding_account_id
    db.delete(recurringItems).where(eq(recurringItems.id, bundle.id)).run()
    for (const s of SPLIT_SUBS) {
      db.insert(recurringItems).values({
        name: s.name, direction: 'expense', amount_cents: s.amount_cents, is_variable: false,
        cadence: 'monthly', day_of_month: s.day, category: 'bills', funding_account_id: bankId,
        debt_id: null, auto_post: true, is_active: true, start_date: today, end_date: null,
        remaining_occurrences: null, remaining_installments_json: null,
        next_due_date: nextDueDate(today, s.day), created_at: ts, updated_at: ts,
      }).run()
    }
    out.push('split "Subscriptions" → Netflix/Spotify/YouTube Premium (bank-funded)')
  } else {
    out.push(alreadySplit ? 'subscriptions: already split — skipped' : 'subscriptions: no bundle to split — skipped')
  }

  return out
}

// CLI entry: `npm run apply:v2-data` (or `npx tsx scripts/apply-v2-data.ts`). Reads DATABASE_URL.
if (process.argv[1] && process.argv[1].endsWith('apply-v2-data.ts')) {
  const path = (process.env.DATABASE_URL ?? 'file:./data/money.sqlite').replace(/^file:/, '')
  const handle = createDb(path)
  runMigrations(handle.sqlite) // ensure holdings + money_move_state tables exist
  const log = handle.db.transaction((tx: Db) => applyV2Data(tx))
  console.log('apply-v2-data:')
  for (const l of log) console.log('  •', l)
  handle.sqlite.close()
  console.log('Done — existing data preserved.')
}
