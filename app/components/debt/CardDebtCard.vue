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
  <section class="card-debt card">
    <!-- Utilisation warning — highest priority visual signal -->
    <div v-if="debt.utilDecline" data-testid="card-maxed" class="card-debt__alert card-debt__alert--danger">
      <!-- alert-triangle -->
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      Card maxed — charges will decline.
    </div>
    <div v-else-if="debt.utilWarn" class="card-debt__alert card-debt__alert--warn">
      <!-- alert-circle -->
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      Utilisation {{ utilPct }}% — close to the limit.
    </div>

    <!-- Balance row -->
    <div class="card-debt__balance-row">
      <span class="card-debt__label">Balance</span>
      <span class="card-debt__balance tabnum">{{ formatRM(debt.cardBalanceCents) }}</span>
    </div>

    <!-- Utilisation progress bar -->
    <div
      class="progress-track card-debt__util-track"
      role="progressbar"
      :aria-valuenow="utilPct"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`Card utilisation ${utilPct}%`"
    >
      <div
        class="card-debt__util-fill"
        :class="{
          'card-debt__util-fill--warn': debt.utilWarn && !debt.utilDecline,
          'card-debt__util-fill--maxed': debt.utilDecline,
        }"
        :style="{ width: Math.min(utilPct, 100) + '%' }"
      />
    </div>
    <p class="card-debt__util-caption tabnum">
      {{ utilPct }}% of {{ formatRM(debt.creditLimitCents) }} · {{ formatRM(debt.availableCreditCents) }} available
    </p>

    <!-- Rows: interest, card-free, payoff -->
    <div class="card-debt__rows">
      <div class="card-debt__row">
        <span class="card-debt__row-label">Monthly interest</span>
        <span class="card-debt__row-value tabnum" :class="{ 'card-debt__row-value--positive': debt.monthlyInterestCents === 0 }">
          {{ debt.monthlyInterestCents > 0 ? formatRM(debt.monthlyInterestCents) : 'RM0' }}
          <span v-if="debt.btStatus === 'active'" class="badge badge--green">BT active</span>
        </span>
      </div>

      <div class="card-debt__row">
        <span class="card-debt__row-label">Projected card-free</span>
        <span v-if="cardFreeLabel" class="card-debt__row-value tabnum">
          {{ cardFreeLabel }}
          <span class="card-debt__months">({{ debt.cardFreeMonths }} mo)</span>
        </span>
        <span v-else class="card-debt__row-value card-debt__row-value--muted">payment too low</span>
      </div>

      <div class="card-debt__row card-debt__row--last">
        <span class="card-debt__row-label">Payoff progress</span>
        <span class="card-debt__row-value tabnum">{{ Math.round(debt.payoffProgress * 100) }}%</span>
      </div>
    </div>

    <!-- BT recommendation -->
    <p class="card-debt__rec">{{ REC_COPY[debt.btRecommendation] }}</p>

    <p v-if="debt.btStatus === 'active'" class="card-debt__promo-note">
      Clear inside the promo window to avoid the 18% revert.
    </p>
  </section>
</template>

<style scoped>
.card-debt {
  /* uses .card globally */
}

/* ── Alert banner ────────────────────────────────────────── */
.card-debt__alert {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
  line-height: 1.4;
}

.card-debt__alert--danger {
  background: rgba(220,38,38,.08);
  color: var(--negative);
}

.card-debt__alert--warn {
  background: rgba(217,119,6,.10);
  color: var(--warning);
}

/* ── Balance row ─────────────────────────────────────────── */
.card-debt__balance-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.card-debt__label {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--text-muted);
}

.card-debt__balance {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

/* ── Utilisation bar ─────────────────────────────────────── */
.card-debt__util-track {
  margin-bottom: 6px;
}

.card-debt__util-fill {
  height: 100%;
  background: var(--primary);
  border-radius: var(--radius-track);
  transition: width 400ms ease-out;
  min-width: 3px;
}

.card-debt__util-fill--warn {
  background: var(--warning);
}

.card-debt__util-fill--maxed {
  background: var(--negative);
}

.card-debt__util-caption {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 16px;
}

/* ── Data rows ───────────────────────────────────────────── */
.card-debt__rows {
  display: flex;
  flex-direction: column;
}

.card-debt__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.card-debt__row--last {
  border-bottom: none;
}

.card-debt__row-label {
  font-size: 14px;
  color: var(--text-muted);
}

.card-debt__row-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-debt__row-value--positive {
  color: var(--positive);
}

.card-debt__row-value--muted {
  color: var(--text-muted);
  font-weight: 400;
}

.card-debt__months {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}

/* ── Recommendation ──────────────────────────────────────── */
.card-debt__rec {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 10px;
  padding: 12px 14px;
  line-height: 1.5;
}

.card-debt__promo-note {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--positive);
  font-style: italic;
}
</style>
