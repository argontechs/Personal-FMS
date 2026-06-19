import { describe, it, expect, afterEach } from 'vitest'
import { createDb } from './index'
import { runMigrations } from './migrate'

describe('runMigrations', () => {
  let handle: ReturnType<typeof createDb>
  afterEach(() => handle?.sqlite.close())

  it('creates all 12 tables', () => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    const rows = handle.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`)
      .all() as { name: string }[]
    const names = rows.map((r) => r.name).sort()
    expect(names).toEqual([
      'accounts', 'budgets', 'debts', 'goals', 'holdings', 'money_move_state', 'notifications_sent',
      'push_subscriptions', 'recurring_items', 'sessions', 'transactions', 'users',
    ])
  })

  it('enforces the transactions.uuid UNIQUE constraint', () => {
    handle = createDb(':memory:')
    runMigrations(handle.sqlite)
    const insert = handle.sqlite.prepare(
      `INSERT INTO transactions (uuid,date,amount_cents,direction,category,account_id,is_estimate,source,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    // need a parent account for the FK
    handle.sqlite.prepare(
      `INSERT INTO accounts (id,name,type,balance_cents,currency,is_active,sort_order,created_at,updated_at)
       VALUES (1,'Bank','bank',0,'MYR',1,0,0,0)`,
    ).run()
    insert.run('dup-uuid', '2026-06-18', -500, 'expense', 'food', 1, 0, 'manual', 0)
    expect(() => insert.run('dup-uuid', '2026-06-18', -500, 'expense', 'food', 1, 0, 'manual', 0))
      .toThrow(/UNIQUE/i)
  })
})
