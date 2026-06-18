const MYT_TZ = 'Asia/Kuala_Lumpur'

export function nowEpoch(): number {
  return Date.now()
}

export function todayMYT(): string {
  // en-CA renders ISO-ordered YYYY-MM-DD; timeZone forces MYT regardless of box TZ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MYT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function clampDay(year: number, month1to12: number, day: number): number {
  // Day 0 of (month+1) === last day of month. UTC math is calendar-only, no TZ risk.
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
  return Math.min(day, lastDay)
}

export function nextDueDate(fromISO: string, dayOfMonth: number): string {
  const [y, m, d] = fromISO.split('-').map(Number)
  // Try the due day in the from-month first.
  const thisMonthDay = clampDay(y, m, dayOfMonth)
  if (thisMonthDay >= d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(thisMonthDay).padStart(2, '0')}`
  }
  // Otherwise roll to next month.
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const nextMonthDay = clampDay(ny, nm, dayOfMonth)
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nextMonthDay).padStart(2, '0')}`
}
