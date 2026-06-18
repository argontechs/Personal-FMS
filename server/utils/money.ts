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
