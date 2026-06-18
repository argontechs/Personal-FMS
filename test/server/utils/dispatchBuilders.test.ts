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

  it('spayLaterNextAmount returns arr[postedCount] (declining) and null when done', () => {
    const json = '[151950,83682,63165,57307,48212,32100,22450,14651]'
    expect(spayLaterNextAmount(json, 0)).toBe(151950)  // first installment
    expect(spayLaterNextAmount(json, 3)).toBe(57307)   // 4th installment
    expect(spayLaterNextAmount(json, 7)).toBe(14651)   // last installment
    expect(spayLaterNextAmount(json, 8)).toBeNull()    // all posted — done
    expect(json).toBe('[151950,83682,63165,57307,48212,32100,22450,14651]') // never mutated
    expect(spayLaterNextAmount(null, 0)).toBeNull()
    expect(spayLaterNextAmount('[]', 0)).toBeNull()
  })

  it('buildBillDuePayload shows the correct declining SPayLater amount at postedCount=3', () => {
    const json = '[151950,83682,63165,57307,48212]'
    const p = buildBillDuePayload(
      { name: 'ShopeePayLater', amount_cents: 0, remaining_installments_json: json, next_due_date: '2026-07-10' },
      '3-day',
      3, // 3 installments already auto-posted
    )
    expect(p.title).toContain('ShopeePayLater')
    expect(p.body).toContain('RM573.07')   // arr[3] = 57307 sen
    expect(p.body).not.toContain('RM1,519.50')
    expect(p.tag).toContain('bill-due')
    expect(p.url).toBe('/?focus=bills')
  })

  it('buildBillDuePayload at postedCount=0 shows first installment (RM1,519.50)', () => {
    const p = buildBillDuePayload(
      { name: 'ShopeePayLater', amount_cents: 0, remaining_installments_json: '[151950,83682]', next_due_date: '2026-07-10' },
      '3-day',
      0,
    )
    expect(p.body).toContain('RM1,519.50')
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
