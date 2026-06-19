// server/utils/streaks.ts
// Pure streak computation — no DB, fully testable with injected today.

export interface StreakResult {
  current: number
  longest: number
}

/**
 * Compute current and longest streaks from a sorted list of MYT date strings.
 *
 * @param sortedDates  Distinct YYYY-MM-DD strings, sorted ascending.
 * @param todayMYT     Today's MYT date (default: computed from system clock via Intl).
 *                     Pass a fixed value in tests for determinism.
 */
export function computeStreaks(sortedDates: string[], todayMYT?: string): StreakResult {
  if (sortedDates.length === 0) return { current: 0, longest: 0 }

  // Resolve today.
  const today = todayMYT ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  // Convert YYYY-MM-DD to epoch days (local-agnostic; comparison only).
  function toEpochDay(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number)
    // Use UTC constructor so host TZ never shifts the date.
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
  }

  const todayDay = toEpochDay(today)
  const yesterdayDay = todayDay - 1

  // --- Longest streak via single pass ---
  let longest = 1
  let runLen = 1
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = toEpochDay(sortedDates[i - 1])
    const curr = toEpochDay(sortedDates[i])
    if (curr === prev + 1) {
      runLen++
      if (runLen > longest) longest = runLen
    } else if (curr !== prev) {
      // Gap (skip same-day duplicates defensively)
      runLen = 1
    }
  }

  // --- Current streak ---
  // Walk backward from the most recent logged date.
  // "Current" is valid if the most recent date is today or yesterday.
  const lastDay = toEpochDay(sortedDates[sortedDates.length - 1])
  if (lastDay !== todayDay && lastDay !== yesterdayDay) {
    return { current: 0, longest }
  }

  // Count consecutive days ending at lastDay.
  let current = 1
  for (let i = sortedDates.length - 2; i >= 0; i--) {
    const curr = toEpochDay(sortedDates[i])
    const next = toEpochDay(sortedDates[i + 1])
    if (next === curr + 1) {
      current++
    } else if (next !== curr) {
      break
    }
    // same-day duplicate → skip without counting
  }

  return { current, longest }
}
