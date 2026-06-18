// server/db/schema.test.ts
import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import * as schema from './schema'

describe('schema — all 9 v1 tables present', () => {
  const tables = ['accounts', 'debts', 'recurringItems', 'transactions',
    'goals', 'pushSubscriptions', 'notificationsSent', 'users', 'sessions'] as const
  for (const t of tables) {
    it(`exports ${t}`, () => {
      expect((schema as any)[t]).toBeDefined()
    })
  }
})

describe('schema — §14 binding corrections', () => {
  it('accounts has available_credit_cents (derived) and credit_limit_cents', () => {
    const cols = getTableColumns(schema.accounts)
    expect(cols.available_credit_cents).toBeDefined()
    expect(cols.credit_limit_cents).toBeDefined()
  })
  it('debts has payoff_baseline_cents (frozen baseline)', () => {
    expect(getTableColumns(schema.debts).payoff_baseline_cents).toBeDefined()
  })
  it('debts has remaining_installments_json and never_prepay', () => {
    const cols = getTableColumns(schema.debts)
    expect(cols.remaining_installments_json).toBeDefined()
    expect(cols.never_prepay).toBeDefined()
  })
  it('transactions.category enum includes "other"', () => {
    const cat = getTableColumns(schema.transactions).category as any
    expect(cat.enumValues).toContain('other')
    expect(cat.enumValues).toContain('interest')
  })
  it('transactions has is_estimate boolean and uuid', () => {
    const cols = getTableColumns(schema.transactions)
    expect(cols.is_estimate).toBeDefined()
    expect(cols.uuid).toBeDefined()
  })
  it('recurringItems has next_due_date and auto_post', () => {
    const cols = getTableColumns(schema.recurringItems)
    expect(cols.next_due_date).toBeDefined()
    expect(cols.auto_post).toBeDefined()
  })
  it('sessions has session_epoch and users has password_hash', () => {
    expect(getTableColumns(schema.sessions).session_epoch).toBeDefined()
    expect(getTableColumns(schema.users).password_hash).toBeDefined()
  })
})
