// test/server/utils/streaks-util.test.ts
// Unit tests for computeStreaks — all dates fixed for determinism.
import { describe, it, expect } from 'vitest'
import { computeStreaks } from '../../../server/utils/streaks'

// Fixed "today" for all tests.
const TODAY = '2026-06-19'
const YESTERDAY = '2026-06-18'
const TWO_DAYS_AGO = '2026-06-17'

// Build a range of consecutive ISO dates ending at a given date.
function buildRange(endDate: string, count: number): string[] {
  const [y, m, d] = endDate.split('-').map(Number)
  const end = Date.UTC(y, m - 1, d)
  const result: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const ts = end - i * 86_400_000
    const dt = new Date(ts)
    result.push([
      dt.getUTCFullYear(),
      String(dt.getUTCMonth() + 1).padStart(2, '0'),
      String(dt.getUTCDate()).padStart(2, '0'),
    ].join('-'))
  }
  return result
}

describe('computeStreaks', () => {
  // 1. Empty array
  it('empty array → {current:0, longest:0}', () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, longest: 0 })
  })

  // 2. Single date = today
  it('single date = today → {current:1, longest:1}', () => {
    expect(computeStreaks([TODAY], TODAY)).toEqual({ current: 1, longest: 1 })
  })

  // 3. Single date = yesterday
  it('single date = yesterday → {current:1, longest:1}', () => {
    expect(computeStreaks([YESTERDAY], TODAY)).toEqual({ current: 1, longest: 1 })
  })

  // 4. Single date = 2 days ago
  it('single date = 2 days ago → {current:0, longest:1}', () => {
    expect(computeStreaks([TWO_DAYS_AGO], TODAY)).toEqual({ current: 0, longest: 1 })
  })

  // 5. 7 consecutive days ending today
  it('7 consecutive days ending today → {current:7, longest:7}', () => {
    const dates = buildRange(TODAY, 7)
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 7, longest: 7 })
  })

  // 6. 7 consecutive days ending yesterday (nothing today)
  it('7 consecutive days ending yesterday → {current:7, longest:7}', () => {
    const dates = buildRange(YESTERDAY, 7)
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 7, longest: 7 })
  })

  // 7. Gap: 3 days, gap, 5 days ending today → current=5, longest=5
  it('3-day run, gap, 5-day run ending today → {current:5, longest:5}', () => {
    // 5-day run ending today: Jun 15–19
    const run2 = buildRange(TODAY, 5)            // Jun 15, 16, 17, 18, 19
    // 3-day run ending Jun 10 (gap Jun 11–14)
    const run1 = buildRange('2026-06-10', 3)     // Jun 08, 09, 10
    const dates = [...run1, ...run2]
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 5, longest: 5 })
  })

  // 7b. Gap: 3-day run ending yesterday, verifies current picks up yesterdayanchor
  it('3 days ending yesterday, nothing today → current=3', () => {
    const dates = buildRange(YESTERDAY, 3)
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 3, longest: 3 })
  })

  // 8. Longest in the middle, shorter at end
  it('long run in middle, shorter run at end → longest correctly tracked', () => {
    // 10-day run in May
    const longRun = buildRange('2026-05-31', 10)  // May 22–31
    // 3-day run ending today
    const shortRun = buildRange(TODAY, 3)          // Jun 17, 18, 19
    const dates = [...longRun, ...shortRun]
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 3, longest: 10 })
  })

  // Edge: current streak broken yesterday (gap), short today
  it('single entry today after a gap → {current:1, longest:max}', () => {
    // Old 5-day run ending June 1, then nothing until today
    const oldRun = buildRange('2026-06-01', 5)
    const dates = [...oldRun, TODAY]
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 1, longest: 5 })
  })

  // Edge: all dates in the past, nothing recent → current=0
  it('all dates 2+ days ago → {current:0, longest=N}', () => {
    const dates = buildRange('2026-06-10', 5)  // Jun 06–10, well before today (Jun 19)
    expect(computeStreaks(dates, TODAY)).toEqual({ current: 0, longest: 5 })
  })
})
