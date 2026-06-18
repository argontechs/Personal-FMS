import { describe, it, expect } from 'vitest'
import { payoffProgress, btRecommendation } from '../payoff'

describe('payoffProgress', () => {
  it('is (baseline − current)/baseline', () => {
    // baseline 740076, current 370038 → 0.5
    expect(payoffProgress(740076, 370038)).toBeCloseTo(0.5, 5)
  })
  it('returns 0 when current equals baseline (no progress yet)', () => {
    expect(payoffProgress(740076, 740076)).toBe(0)
  })
  it('clamps to 0 when current exceeds baseline (post-interest drift, §14 #3)', () => {
    expect(payoffProgress(740076, 800000)).toBe(0)
  })
  it('clamps to 1 when the card is cleared', () => {
    expect(payoffProgress(740076, 0)).toBe(1)
  })
  it('returns 0 for a null/zero baseline instead of NaN', () => {
    expect(payoffProgress(null, 100)).toBe(0)
    expect(payoffProgress(0, 100)).toBe(0)
    expect(payoffProgress(undefined, 100)).toBe(0)
  })
})

describe('btRecommendation', () => {
  it('attempts the 0% BT first when none applied (Step 0, §5)', () => {
    expect(btRecommendation('none')).toBe('attempt_bt')
    expect(btRecommendation('applied')).toBe('attempt_bt')
  })
  it('routes surplus to clear inside the promo when BT active', () => {
    expect(btRecommendation('active')).toBe('route_surplus_inside_promo')
  })
  it('falls back to the 18% avalanche when declined', () => {
    expect(btRecommendation('declined')).toBe('avalanche_18pct')
  })
})
