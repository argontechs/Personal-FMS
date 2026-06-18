import { describe, it, expect } from 'vitest'
import {
  daysUntil, dueWindow, spayLaterNextAmount,
  buildBillDuePayload, suggestedSavingsSen, buildPaydayPayload,
} from '../../../server/utils/dispatchBuilders'

describe('dispatch builders', () => {
  it('daysUntil counts MYT calendar days', () => {
    expect(daysUntil('2026-06-18', '2026-06-21')).toBe(3)
    expect(daysUntil('2026-06-18', '2026-06-18')).toBe(0)
  })

  it('dueWindow maps day offsets to the three reminder windows', () => {
    expect(dueWindow(0)).toBe('today')
    expect(dueWindow(1)).toBe('1-day')
    expect(dueWindow(3)).toBe('3-day')
    expect(dueWindow(2)).toBeNull()
    expect(dueWindow(5)).toBeNull()
  })

  it('spayLaterNextAmount reads index 0 without mutating', () => {
    const json = '[151950,83682,63165]'
    expect(spayLaterNextAmount(json)).toBe(151950)
    expect(json).toBe('[151950,83682,63165]') // unchanged
    expect(spayLaterNextAmount(null)).toBeNull()
  })

  it('buildBillDuePayload shows the declining SPayLater amount, not the template amount', () => {
    const p = buildBillDuePayload(
      { name: 'ShopeePayLater', amount_cents: 0, remaining_installments_json: '[151950,83682]', next_due_date: '2026-07-10' },
      '3-day',
    )
    expect(p.title).toContain('ShopeePayLater')
    expect(p.body).toContain('RM1,519.50')
    expect(p.tag).toContain('bill-due')
    expect(p.url).toBe('/?focus=bills')
  })

  it('buildBillDuePayload uses the template amount for flat bills', () => {
    const p = buildBillDuePayload(
      { name: 'Unifi', amount_cents: 15000, remaining_installments_json: null, next_due_date: '2026-06-19' },
      'today',
    )
    expect(p.body).toContain('RM150.00')
    expect(p.body).toContain('today')
  })

  it('suggestedSavingsSen never goes negative', () => {
    expect(suggestedSavingsSen(20000)).toBe(20000)
    expect(suggestedSavingsSen(-500)).toBe(0)
  })

  it('buildPaydayPayload renders the v1 copy with the suggested amount', () => {
    const p = buildPaydayPayload('Side Income A', 60000, 20000, '2026-06-23')
    expect(p.title).toContain('RM600.00')
    expect(p.body).toContain('Move RM200.00')
    expect(p.body).toContain("surplus that usually disappears")
    expect(p.tag).toBe('payday-save-2026-06-23')
    expect(p.actions?.map(a => a.action)).toEqual(['transfer', 'adjust', 'skip'])
    expect(p.url).toBe('/?prompt=payday')
  })
})
