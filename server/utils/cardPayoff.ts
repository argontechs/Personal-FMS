export interface CardLike {
  balance_cents: number
  apr_bps: number
  bt_status: 'none' | 'applied' | 'active' | 'declined'
}

// §5: monthly interest = balance × apr_bps / 120000. RM0 while BT active.
export function cardMonthlyInterestCents(card: CardLike): number {
  if (card.bt_status === 'active') return 0
  return Math.floor((card.balance_cents * card.apr_bps) / 120000)
}

function addMonthsISO(fromISO: string, months: number): string {
  const [y, m, d] = fromISO.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  const ty = base.getUTCFullYear()
  const tm = base.getUTCMonth() + 1
  // clamp original day to the target month's length
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${ty}-${String(tm).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// §5: single strategy, one loop. Apply interest (unless BT active) then the monthly payment.
// monthlyPaymentCents = routed payment (surplus after EF/savings allocation, per §14 D3).
export function cardFreeDate(
  card: CardLike,
  monthlyPaymentCents: number,
  fromISO: string,
): { months: number | null; cardFreeISO: string | null } {
  if (card.balance_cents <= 0) return { months: 0, cardFreeISO: fromISO }

  let balance = card.balance_cents
  const btActive = card.bt_status === 'active'
  const MAX_MONTHS = 600 // 50-year safety cap → never-clears guard

  for (let month = 1; month <= MAX_MONTHS; month++) {
    if (!btActive) {
      balance += Math.floor((balance * card.apr_bps) / 120000) // accrue interest first
    }
    balance -= monthlyPaymentCents
    if (balance <= 0) {
      return { months: month, cardFreeISO: addMonthsISO(fromISO, month) }
    }
  }
  return { months: null, cardFreeISO: null } // payment never beats interest
}
