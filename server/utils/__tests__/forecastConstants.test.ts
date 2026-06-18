import { describe, it, expect } from 'vitest'
import {
  BUFFER_FLOOR,
  SAVINGS_TARGET_PER_CYCLE,
  CARD_UTIL_WARN,
  CARD_UTIL_DECLINE,
  EF_STARTER_TARGET,
  EF_FULL_TARGET,
  INFLOW_DAYS,
} from '../forecastConstants'

describe('forecastConstants', () => {
  it('pins the §4 single config block in integer sen', () => {
    expect(BUFFER_FLOOR).toBe(20000)
    expect(SAVINGS_TARGET_PER_CYCLE).toBe(16667)
    expect(CARD_UTIL_WARN).toBe(0.9)
    expect(CARD_UTIL_DECLINE).toBe(1.0)
  })

  it('seeds the EF goal at the RM1,000 starter, full target RM15,000 (§14 #16)', () => {
    expect(EF_STARTER_TARGET).toBe(100000)
    expect(EF_FULL_TARGET).toBe(1500000)
  })

  it('anchors inflows to the 1st, salary day 3, and the 23rd (§4)', () => {
    expect(INFLOW_DAYS).toEqual([1, 3, 23])
  })
})
