<!-- app/components/debt/CardDebtCard.vue -->
<!-- §5: Credit-card debt view. Balance, interest (or RM0 under BT), card-free date, utilisation, BT recommendation. -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM } from '../../../shared/types'

interface DebtView {
  cardBalanceCents: number
  creditLimitCents: number
  availableCreditCents: number
  utilization: number
  utilWarn: boolean
  utilDecline: boolean
  monthlyInterestCents: number
  btStatus: 'none' | 'applied' | 'active' | 'declined'
  btRecommendation: 'attempt_bt' | 'route_surplus_inside_promo' | 'avalanche_18pct'
  payoffProgress: number
  cardFreeISO: string | null
  cardFreeMonths: number | null
}

const props = defineProps<{ debt: DebtView }>()

const utilPct = computed(() => Math.round(props.debt.utilization * 100))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const cardFreeLabel = computed(() => {
  if (!props.debt.cardFreeISO) return null
  const [, m, d] = props.debt.cardFreeISO.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${props.debt.cardFreeISO.slice(0, 4)}`
})

const REC_COPY: Record<DebtView['btRecommendation'], string> = {
  attempt_bt: 'Convert/transfer the full balance to a 0% (or lowest-rate) plan first.',
  route_surplus_inside_promo: 'BT active — clear it inside the promo window before it rolls back to 18%.',
  avalanche_18pct: 'BT declined — throw all surplus at the 18% card (avalanche).',
}
</script>

<template>
  <section class="card-debt">
    <h2 class="card-debt__title">Credit Card</h2>

    <!-- Utilisation warning — highest priority visual signal -->
    <div v-if="debt.utilDecline" data-testid="card-maxed" class="card-debt__alert card-debt__alert--danger">
      <span class="card-debt__alert-icon">!</span>
      Card maxed — charges will decline.
    </div>
    <div v-else-if="debt.utilWarn" class="card-debt__alert card-debt__alert--warn">
      <span class="card-debt__alert-icon">~</span>
      Utilisation {{ utilPct }}% — close to the limit.
    </div>

    <!-- Balance row -->
    <div class="card-debt__row card-debt__row--prominent">
      <span class="card-debt__label">Balance</span>
      <span class="card-debt__value card-debt__value--large">{{ formatRM(debt.cardBalanceCents) }}</span>
    </div>
    <div class="card-debt__util-bar" role="progressbar" :aria-valuenow="utilPct" aria-valuemin="0" aria-valuemax="100">
      <div
        class="card-debt__util-fill"
        :class="{ 'card-debt__util-fill--warn': debt.utilWarn, 'card-debt__util-fill--maxed': debt.utilDecline }"
        :style="{ width: Math.min(utilPct, 100) + '%' }"
      />
    </div>
    <p class="card-debt__util-label">{{ utilPct }}% of {{ formatRM(debt.creditLimitCents) }} limit · {{ formatRM(debt.availableCreditCents) }} available</p>

    <!-- Interest row -->
    <div class="card-debt__row">
      <span class="card-debt__label">Monthly interest</span>
      <span class="card-debt__value" :class="{ 'card-debt__value--green': debt.monthlyInterestCents === 0 }">
        {{ debt.monthlyInterestCents > 0 ? formatRM(debt.monthlyInterestCents) : 'RM0' }}
        <span v-if="debt.btStatus === 'active'" class="card-debt__badge">BT active</span>
      </span>
    </div>

    <!-- Card-free date row -->
    <div class="card-debt__row">
      <span class="card-debt__label">Projected card-free</span>
      <span v-if="cardFreeLabel" class="card-debt__value">
        {{ cardFreeLabel }}
        <span class="card-debt__months">({{ debt.cardFreeMonths }} mo)</span>
      </span>
      <span v-else class="card-debt__value card-debt__value--muted">payment too low</span>
    </div>

    <!-- Payoff progress bar (kill-card) -->
    <div class="card-debt__row">
      <span class="card-debt__label">Payoff progress</span>
      <span class="card-debt__value">{{ Math.round(debt.payoffProgress * 100) }}%</span>
    </div>

    <!-- BT recommendation -->
    <p class="card-debt__rec">{{ REC_COPY[debt.btRecommendation] }}</p>

    <!-- BT active: clear inside promo reminder -->
    <p v-if="debt.btStatus === 'active'" class="card-debt__promo-note">
      Clear inside the promo window to avoid the 18% revert.
    </p>
  </section>
</template>

<style scoped>
.card-debt {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.card-debt__title {
  font-size: 1rem;
  font-weight: 600;
  color: #555;
  margin: 0 0 16px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.78rem;
}

.card-debt__alert {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 14px;
}

.card-debt__alert--danger {
  background: #fdecea;
  color: #c0392b;
}

.card-debt__alert--warn {
  background: #fff8e1;
  color: #b7791f;
}

.card-debt__alert-icon {
  font-weight: 800;
  font-size: 1.1rem;
}

.card-debt__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 0;
  border-bottom: 1px solid #f2f2f2;
}

.card-debt__row--prominent {
  padding-bottom: 6px;
  border-bottom: none;
}

.card-debt__label {
  font-size: 0.85rem;
  color: #888;
}

.card-debt__value {
  font-size: 0.95rem;
  font-weight: 600;
  color: #1a1a2e;
}

.card-debt__value--large {
  font-size: 1.6rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.card-debt__value--green {
  color: #276749;
}

.card-debt__value--muted {
  color: #999;
  font-weight: 400;
}

.card-debt__badge {
  display: inline-block;
  background: #e6ffed;
  color: #276749;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 0.72rem;
  font-weight: 600;
  margin-left: 6px;
  vertical-align: middle;
}

.card-debt__months {
  color: #aaa;
  font-size: 0.8rem;
  font-weight: 400;
  margin-left: 4px;
}

.card-debt__util-bar {
  height: 6px;
  background: #f0f0f0;
  border-radius: 3px;
  overflow: hidden;
  margin: 4px 0 6px;
}

.card-debt__util-fill {
  height: 100%;
  background: #4a90d9;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.card-debt__util-fill--warn {
  background: #e8a020;
}

.card-debt__util-fill--maxed {
  background: #c0392b;
}

.card-debt__util-label {
  font-size: 0.75rem;
  color: #aaa;
  margin: 0 0 12px;
}

.card-debt__rec {
  margin: 14px 0 0;
  font-size: 0.85rem;
  color: #555;
  background: #f7f9ff;
  border-radius: 10px;
  padding: 12px 14px;
  line-height: 1.5;
}

.card-debt__promo-note {
  margin: 8px 0 0;
  font-size: 0.8rem;
  color: #276749;
  font-style: italic;
}
</style>
