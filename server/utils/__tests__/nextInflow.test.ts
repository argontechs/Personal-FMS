import { describe, it, expect } from 'vitest'
import { nextInflowDate, daysBetweenISO } from '../nextInflow'

describe('daysBetweenISO', () => {
  it('counts whole days forward', () => {
    expect(daysBetweenISO('2026-06-18', '2026-06-23')).toBe(5)
  })
  it('counts across a month boundary', () => {
    expect(daysBetweenISO('2026-06-23', '2026-07-01')).toBe(8)
  })
  it('is zero for the same day', () => {
    expect(daysBetweenISO('2026-06-18', '2026-06-18')).toBe(0)
  })
})

describe('nextInflowDate', () => {
  it('from the 18th returns the 23rd (this month)', () => {
    expect(nextInflowDate('2026-06-18')).toBe('2026-06-23')
  })
  it('from the 23rd rolls to the 1st of next month (strictly after)', () => {
    expect(nextInflowDate('2026-06-23')).toBe('2026-07-01')
  })
  it('from the 1st returns the 3rd (salary day)', () => {
    expect(nextInflowDate('2026-06-01')).toBe('2026-06-03')
  })
  it('from the 3rd returns the 23rd', () => {
    expect(nextInflowDate('2026-06-03')).toBe('2026-06-23')
  })
  it('clamps a Feb roll-in to a real day (1st always valid)', () => {
    expect(nextInflowDate('2026-01-31')).toBe('2026-02-01')
  })
})
