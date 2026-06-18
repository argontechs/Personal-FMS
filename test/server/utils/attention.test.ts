import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { db, sqlite, recurringItems, pushSubscriptions } from '../../../server/db'
import { runMigrations } from '../../../server/db/migrate'
import { collectAttention, renderAttentionEmail, pushHealthSignal } from '../../../server/utils/attention'

beforeAll(() => { runMigrations(sqlite) })
beforeEach(() => { db.delete(recurringItems).run(); db.delete(pushSubscriptions).run() })

describe('attention / health', () => {
  it('lists bills due within 7 days', () => {
    db.insert(recurringItems).values({
      name: 'Unifi', direction: 'expense', amount_cents: 15000, category: 'bills',
      cadence: 'monthly', day_of_month: 19, start_date: '2026-01-01',
      next_due_date: '2026-06-22', is_active: true, auto_post: true, created_at: 1, updated_at: 1,
    }).run()
    const out = collectAttention('2026-06-18')
    expect(out.some(i => i.line.includes('Unifi') && i.line.includes('RM150.00'))).toBe(true)
  })

  it('adds a channel-broken line when there are no healthy subscriptions', () => {
    const out = collectAttention('2026-06-18')
    expect(out.some(i => i.line.toLowerCase().includes('reminders are off'))).toBe(true)
  })

  it('pushHealthSignal counts only non-failed subscriptions', () => {
    db.insert(pushSubscriptions).values({ endpoint: 'a', p256dh: 'x', auth: 'y', created_at: 1 }).run()
    db.insert(pushSubscriptions).values({ endpoint: 'b', p256dh: 'x', auth: 'y', created_at: 1, failed_at: 99 }).run()
    const h = pushHealthSignal()
    expect(h.healthySubscriptions).toBe(1)
    expect(h.channelOk).toBe(true)
  })

  it('renderAttentionEmail produces a subject and a bulleted body', () => {
    const { subject, text } = renderAttentionEmail([{ line: 'Unifi RM150.00 due 2026-06-22' }])
    expect(subject).toContain('What needs your attention')
    expect(text).toContain('- Unifi RM150.00 due 2026-06-22')
  })
})
