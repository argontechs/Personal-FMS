// test/server/api/reconcile.test.ts
// E2E integration tests for reconciling REAL balances vs computed:
//   - any spendable account via POST /api/accounts/correct-cash (returns drift)
//   - the CREDIT CARD via POST /api/debts/card/reconcile (adjusts debt; baseline preserved)
// Single-ledger authority: balances move ONLY via 'adjustment' ledger rows.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { setup, $fetch, fetch as nitroFetch } from '@nuxt/test-utils/e2e'
import { createDb } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { bootstrapUser } from '../../../scripts/seed-user'
import { accounts, debts, transactions } from '../../../server/db/schema'
import { recomputeBalances } from '../../../server/utils/post'

const TEST_DB = './data/reconcile-test.sqlite'
process.env.DATABASE_URL = `file:${TEST_DB}`
process.env.NUXT_SESSION_PASSWORD = process.env.NUXT_SESSION_PASSWORD || 'reconcile-test-pass-32-chars-long!'

let bankId: number
let cardAccId: number
let cardDebtId: number
const CARD_BASELINE = 800000
let handle: ReturnType<typeof createDb>
let sessionCookie: string

beforeAll(async () => {
  for (const ext of ['', '-shm', '-wal']) {
    const p = `${TEST_DB}${ext}`
    if (existsSync(p)) rmSync(p)
  }
  handle = createDb(TEST_DB)
  runMigrations(handle.sqlite)
  await bootstrapUser(handle.db, 'reconowner', 'recon-pass-123')

  const now = Date.now()

  // Bank account — opening balance via a LEDGER adjustment row (single-ledger authority),
  // so recomputeBalances() reproduces the balance from the ledger.
  const [b] = handle.db.insert(accounts).values({
    name: 'Bank', type: 'bank' as any, balance_cents: 75000, created_at: now, updated_at: now,
  }).returning().all()
  bankId = b.id as number

  // Credit-card DEBT: frozen payoff baseline 800000.
  const [d] = handle.db.insert(debts).values({
    name: 'Credit Card', type: 'revolving' as any, balance_cents: 740000,
    payoff_baseline_cents: CARD_BASELINE, rate_type: 'apr' as any, apr_bps: 1800,
    bt_status: 'none' as any, created_at: now, updated_at: now,
  }).returning().all()
  cardDebtId = d.id as number

  // Card ACCOUNT mirror (balance = −debt = −740000), linked via debt_id.
  const [card] = handle.db.insert(accounts).values({
    name: 'Credit Card', type: 'card' as any, balance_cents: -740000,
    credit_limit_cents: 1000000, debt_id: cardDebtId, created_at: now, updated_at: now,
  }).returning().all()
  cardAccId = card.id as number

  // Opening-balance ledger rows so recompute parity holds (balances trace to the ledger):
  //   bank +75000 (account leg), card debt +740000 (debt-only leg, account_id null → mirror).
  handle.db.insert(transactions).values({
    uuid: `seed-bank-${bankId}`, date: '2026-06-01', amount_cents: 75000,
    direction: 'income' as any, category: 'adjustment' as any, account_id: bankId,
    source: 'adjustment' as any, created_at: now,
  }).run()
  handle.db.insert(transactions).values({
    uuid: `seed-carddebt-${cardDebtId}`, date: '2026-06-01', amount_cents: 740000,
    direction: 'expense' as any, category: 'adjustment' as any, account_id: null,
    debt_id: cardDebtId, source: 'adjustment' as any, created_at: now,
  }).run()
  handle.sqlite.close()
})

await setup({
  server: true,
  browser: false,
  env: {
    DATABASE_URL: `file:${TEST_DB}`,
    NUXT_SESSION_PASSWORD: process.env.NUXT_SESSION_PASSWORD,
  },
  nuxtConfig: { modules: [] },
})

async function getSessionCookie(): Promise<string> {
  if (sessionCookie) return sessionCookie
  const res = await nitroFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reconowner', password: 'recon-pass-123' }),
  })
  const setCookieHeader = res.headers.get('set-cookie') ?? ''
  sessionCookie = setCookieHeader.split(';')[0]
  return sessionCookie
}

async function authFetch(path: string, opts: Record<string, unknown> = {}): Promise<any> {
  const cookie = await getSessionCookie()
  return $fetch(path, { ...opts, headers: { ...((opts.headers as any) ?? {}), cookie } })
}

describe('reconcile — spendable account (correct-cash, generalized)', () => {
  it('(a) reconciles a bank account to a different real balance via an adjustment so recomputed balance == real, and reports the drift', async () => {
    // computed 75000 → real 90000 ⇒ delta +15000
    const res = await authFetch('/api/accounts/correct-cash', {
      method: 'POST', body: { account_id: bankId, target_cents: 90000 },
    })
    expect(res.computedCents).toBe(75000)
    expect(res.realCents).toBe(90000)
    expect(res.deltaCents).toBe(15000)

    const h = createDb(TEST_DB)
    const acc = h.db.select().from(accounts).all().find(a => a.id === bankId)!
    expect(acc.balance_cents).toBe(90000)

    // (d) reconcile posted exactly one NEW adjustment ledger row for the +15000 delta
    // (the +75000 row is the opening seed). No balance_cents was written directly.
    const adj = h.db.select().from(transactions).all()
      .filter(t => t.account_id === bankId && t.category === 'adjustment')
    const reconRow = adj.filter(t => t.amount_cents === 15000)
    expect(reconRow.length).toBe(1)
    expect(reconRow[0].source).toBe('adjustment')
    expect(adj.every(t => t.source === 'adjustment')).toBe(true)

    // Recompute parity: balance is derived purely from ledger rows.
    recomputeBalances(h.db)
    const recomputed = h.db.select().from(accounts).all().find(a => a.id === bankId)!
    expect(recomputed.balance_cents).toBe(90000)
    h.sqlite.close()
  })

  it('rejects a negative real balance on a spendable account (400)', async () => {
    try {
      await authFetch('/api/accounts/correct-cash', { method: 'POST', body: { account_id: bankId, target_cents: -1 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })
})

describe('reconcile — credit card (debt adjusts; baseline preserved)', () => {
  it('(b) reconciles the card to a real statement balance so recomputed card balance == real WITHOUT changing payoff_baseline_cents', async () => {
    // computed debt 740000 → real statement 755000 ⇒ delta +15000
    const res = await authFetch('/api/debts/card/reconcile', {
      method: 'POST', body: { real_cents: 755000 },
    })
    expect(res.computedCents).toBe(740000)
    expect(res.realCents).toBe(755000)
    expect(res.deltaCents).toBe(15000)

    const h = createDb(TEST_DB)
    // The reconcile adjustment is a debt-leg row (account_id null, debt_id set, +15000 delta);
    // the +740000 row is the opening seed. No debt balance_cents written directly.
    const adj = h.db.select().from(transactions).all()
      .filter(t => t.debt_id === cardDebtId && t.category === 'adjustment')
    const reconRow = adj.filter(t => t.amount_cents === 15000)
    expect(reconRow.length).toBe(1)
    expect(reconRow[0].source).toBe('adjustment')
    expect(reconRow[0].account_id).toBe(null)

    // Debt recomputes to the real balance; the mirror account follows (= −debt).
    recomputeBalances(h.db)
    const debt = h.db.select().from(debts).all().find(d => d.id === cardDebtId)!
    expect(debt.balance_cents).toBe(755000)
    // Baseline untouched — kill-the-card progress still measures against the original.
    expect(debt.payoff_baseline_cents).toBe(CARD_BASELINE)

    const cardAcc = h.db.select().from(accounts).all().find(a => a.id === cardAccId)!
    expect(cardAcc.balance_cents).toBe(-755000)
    h.sqlite.close()
  })

  it('reconciles the card DOWN to a lower real balance (negative delta)', async () => {
    // computed 755000 → real 700000 ⇒ delta −55000
    const res = await authFetch('/api/debts/card/reconcile', {
      method: 'POST', body: { real_cents: 700000 },
    })
    expect(res.deltaCents).toBe(-55000)

    const h = createDb(TEST_DB)
    recomputeBalances(h.db)
    const debt = h.db.select().from(debts).all().find(d => d.id === cardDebtId)!
    expect(debt.balance_cents).toBe(700000)
    expect(debt.payoff_baseline_cents).toBe(CARD_BASELINE)
    h.sqlite.close()
  })

  it('no-ops when card already on the real balance', async () => {
    const res = await authFetch('/api/debts/card/reconcile', { method: 'POST', body: { real_cents: 700000 } })
    expect(res.id).toBe(null)
    expect(res.adjustment_cents).toBe(0)
    expect(res.deltaCents).toBe(0)
  })

  it('(c) rejects negative real_cents with 400', async () => {
    try {
      await authFetch('/api/debts/card/reconcile', { method: 'POST', body: { real_cents: -100 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('(c) rejects over-ceiling real_cents with 400', async () => {
    try {
      await authFetch('/api/debts/card/reconcile', { method: 'POST', body: { real_cents: 10_000_000_001 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('(c) rejects non-integer real_cents with 400', async () => {
    try {
      await authFetch('/api/debts/card/reconcile', { method: 'POST', body: { real_cents: 123.45 } })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('(c) requires real_cents (400)', async () => {
    try {
      await authFetch('/api/debts/card/reconcile', { method: 'POST', body: {} })
      expect.fail('should have thrown 400')
    } catch (e: any) {
      expect(e.status).toBe(400)
    }
  })

  it('(c) 401 without session', async () => {
    try {
      await $fetch('/api/debts/card/reconcile', { method: 'POST', body: { real_cents: 700000 } })
      expect.fail('should have thrown 401')
    } catch (e: any) {
      expect(e.status).toBe(401)
    }
  })
})
