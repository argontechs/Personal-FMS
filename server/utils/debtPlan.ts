// server/utils/debtPlan.ts
// Pure AVALANCHE payoff projection across ALL active debts — trustworthy debt-free date.
//
// The model (corrected per the 2026-06 adversarial review against the real seed):
//
// SNOWBALL TARGET — the only debts that may be PREPAID (receive the surplus extra + freed
//   payments) are PREPAYABLE REVOLVING debts: rate_type==='apr' AND never_prepay !== true.
//   Among those, target the highest effective rate first:
//     • when both carry a priority_rank → lower rank wins (explicit override / tie-break);
//     • else higher apr_bps wins;
//     • else lower id (stable).
//   In the real seed this means ONLY the Credit Card is ever a snowball target (PTPTN is apr but
//   never_prepay, so it is excluded).
//
// never_prepay debts (Car, PTPTN) are NEVER prepaid and NEVER receive the snowball — they amortise
//   ONLY on their scheduled_payment_cents. PTPTN is a reducing_loan that accrues 1% on its declining
//   balance while paying its scheduled payment each month — it is NOT a prepayable revolving debt
//   and is NOT compounded-then-lumped.
//
// INSTALLMENT loans (rate_type 'none' / type 'installment') amortise on schedule with no interest:
//   pay scheduled_payment_cents when present; when ABSENT (ShopeePayLater) draw the next amount from
//   remaining_installments_json each month until the array/balance is exhausted. They are never
//   frozen at 0 and never lump-paid at the end.
//
// DEBT-FREE DATE = the latest payoff month across ALL debts (the card is accelerated by the
//   snowball; everything else runs its own schedule — in the seed the long pole is the car loan).
//
// Integer sen throughout. Simulation is CAPPED (MAX_MONTHS). If the monthly money can't even cover
// the interest on the snowball target (the card never shrinks), we return a clear `neverClears`
// signal with the shortfall instead of looping forever.

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
  never_prepay?: boolean | null
  // SPayLater-style declining schedule: JSON array of the remaining payment amounts (sen).
  remaining_installments_json?: string | null
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
  // When neverClears: the per-month shortfall on the snowball target (interest − money available
  // to that debt), so the UI can say "you need RMx more/mo". 0 otherwise.
  shortfallCents: number
}

export const MAX_MONTHS = 600 // 50-year safety cap → never-clears guard

function monthlyInterestCents(balance: number, debt: DebtPlanInput): number {
  // §5 convention: APR balances compound monthly at apr_bps/120000. Flat / none don't compound here.
  // PTPTN (reducing_loan, apr 1%) uses this too — it accrues on its declining balance while it
  // pays its scheduled payment; it is NOT treated as prepayable revolving.
  if (debt.rate_type === 'apr' && debt.apr_bps && debt.apr_bps > 0) {
    return Math.floor((balance * debt.apr_bps) / 120000)
  }
  return 0
}

/** Parse a remaining_installments_json array into a queue of positive sen amounts (or null). */
function parseInstallments(debt: DebtPlanInput): number[] | null {
  const raw = debt.remaining_installments_json
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const cleaned = arr.map((n) => Math.max(0, Math.floor(Number(n)))).filter((n) => n > 0)
    return cleaned.length > 0 ? cleaned : null
  } catch {
    return null
  }
}

/**
 * A prepayable revolving debt is the only kind the snowball may target: an apr debt that is NOT
 * flagged never_prepay. PTPTN (apr but never_prepay) is therefore excluded.
 */
function isPrepayableRevolving(debt: DebtPlanInput): boolean {
  return debt.rate_type === 'apr' && debt.never_prepay !== true
}

interface SimDebt {
  input: DebtPlanInput
  balance: number
  monthsToPayoff: number | null
  // Fixed scheduled payment (revolving min / installment scheduled). 0 when driven by a queue.
  scheduled: number
  // Declining installment queue (ShopeePayLater); null when on a fixed scheduled payment.
  installments: number[] | null
  prepayable: boolean
}

/**
 * Effective avalanche comparison among PREPAYABLE REVOLVING debts only:
 *   • both ranked → lower priority_rank first;
 *   • else higher apr_bps first;
 *   • else lower id (stable).
 */
function comparePrepayable(a: SimDebt, b: SimDebt): number {
  const ra = a.input.priority_rank
  const rb = b.input.priority_rank
  if (ra != null && rb != null && ra !== rb) return ra - rb
  const aa = a.input.apr_bps ?? 0
  const ab = b.input.apr_bps ?? 0
  if (aa !== ab) return ab - aa // higher APR first
  return a.input.id - b.input.id
}

/**
 * Project an avalanche payoff. Pure: takes the debt list + the monthly extra thrown at debt
 * (the surplus routed to debt, clamped >= 0) + a start month index (0).
 *
 * Each simulated month:
 *   1. accrue interest on apr balances (card + PTPTN);
 *   2. pay every still-open debt its scheduled obligation (installment queue draws the next amount);
 *   3. apply the snowball pool (base extra + freed scheduled payments of cleared PREPAYABLE debts)
 *      to the top prepayable-revolving target;
 *   4. record any debt that cleared this month.
 */
export function projectDebtPlan(
  debts: DebtPlanInput[],
  monthlyExtraCents: number,
  _startISO?: string,
): DebtPlanResult {
  const extra = Math.max(0, Math.floor(monthlyExtraCents))

  const sim: SimDebt[] = debts
    .filter((d) => (d.balance_cents ?? 0) > 0)
    .map((d) => {
      const installments = parseInstallments(d)
      const sched = d.scheduled_payment_cents
      const min = d.min_payment_cents
      // Fixed scheduled payment: prefer explicit scheduled, else min payment. When an installment
      // queue drives the debt AND there's no explicit scheduled payment, scheduled stays 0 and the
      // queue is the source of truth (ShopeePayLater).
      const fixed = (sched != null && sched > 0) ? sched : (min ?? 0)
      const useQueue = installments != null && !(sched != null && sched > 0)
      return {
        input: d,
        balance: d.balance_cents,
        monthsToPayoff: null,
        scheduled: useQueue ? 0 : Math.max(0, fixed),
        installments: useQueue ? installments.slice() : null,
        prepayable: isPrepayableRevolving(d),
      }
    })

  if (sim.length === 0) {
    return { debtFreeMonths: 0, totalInterestCents: 0, perDebt: [], neverClears: false, shortfallCents: 0 }
  }

  let totalInterest = 0
  // Freed scheduled payments from cleared PREPAYABLE debts roll into the snowball pool.
  let freedPool = 0

  // This month's obligation for a debt: queue head (installment) or the fixed scheduled payment.
  function obligationFor(s: SimDebt): number {
    if (s.installments != null) return s.installments.length > 0 ? s.installments[0] : 0
    return s.scheduled
  }

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const open = sim.filter((s) => s.balance > 0)
    if (open.length === 0) break

    // 1. Accrue interest on apr balances (card + PTPTN).
    for (const s of open) {
      const interest = monthlyInterestCents(s.balance, s.input)
      if (interest > 0) {
        s.balance += interest
        totalInterest += interest
      }
    }

    // 2. Pay each still-open debt its scheduled obligation (capped at balance). Installment-queue
    //    debts draw the next amount off the queue.
    for (const s of open) {
      const obligation = obligationFor(s)
      const pay = Math.min(obligation, s.balance)
      s.balance -= pay
      if (s.installments != null && s.installments.length > 0) s.installments.shift()
    }

    // 3. Snowball pool = base extra + freed scheduled payments of cleared PREPAYABLE debts.
    //    Apply it to the top PREPAYABLE-REVOLVING still-open target. Never touches never_prepay
    //    or installment debts.
    const pool = extra + freedPool
    if (pool > 0) {
      const targets = sim
        .filter((s) => s.balance > 0 && s.prepayable)
        .sort(comparePrepayable)
      let remaining = pool
      for (const target of targets) {
        if (remaining <= 0) break
        const pay = Math.min(remaining, target.balance)
        target.balance -= pay
        remaining -= pay
      }
    }

    // 4. Record any debt that cleared THIS month. Freed payment of a cleared PREPAYABLE debt joins
    //    the snowball pool for following months (snowball mechanics); freed never_prepay /
    //    installment payments do NOT (they were never part of the prepay pool).
    const justCleared = sim.filter((s) => s.balance <= 0 && s.monthsToPayoff === null)
    for (const s of justCleared) {
      s.balance = 0
      s.monthsToPayoff = month
      if (s.prepayable) freedPool += s.scheduled
    }

    // 5. Never-clears guard: if the top prepayable target's interest meets or exceeds the money
    //    that can reach it (its own scheduled + pool), it will never shrink — bail with a shortfall.
    if (month >= 2) {
      const openPrepay = sim.filter((s) => s.balance > 0 && s.prepayable).sort(comparePrepayable)
      if (openPrepay.length > 0) {
        const target = openPrepay[0]
        const interest = monthlyInterestCents(target.balance, target.input)
        const reachable = target.scheduled + extra + freedPool
        if (reachable <= interest) {
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
      // Cleared debts first (by month), then still-open with a sentinel month. Ties broken so
      // prepayable-revolving order reads sensibly, then by id for stability.
      const am = a.monthsToPayoff ?? Number.MAX_SAFE_INTEGER
      const bm = b.monthsToPayoff ?? Number.MAX_SAFE_INTEGER
      if (am !== bm) return am - bm
      if (a.prepayable && b.prepayable) return comparePrepayable(a, b)
      return a.input.id - b.input.id
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
