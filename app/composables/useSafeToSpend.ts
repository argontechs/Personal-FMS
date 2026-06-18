// app/composables/useSafeToSpend.ts
// §4, §14 #20: CLIENT mirror of the server STS formula.
// Does NOT re-implement the formula — imports computeSafeToSpend from shared/types.ts which
// re-exports from server/utils/safeToSpend.ts. The server is the single source of truth.
import { ref, computed, type ComputedRef, type Ref } from 'vue'
import { computeSafeToSpend, formatRM, type StsInput, type StsResult } from '../../shared/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

export function useSafeToSpend(seed: () => StsInput): {
  sts: ComputedRef<StsResult>
  heroLabel: ComputedRef<string>
  registerSpend: (cents: number) => void
  spentTodayCents: Ref<number>
} {
  // Optimistic local spend accumulator (reset per-session; server is source of truth on next fetch).
  const spentTodayCents = ref(0)

  const sts = computed<StsResult>(() => {
    const base = seed()
    // §14 #20: spent_today is keyed on the client MYT date the seed carries; add optimistic local spend.
    return computeSafeToSpend({
      ...base,
      spentTodayVariableCents: base.spentTodayVariableCents + spentTodayCents.value,
    })
  })

  const heroLabel = computed(() => {
    const s = sts.value
    if (s.isNegative) {
      // Server already clamps to 0; display shortfall. Never show negative.
      return `RM0 — ${formatRM(s.shortfallCents)} short`
    }
    return `Safe to spend until ${shortDate(s.nextInflowISO)}: ${formatRM(s.cycleCents)}`
  })

  // Optimistic update: reduces daily STS immediately without waiting for server round-trip.
  // The next fetch of /api/forecast will reconcile with the server's authoritative value.
  function registerSpend(cents: number) {
    spentTodayCents.value += cents
  }

  return { sts, heroLabel, registerSpend, spentTodayCents }
}
