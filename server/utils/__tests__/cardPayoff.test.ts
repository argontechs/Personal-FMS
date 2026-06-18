import { describe, it, expect } from 'vitest'
import { cardMonthlyInterestCents, cardFreeDate } from '../cardPayoff'

describe('cardMonthlyInterestCents', () => {
  it('is balance × apr_bps / 120000 (≈ RM111 on RM7,400.76 @ 18%)', () => {
    // 740076 × 1800 / 120000 = 11101.14 → floor 11101 sen = RM111.01
    expect(cardMonthlyInterestCents({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' })).toBe(11101)
  })
  it('is RM0 while a balance transfer is active (§5)', () => {
    expect(cardMonthlyInterestCents({ balance_cents: 740076, apr_bps: 1800, bt_status: 'active' })).toBe(0)
  })
})

describe('cardFreeDate', () => {
  it('returns null months when the payment never beats interest', () => {
    // interest ≈ 11101/mo; paying 10000/mo never clears
    const r = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' }, 10000, '2026-06-18')
    expect(r.months).toBeNull()
    expect(r.cardFreeISO).toBeNull()
  })

  it('computes a single card-free date under the 18% avalanche (~M6 from §5)', () => {
    // ~RM2,200/mo surplus thrown at the card clears ~RM7,400 in ~4-5 months including interest
    const r = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' }, 220000, '2026-06-18')
    expect(r.months).toBeGreaterThan(0)
    expect(r.months).toBeLessThanOrEqual(6)
    // fromISO 2026-06-18 + months → an ISO date string in the right month
    expect(r.cardFreeISO).toMatch(/^2026-(0[6-9]|1[0-2])-\d{2}$/)
  })

  it('under an active BT, every ringgit is principal (faster, no interest)', () => {
    const noBt = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'none' }, 150000, '2026-06-18')
    const bt = cardFreeDate({ balance_cents: 740076, apr_bps: 1800, bt_status: 'active' }, 150000, '2026-06-18')
    expect(bt.months!).toBeLessThanOrEqual(noBt.months!)
    // BT clears 740076 at 150000/mo with no interest → ceil(740076/150000) = 5 months
    expect(bt.months).toBe(5)
  })

  it('returns 0 months and today when balance is already zero', () => {
    const r = cardFreeDate({ balance_cents: 0, apr_bps: 1800, bt_status: 'none' }, 100000, '2026-06-18')
    expect(r.months).toBe(0)
    expect(r.cardFreeISO).toBe('2026-06-18')
  })
})
