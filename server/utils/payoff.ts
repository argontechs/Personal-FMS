import type { CardLike } from './cardPayoff'

// §14 #3: frozen baseline; clamp guards null/0 (→0) and post-interest drift (current > baseline → 0).
export function payoffProgress(baselineCents: number | null | undefined, currentCents: number): number {
  if (!baselineCents || baselineCents <= 0) return 0
  const raw = (baselineCents - currentCents) / baselineCents
  return Math.min(1, Math.max(0, raw))
}

export type BtRecommendation = 'attempt_bt' | 'route_surplus_inside_promo' | 'avalanche_18pct'

// §5 gated plan, Step 0 first.
// 'none'/'applied' → attempt the 0% BT conversion first (own issuer plan or open-market card —
//   the user has no Maybank account; Maybank/CIMB are open-market benchmarks only, not assumed accessible).
// 'active' → route surplus to clear inside the promo window.
// 'declined' → fall back to 18% avalanche.
export function btRecommendation(btStatus: CardLike['bt_status']): BtRecommendation {
  switch (btStatus) {
    case 'active':
      return 'route_surplus_inside_promo'
    case 'declined':
      return 'avalanche_18pct'
    case 'none':
    case 'applied':
    default:
      return 'attempt_bt'
  }
}
