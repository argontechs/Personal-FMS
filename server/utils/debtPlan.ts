// server/utils/debtPlan.ts
// Pure AVALANCHE payoff projection across ALL active debts.
//
// Each simulated month:
//   1. accrue interest on revolving (rate_type='apr') balances:
//      floor(balance * apr_bps / 120000)  — the existing §5 convention (see cardPayoff.ts).
//   2. pay every debt its scheduled minimum (capped at its balance);
//   3. apply the leftover 'extra' to the highest-rate (lowest priority_rank) still-open debt;
//   4. when a debt clears, its freed minimum rolls into the snowball-extra pool for the rest.
//
// Installment / fixed-schedule debts (rate_type 'flat'|'none') run their fixed remaining schedule:
//   they don't accrue compounding interest here — their remaining payments are a known list, so we
//   just draw them down by their scheduled payment each month and never prepay them with the extra
//   (avalanche targets the interest-bearing revolving balances; fixed loans amortise on schedule).
//
// Integer sen throughout. Simulation is CAPPED (MAX_MONTHS). If the monthly money can't cover the
// interest on the avalanche target (the highest-rate revolving debt never shrinks), we return a
// clear `neverClears` signal with the shortfall instead of looping forever.

export interface DebtPlanInput {
  id: number
  name: string
  balance_cents: number
  rate_type: 'apr' | 'flat' | 'none'
  apr_bps?: number | null
  flat_rate_bps?: number | null
  // Per-month obligation: min_payment_cents (revolving) or scheduled_payment_cents (installment).
  min_payment_cents?: number | null
  scheduled_payment_cents?: number | null
  priority_rank?: number | null
  type?: string
}

export interface PerDebtResult {
  id: number
  name: string
  monthsToPayoff: number // months from start until this debt's balance hits 0
}

export interface DebtPlanResult {
  // Months from the start date until the LAST debt clears, or null if it never clears.
  debtFreeMonths: number | null
  totalInterestCents: number
  perDebt: PerDebtResult[] // ordered by payoff order (earliest first)
  neverClears: boolean
  // When neverClears: the per-month shortfall on the avalanche target (interest − money available
  // to that debt), so the UI can say "you need RMx more/mo". 0 otherwise.
  shortfallCents: number
}

export const MAX_MONTHS = 600 // 50-year safety cap → never-clears guard

function monthlyInterestCents(balance: number, debt: DebtPlanInput): number {
  // §5 convention: revolving APR compounds monthly at apr_bps/120000. Fixed loans don't compound here.
  if (debt.rate_type === 'apr' && debt.apr_bps && debt.apr_bps > 0) {
    return Math.floor((balance * debt.apr_bps) / 120000)
  }
  return 0
}

function scheduledPaymentCents(debt: DebtPlanInput): number {
  // Per-month obligation. Prefer the explicit scheduled payment (installment), else the min payment.
  const sched = debt.scheduled_payment_cents
  const min = debt.min_payment_cents
  const v = (sched != null && sched > 0) ? sched : (min ?? 0)
  return Math.max(0, v)
}

function isRevolving(debt: DebtPlanInput): boolean {
  return debt.rate_type === 'apr'
}

interface SimDebt {
  input: DebtPlanInput
  balance: number
  rank: number // effective avalanche rank (lower = paid first)
  monthsToPayoff: number | null
  scheduled: number
}

/**
 * Project an avalanche payoff. Pure: takes the debt list + the monthly extra thrown at debt
 * (the surplus routed to debt, clamped >= 0) + a start month index (0).
 *
 * Avalanche order: among still-open REVOLVING debts, target the one with the highest effective
 * rate. We rank by priority_rank ASC (the seed already ranks the 18% card #1); debts without a
 * rank sort after ranked ones. The extra always lands on the lowest-rank still-open revolving debt.
 * Fixed-schedule (installment) debts amortise on their own schedule and are never prepaid.
 */
export function projectDebtPlan(
  debts: DebtPlanInput[],
  monthlyExtraCents: number,
  _startISO?: string,
): DebtPlanResult {
  const extra = Math.max(0, Math.floor(monthlyExtraCents))

  const sim: SimDebt[] = debts
    .filter((d) => (d.balance_cents ?? 0) > 0)
    .map((d) => ({
      input: d,
      balance: d.balance_cents,
      rank: d.priority_rank != null ? d.priority_rank : Number.MAX_SAFE_INTEGER,
      monthsToPayoff: null,
      scheduled: scheduledPaymentCents(d),
    }))

  if (sim.length === 0) {
    return { debtFreeMonths: 0, totalInterestCents: 0, perDebt: [], neverClears: false, shortfallCents: 0 }
  }

  let totalInterest = 0
  const cleared: SimDebt[] = []

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const open = sim.filter((s) => s.balance > 0)
    if (open.length === 0) break

    // 1. Accrue interest on revolving balances.
    for (const s of open) {
      const interest = monthlyInterestCents(s.balance, s.input)
      if (interest > 0) {
        s.balance += interest
        totalInterest += interest
      }
    }

    // Snowball pool = the base monthly extra + every cleared debt's freed scheduled payment.
    let pool = extra
    for (const c of cleared) pool += c.scheduled

    // 2. Pay each still-open debt its scheduled minimum (capped at balance).
    for (const s of open) {
      const pay = Math.min(s.scheduled, s.balance)
      s.balance -= pay
    }

    // 3. Apply the snowball pool to the highest-rate (lowest-rank) still-open REVOLVING debt;
    //    if no revolving debt is open, fall back to the lowest-rank open debt of any kind.
    const stillOpen = sim.filter((s) => s.balance > 0)
    if (stillOpen.length > 0 && pool > 0) {
      const revolvingOpen = stillOpen.filter((s) => isRevolving(s.input))
      const pickFrom = revolvingOpen.length > 0 ? revolvingOpen : stillOpen
      pickFrom.sort((a, b) => a.rank - b.rank)
      let remaining = pool
      for (const target of pickFrom) {
        if (remaining <= 0) break
        const pay = Math.min(remaining, target.balance)
        target.balance -= pay
        remaining -= pay
      }
    }

    // 4. Record any debt that cleared THIS month (in rank order so perDebt reads sensibly).
    const justCleared = sim
      .filter((s) => s.balance <= 0 && s.monthsToPayoff === null)
      .sort((a, b) => a.rank - b.rank)
    for (const s of justCleared) {
      s.balance = 0
      s.monthsToPayoff = month
      cleared.push(s)
    }

    // 5. Never-clears guard: if nothing is making progress (the avalanche target's interest meets or
    //    exceeds the money reaching it), bail with a shortfall signal rather than spinning to MAX.
    if (month >= 2 && sim.some((s) => s.balance > 0)) {
      // Detect stall: the lowest-rank open revolving debt whose balance is not shrinking.
      const openRev = sim.filter((s) => s.balance > 0 && isRevolving(s.input)).sort((a, b) => a.rank - b.rank)
      if (openRev.length > 0) {
        const target = openRev[0]
        const interest = monthlyInterestCents(target.balance, target.input)
        // Money that can reach this target each month = its own scheduled + pool (when it's the pick).
        const reachable = target.scheduled + extra + cleared.reduce((sum, c) => sum + c.scheduled, 0)
        if (reachable <= interest) {
          // It will never shrink — report the shortfall (how much more per month is needed).
          return {
            debtFreeMonths: null,
            totalInterestCents: totalInterest,
            perDebt: buildPerDebt(sim),
            neverClears: true,
            shortfallCents: interest - reachable + 1, // +1 sen so the payment strictly beats interest
          }
        }
      }
    }
  }

  const anyOpen = sim.some((s) => s.balance > 0)
  if (anyOpen) {
    // Hit the cap without clearing — treat as never-clears (cap reached).
    return {
      debtFreeMonths: null,
      totalInterestCents: totalInterest,
      perDebt: buildPerDebt(sim),
      neverClears: true,
      shortfallCents: 0,
    }
  }

  const perDebt = buildPerDebt(sim)
  const debtFreeMonths = perDebt.reduce((max, p) => Math.max(max, p.monthsToPayoff), 0)
  return { debtFreeMonths, totalInterestCents: totalInterest, perDebt, neverClears: false, shortfallCents: 0 }
}

function buildPerDebt(sim: SimDebt[]): PerDebtResult[] {
  return sim
    .slice()
    .sort((a, b) => {
      // Cleared debts first (by month), then still-open (rank order) with a sentinel month.
      const am = a.monthsToPayoff ?? Number.MAX_SAFE_INTEGER
      const bm = b.monthsToPayoff ?? Number.MAX_SAFE_INTEGER
      if (am !== bm) return am - bm
      return a.rank - b.rank
    })
    .map((s) => ({
      id: s.input.id,
      name: s.input.name,
      monthsToPayoff: s.monthsToPayoff ?? -1, // -1 = did not clear within the cap
    }))
}

// Convert a month-count offset to a 'YYYY-MM' string from a start 'YYYY-MM' (or 'YYYY-MM-DD').
export function addMonthsYM(startISO: string, months: number): string {
  const [y, m] = startISO.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  const ty = base.getUTCFullYear()
  const tm = base.getUTCMonth() + 1
  return `${ty}-${String(tm).padStart(2, '0')}`
}
