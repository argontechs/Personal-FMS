// test/server/habit/month-boundary.test.ts
// Month-boundary correctness test for next_due_date recompute.
// Verifies: day-31 clamps to 28/29 in Feb, 30 in 30-day months;
// dispatcher fires exactly once across MYT 23:30→00:30 boundary.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sqlite, db } from '../../../server/db/index'
import { runMigrations } from '../../../server/db/migrate'
import { recurringItems, notificationsSent } from '../../../server/db/schema'
import { selectDispatches, markSent } from '../../../server/utils/dispatchRun'
import { clampDay, nextDueDate } from '../../../server/utils/mytDate'

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

beforeEach(() => {
  db.delete(notificationsSent).run()
  db.delete(recurringItems).run()
})

describe('month-boundary correctness', () => {
  it('clampDay clamps day 31 into February (non-leap and leap)', () => {
    expect(clampDay(2027, 2, 31)).toBe(28) // 2027 is non-leap
    expect(clampDay(2028, 2, 31)).toBe(29) // 2028 is leap
    expect(clampDay(2026, 4, 31)).toBe(30) // April has 30 days
  })

  it('nextDueDate clamps to the last day of the month and advances correctly', () => {
    // from 2027-02-15, a day-31 bill is due 2027-02-28 (clamped, non-leap)
    expect(nextDueDate('2027-02-15', 31)).toBe('2027-02-28')
    // ON Feb 28 (the clamped day), should return Feb 28
    expect(nextDueDate('2027-02-28', 31)).toBe('2027-02-28')
    // After Feb 28, next month's due is 2027-03-31
    expect(nextDueDate('2027-03-01', 31)).toBe('2027-03-31')

    // Leap year: Feb clamps to 29
    expect(nextDueDate('2028-02-15', 31)).toBe('2028-02-29')
    // ON Feb 29 (the clamped day in leap year), should return Feb 29
    expect(nextDueDate('2028-02-29', 31)).toBe('2028-02-29')
    // After Feb 29, next month's due is 2028-03-31
    expect(nextDueDate('2028-03-01', 31)).toBe('2028-03-31')

    // 30-day month (April): clamps to 30
    expect(nextDueDate('2027-04-15', 31)).toBe('2027-04-30')
    // ON Apr 30 (the clamped day), should return Apr 30
    expect(nextDueDate('2027-04-30', 31)).toBe('2027-04-30')
    // After Apr 30, next month's due is 2027-05-31
    expect(nextDueDate('2027-05-01', 31)).toBe('2027-05-31')
  })

  it('dispatcher fires exactly once across a 23:30→00:30 MYT boundary', () => {
    // PTPTN due_day:1 → next_due_date 2026-07-01; "today" run at 23:30 on 06-30 should not fire (not in window),
    // then the run just after midnight on 07-01 fires once and only once.
    const now = Date.now()
    db.insert(recurringItems).values({
      name: 'PTPTN',
      direction: 'expense',
      amount_cents: 27000,
      category: 'debt',
      cadence: 'monthly',
      day_of_month: 1,
      start_date: '2026-01-01',
      next_due_date: '2026-07-01',
      is_active: true,
      auto_post: true,
      created_at: now,
      updated_at: now,
    }).run()

    // 23:30 on 06-30 (offset = 1 day → '1-day' window) — fires once
    const lateNight = selectDispatches('2026-06-30', 9, 23)
    expect(lateNight).toHaveLength(1)
    markSent(lateNight[0].kind, lateNight[0].ref_id, lateNight[0].scheduled_for)

    // 00:30 on 07-01 (offset = 0 → 'today') — different window but SAME scheduled_for → deduped, no double fire
    const afterMidnight = selectDispatches('2026-07-01', 9, 0)
    expect(afterMidnight).toHaveLength(0)
  })

  it('day-3 salary template advances correctly across month boundaries', () => {
    // Salary on day 3: from 2027-02-28 (past day 3), next due should be 2027-03-03
    expect(nextDueDate('2027-02-28', 3)).toBe('2027-03-03')

    // From 2027-03-03 (on day 3), should return same day
    expect(nextDueDate('2027-03-03', 3)).toBe('2027-03-03')

    // From 2027-03-04 (past day 3), next due is 2027-04-03
    expect(nextDueDate('2027-03-04', 3)).toBe('2027-04-03')

    // Leap year: from 2028-02-29 (past day 3), next due should be 2028-03-03
    expect(nextDueDate('2028-02-29', 3)).toBe('2028-03-03')
  })

  it('no skip or duplicate when advancing across month boundary', () => {
    // Create a day-31 expense item
    const now = Date.now()
    const [item] = db
      .insert(recurringItems)
      .values({
        name: 'Credit Card',
        direction: 'expense',
        amount_cents: 50000,
        category: 'cards',
        cadence: 'monthly',
        day_of_month: 31,
        start_date: '2027-01-31',
        next_due_date: '2027-02-28', // clamped to last day of Feb (non-leap)
        is_active: true,
        auto_post: true,
        created_at: now,
        updated_at: now,
      })
      .returning()
      .all()

    // On Feb 28 (the clamped day), should return Feb 28 itself
    const dueFeb = nextDueDate('2027-02-28', 31)
    expect(dueFeb).toBe('2027-02-28')

    // After Feb 28, the next due should be Mar 31 (no skip, no duplicate)
    const nextDue = nextDueDate('2027-03-01', 31)
    expect(nextDue).toBe('2027-03-31')

    // Verify no gap: Mar 31 is present and unique (not Mar 30 or Apr 1)
    expect(nextDue).not.toBe('2027-03-30')
    expect(nextDue).not.toBe('2027-04-01')
  })
})
