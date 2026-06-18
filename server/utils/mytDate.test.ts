import { describe, it, expect } from 'vitest'
import { todayMYT, nowEpoch, clampDay, nextDueDate } from './mytDate'

describe('mytDate', () => {
  it('todayMYT returns a YYYY-MM-DD string', () => {
    expect(todayMYT()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('nowEpoch returns a positive integer (UTC epoch ms)', () => {
    const e = nowEpoch()
    expect(Number.isInteger(e)).toBe(true)
    expect(e).toBeGreaterThan(1_700_000_000_000)
  })

  describe('clampDay — month-length boundaries', () => {
    it('clamps day 31 to 30 in a 30-day month (April)', () => {
      expect(clampDay(2026, 4, 31)).toBe(30)
    })
    it('clamps day 31 to 28 in non-leap February', () => {
      expect(clampDay(2026, 2, 31)).toBe(28)
    })
    it('clamps day 29 to 28 in non-leap February', () => {
      expect(clampDay(2026, 2, 29)).toBe(28)
    })
    it('keeps day 29 in leap February', () => {
      expect(clampDay(2028, 2, 29)).toBe(29)
    })
    it('keeps day 31 in a 31-day month', () => {
      expect(clampDay(2026, 7, 31)).toBe(31)
    })
  })

  describe('nextDueDate', () => {
    it('returns this month when the due day is still ahead', () => {
      expect(nextDueDate('2026-06-18', 22)).toBe('2026-06-22')
    })
    it('rolls to next month when the due day has passed', () => {
      expect(nextDueDate('2026-06-18', 5)).toBe('2026-07-05')
    })
    it('returns same day when fromISO IS the due day (today counts)', () => {
      expect(nextDueDate('2026-06-22', 22)).toBe('2026-06-22')
    })
    it('clamps the due day to next month length (31 → Feb 28)', () => {
      expect(nextDueDate('2026-01-31', 31)).toBe('2026-01-31')
      expect(nextDueDate('2026-02-01', 31)).toBe('2026-02-28')
    })
  })
})
