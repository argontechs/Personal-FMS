// test/server/utils/dispatchRun.test.ts
// DATABASE_URL=':memory:' set in vitest.config.ts (node project).
// Tests: MYT gate, idempotency, catch-up, SPayLater by postedCount,
//        payday single savings target, fan-out resilience.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sqlite, db } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import {
  recurringItems, notificationsSent, pushSubscriptions, transactions, accounts, goals,
} from '../../../server/db/schema'
import { selectDispatches, markSent } from '../../../server/utils/dispatchRun'

// Hoist web-push mock before module imports so sendPush sees the mock.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

beforeAll(() => {
  runMigrations(sqlite)
})

// ─── Seed helpers ────────────────────────────────────────────────────────────

function seedItem(over: Partial<typeof recurringItems.$inferInsert> = {}) {
  const now = Date.now()
  const [row] = db.insert(recurringItems).values({
    name: 'Unifi',
    direction: 'expense',
    amount_cents: 15000,
    category: 'bills',
    cadence: 'monthly',
    day_of_month: 19,
    start_date: '2026-01-01',
    next_due_date: '2026-06-21',
    is_active: true,
    auto_post: true,
    created_at: now,
    updated_at: now,
    ...over,
  }).returning().all()
  return row.id as number
}

function seedSubscription(endpoint: string) {
  db.insert(pushSubscriptions).values({
    endpoint,
    p256dh: 'ppp',
    auth: 'aaa',
    created_at: Date.now(),
  }).run()
}

function seedEfGoal() {
  const [acct] = db.insert(accounts).values({
    name: 'EF', type: 'savings', balance_cents: 0,
    created_at: Date.now(), updated_at: Date.now(),
  }).returning().all()
  db.insert(goals).values({
    name: 'Emergency Fund', type: 'savings', target_amount_cents: 100000,
    account_id: acct.id as number, status: 'active',
    created_at: Date.now(), updated_at: Date.now(),
  }).run()
}

beforeEach(() => {
  db.delete(notificationsSent).run()
  db.delete(transactions).run()
  db.delete(recurringItems).run()
  db.delete(pushSubscriptions).run()
  db.delete(goals).run()
  db.delete(accounts).run()
})

// ─── MYT gate ────────────────────────────────────────────────────────────────

describe('selectDispatches — MYT hour gate', () => {
  it('returns [] when nowHourMyt < minHourMyt (before 09:00)', () => {
    seedItem({ next_due_date: '2026-06-21' }) // 3 days out from 2026-06-18
    const out = selectDispatches('2026-06-18', 9, 8)
    expect(out).toHaveLength(0)
  })

  it('returns dispatches when nowHourMyt === minHourMyt (exactly 09:00)', () => {
    seedItem({ next_due_date: '2026-06-21' }) // 3 days out
    const out = selectDispatches('2026-06-18', 9, 9)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
  })

  it('returns dispatches when nowHourMyt > minHourMyt (afternoon)', () => {
    seedItem({ next_due_date: '2026-06-21' }) // 3 days out
    const out = selectDispatches('2026-06-18', 9, 15)
    expect(out).toHaveLength(1)
  })
})

// ─── Reminder window selection ────────────────────────────────────────────────

describe('selectDispatches — bill reminder windows', () => {
  it('selects a bill exactly 3 days out', () => {
    seedItem({ next_due_date: '2026-06-21' })
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
    expect(out[0].scheduled_for).toBe('2026-06-21')
  })

  it('selects a bill exactly 1 day out', () => {
    seedItem({ next_due_date: '2026-06-19' })
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
  })

  it('selects a bill due today', () => {
    seedItem({ next_due_date: '2026-06-18' })
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
  })

  it('does NOT select a bill 2 days out (not a reminder day)', () => {
    seedItem({ next_due_date: '2026-06-20' }) // 2 days out
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(0)
  })

  it('does NOT select an inactive item', () => {
    seedItem({ next_due_date: '2026-06-21', is_active: false })
    expect(selectDispatches('2026-06-18', 9, 10)).toHaveLength(0)
  })

  // v2: reminder-only items (auto_post=false) are NOT auto-deducted, so the due-date
  // reminder is the ONLY signal the user gets — it MUST still fire.
  it('selects a reminder-only (auto_post=false) bill in a due window', () => {
    seedItem({ name: 'Rent', next_due_date: '2026-06-21', auto_post: false })
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
    expect(out[0].payload.title).toContain('Rent')
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('selectDispatches — idempotency (notifications_sent)', () => {
  it('does NOT re-select a bill already in notifications_sent', () => {
    seedItem({ next_due_date: '2026-06-18' })
    const first = selectDispatches('2026-06-18', 9, 9)
    expect(first).toHaveLength(1)
    // Simulate the dispatch runner claiming the send.
    markSent(first[0].kind, first[0].ref_id, first[0].scheduled_for)
    // Second select on the same run → empty.
    expect(selectDispatches('2026-06-18', 9, 9)).toHaveLength(0)
  })

  it('markSent returns true on first insert, false on duplicate (lost race)', () => {
    expect(markSent('bill_due', 1, '2026-06-18')).toBe(true)
    expect(markSent('bill_due', 1, '2026-06-18')).toBe(false)
  })

  it('same item on a different date is NOT blocked by yesterday\'s sent row', () => {
    const id = seedItem({ next_due_date: '2026-06-21' })
    markSent('bill_due', id, '2026-06-18') // yesterday's reminder for a different date
    const out = selectDispatches('2026-06-18', 9, 9)
    // scheduled_for='2026-06-21' ≠ '2026-06-18' → not blocked
    expect(out).toHaveLength(1)
  })
})

// ─── Catch-up ────────────────────────────────────────────────────────────────

describe('selectDispatches — catch-up after downtime', () => {
  it('selects a today-due bill even at 23:00 when no sent row exists', () => {
    seedItem({ next_due_date: '2026-06-18' })
    // Simulate late-day run after downtime — still no notifications_sent row.
    const out = selectDispatches('2026-06-18', 9, 23)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('bill_due')
  })

  it('catch-up is blocked once the row is in notifications_sent (no double-send)', () => {
    seedItem({ next_due_date: '2026-06-18' })
    const first = selectDispatches('2026-06-18', 9, 23)
    markSent(first[0].kind, first[0].ref_id, first[0].scheduled_for)
    expect(selectDispatches('2026-06-18', 9, 23)).toHaveLength(0)
  })
})

// ─── SPayLater by postedCount ─────────────────────────────────────────────────

describe('selectDispatches — SPayLater uses postedCount (declining amount)', () => {
  it('shows arr[0] when no auto transactions exist (postedCount=0)', () => {
    const json = '[151950,83682,63165,57307]'
    seedItem({ name: 'ShopeePayLater', amount_cents: 0, remaining_installments_json: json, next_due_date: '2026-06-21' })
    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    expect(out[0].payload.body).toContain('RM1,519.50') // arr[0]
  })

  it('shows arr[3] (not arr[0]) when 3 installments already auto-posted', () => {
    const now = Date.now()
    const json = '[151950,83682,63165,57307,48212]'
    const [tpl] = db.insert(recurringItems).values({
      name: 'ShopeePayLater', direction: 'expense', amount_cents: 0,
      category: 'debt', cadence: 'monthly', day_of_month: 21,
      start_date: '2026-01-01', next_due_date: '2026-06-21',
      is_active: true, auto_post: true, remaining_installments_json: json,
      created_at: now, updated_at: now,
    }).returning().all()
    const itemId = tpl.id as number

    // Seed 3 auto-posted transactions to simulate 3 completed installments.
    const [bank] = db.insert(accounts).values({
      name: 'Bank', type: 'bank', balance_cents: 500000, created_at: now, updated_at: now,
    }).returning().all()
    const installments = JSON.parse(json) as number[]
    for (let i = 0; i < 3; i++) {
      db.insert(transactions).values({
        uuid: `spay-auto-${i}`, date: `2026-0${3 + i}-21`,
        amount_cents: -installments[i], direction: 'expense', category: 'debt',
        account_id: bank.id as number, source: 'auto', recurring_item_id: itemId,
        created_at: now,
      }).run()
    }

    const out = selectDispatches('2026-06-18', 9, 10)
    expect(out).toHaveLength(1)
    // arr[3] = 57307 sen = RM573.07
    expect(out[0].payload.body).toContain('RM573.07')
    expect(out[0].payload.body).not.toContain('RM1,519.50')
  })

  it('does NOT select SPayLater when all installments are posted (postedCount >= arr.length)', () => {
    const now = Date.now()
    const json = '[151950]' // single installment
    const [tpl] = db.insert(recurringItems).values({
      name: 'ShopeePayLater', direction: 'expense', amount_cents: 0,
      category: 'debt', cadence: 'monthly', day_of_month: 21,
      start_date: '2026-01-01', next_due_date: '2026-06-21',
      is_active: true, auto_post: true, remaining_installments_json: json,
      created_at: now, updated_at: now,
    }).returning().all()
    const [bank] = db.insert(accounts).values({
      name: 'Bank', type: 'bank', balance_cents: 200000, created_at: now, updated_at: now,
    }).returning().all()
    // All 1 installment already posted.
    db.insert(transactions).values({
      uuid: 'spay-done', date: '2026-05-21',
      amount_cents: -151950, direction: 'expense', category: 'debt',
      account_id: bank.id as number, source: 'auto', recurring_item_id: tpl.id as number,
      created_at: now,
    }).run()

    expect(selectDispatches('2026-06-18', 9, 10)).toHaveLength(0)
  })
})

// ─── Payday single savings target ────────────────────────────────────────────

describe('selectDispatches — payday_save uses single savings target', () => {
  it('emits a payday_save with the three action buttons on income day', () => {
    seedEfGoal()
    const now = Date.now()
    db.insert(recurringItems).values({
      name: 'Side Income A', direction: 'income', amount_cents: 60000, category: 'income',
      cadence: 'monthly', day_of_month: 23, start_date: '2026-01-01',
      next_due_date: '2026-06-23', is_active: true, auto_post: true,
      created_at: now, updated_at: now,
    }).run()

    const out = selectDispatches('2026-06-23', 9, 9)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('payday_save')
    expect(out[0].payload.actions?.map(a => a.action)).toEqual(['transfer', 'adjust', 'skip'])
  })

  it('payday_save body contains the single per-cycle target (16667 sen = RM166.67)', () => {
    seedEfGoal()
    const now = Date.now()
    db.insert(recurringItems).values({
      name: 'Salary', direction: 'income', amount_cents: 500000, category: 'income',
      cadence: 'monthly', day_of_month: 3, start_date: '2026-01-01',
      next_due_date: '2026-06-03', is_active: true, auto_post: true,
      created_at: now, updated_at: now,
    }).run()

    const out = selectDispatches('2026-06-03', 9, 9)
    expect(out).toHaveLength(1)
    // suggestedSavingsSen(16667) = 16667 → formatRM = RM166.67
    expect(out[0].payload.body).toContain('RM166.67')
  })

  it('payday_save suggested = 0 (RM0.00) when EF goal is not active (attack phase)', () => {
    // No EF goal seeded → currentCycleSavingsRemainingSen returns 0
    const now = Date.now()
    db.insert(recurringItems).values({
      name: 'Salary', direction: 'income', amount_cents: 500000, category: 'income',
      cadence: 'monthly', day_of_month: 3, start_date: '2026-01-01',
      next_due_date: '2026-06-03', is_active: true, auto_post: true,
      created_at: now, updated_at: now,
    }).run()

    const out = selectDispatches('2026-06-03', 9, 9)
    expect(out).toHaveLength(1)
    expect(out[0].payload.body).toContain('RM0.00')
  })

  it('does NOT emit payday_save for an income item NOT due today (3-day window excluded)', () => {
    const now = Date.now()
    db.insert(recurringItems).values({
      name: 'Salary', direction: 'income', amount_cents: 500000, category: 'income',
      cadence: 'monthly', day_of_month: 21, start_date: '2026-01-01',
      next_due_date: '2026-06-21', is_active: true, auto_post: true,
      created_at: now, updated_at: now,
    }).run()
    // today is 2026-06-18 → 3 days out for income, must NOT trigger payday prompt
    const out = selectDispatches('2026-06-18', 9, 9)
    expect(out).toHaveLength(0)
  })
})

// ─── Fan-out resilience ───────────────────────────────────────────────────────

describe('sendToAll — fan-out resilience', () => {
  it('delivers to two subscriptions; one 410 does not block the other', async () => {
    const webpush = (await import('web-push')).default
    const mockSend = vi.mocked(webpush.sendNotification)

    seedSubscription('https://push/ok')
    seedSubscription('https://push/dead')

    // First call succeeds, second throws 410.
    mockSend
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(Object.assign(new Error('Expired'), { statusCode: 410 }))

    const { sendToAll } = await import('../../../server/utils/sendToAll')
    const r = await sendToAll({ title: 'T', body: 'B', url: '/', tag: 'x' })

    // 1 delivered + 1 pruned; the ok one was NOT blocked.
    expect(r.delivered).toBe(1)
    expect(r.pruned).toBe(1)
  })

  it('delivers to zero subscriptions when table is empty', async () => {
    const { sendToAll } = await import('../../../server/utils/sendToAll')
    const r = await sendToAll({ title: 'T', body: 'B', url: '/', tag: 'x' })
    expect(r.delivered).toBe(0)
    expect(r.pruned).toBe(0)
  })

  it('skips already-failed subscriptions (failed_at set)', async () => {
    const webpush = (await import('web-push')).default
    vi.mocked(webpush.sendNotification).mockResolvedValue({} as any)

    db.insert(pushSubscriptions).values({
      endpoint: 'https://push/failed', p256dh: 'p', auth: 'a',
      created_at: Date.now(), failed_at: 999,
    }).run()

    const { sendToAll } = await import('../../../server/utils/sendToAll')
    const r = await sendToAll({ title: 'T', body: 'B', url: '/', tag: 'x' })
    expect(r.delivered).toBe(0)
  })
})

// ─── Canary endpoint ─────────────────────────────────────────────────────────

describe('canary endpoint — session gate', () => {
  it('rejects without a session cookie (401)', async () => {
    // Build a real h3 event from Node.js http objects (no Nuxt runtime needed).
    const http = await import('node:http')
    const { createEvent } = await import('h3')
    const req = new http.IncomingMessage(null as any)
    req.method = 'POST'
    req.url = '/api/push/canary'
    req.headers = {}
    const res = new http.ServerResponse(req)
    const event = createEvent(req, res)

    // The handler calls requireSession which throws {statusCode:401} when no cookie.
    const handler = (await import('../../../server/api/push/canary.post')).default
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 })
  })
})
