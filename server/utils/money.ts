// Sane MYR ceiling for monetary inputs: RM1,000,000,000 expressed in sen.
// Any amount whose absolute value exceeds this is rejected by the API validators (§14 band).
// Well above any plausible personal-finance figure, but bounded so an absurd input cannot
// overflow downstream sums / display logic.
export const MAX_AMOUNT_CENTS = 10_000_000_000

/** True when an integer sen value is within ±MAX_AMOUNT_CENTS. */
export function withinAmountCeiling(cents: number): boolean {
  return Math.abs(cents) <= MAX_AMOUNT_CENTS
}

export function ringgitToSen(rm: number): number {
  return Math.round(rm * 100)
}

export function senToRinggit(sen: number): number {
  return sen / 100
}

export function formatRM(sen: number): string {
  const neg = sen < 0
  const abs = Math.abs(sen)
  const whole = Math.floor(abs / 100)
  const cents = abs % 100
  const grouped = whole.toLocaleString('en-US')
  return `${neg ? '-' : ''}RM${grouped}.${String(cents).padStart(2, '0')}`
}
