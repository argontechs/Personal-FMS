<!-- app/components/debt/DebtPlanPanel.vue -->
<!-- Cross-debt AVALANCHE payoff plan: a "Debt-free by <Month YYYY>" headline, the payoff ORDER
     with each debt's projected clear month, and a one-line note of the assumed monthly extra.
     Honest "never clears at this surplus" state when payments are too low. -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM } from '../../../shared/types'

interface PerDebt {
  id: number
  name: string
  monthsToPayoff: number
  payoffDate: string | null // 'YYYY-MM' or null
}

interface DebtPlan {
  debtFreeDate: string | null // 'YYYY-MM' or null
  totalInterestCents: number
  monthlyExtraCents: number
  neverClears: boolean
  shortfallCents: number
  perDebt: PerDebt[]
}

const props = defineProps<{ plan: DebtPlan }>()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function ymLabel(ym: string | null): string {
  if (!ym) return '—'
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return '—'
  return `${MONTHS[m - 1]} ${y}`
}

const debtFreeLabel = computed(() => ymLabel(props.plan.debtFreeDate))

// Only debts that actually clear within the projection (monthsToPayoff > 0) get an ordered row.
const orderedDebts = computed(() =>
  props.plan.perDebt.filter((d) => d.monthsToPayoff > 0),
)

const hasPlan = computed(() => !props.plan.neverClears && !!props.plan.debtFreeDate)
</script>

<template>
  <section class="card debt-plan" aria-labelledby="debt-plan-heading" data-testid="debt-plan">
    <p id="debt-plan-heading" class="section-label">Avalanche payoff plan</p>

    <!-- ── Healthy plan: debt-free headline + ordered payoff list ── -->
    <template v-if="hasPlan">
      <div class="debt-plan__hero">
        <span class="debt-plan__hero-eyebrow">Debt-free by</span>
        <span class="debt-plan__hero-date tabnum" data-testid="debt-free-date">{{ debtFreeLabel }}</span>
      </div>

      <ol class="debt-plan__order" role="list">
        <li
          v-for="(d, i) in orderedDebts"
          :key="d.id"
          class="debt-plan__order-row"
          data-testid="debt-plan-row"
        >
          <span class="debt-plan__order-num" aria-hidden="true">{{ i + 1 }}</span>
          <span class="debt-plan__order-name">{{ d.name }}</span>
          <span class="debt-plan__order-date tabnum">{{ ymLabel(d.payoffDate) }}</span>
        </li>
      </ol>

      <p class="debt-plan__note" data-testid="debt-plan-extra-note">
        Assuming
        <strong class="tabnum">{{ formatRM(plan.monthlyExtraCents) }}/mo</strong>
        extra thrown at debt
        <span v-if="plan.totalInterestCents > 0">
          · <span class="tabnum">{{ formatRM(plan.totalInterestCents) }}</span> total interest
        </span>
      </p>
    </template>

    <!-- ── Honest "never clears" state ── -->
    <div v-else class="debt-plan__never" role="alert" data-testid="debt-plan-never">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <div class="debt-plan__never-body">
        <p class="debt-plan__never-title">At your current surplus this never clears.</p>
        <p class="debt-plan__never-sub">
          The top debt's interest outpaces what you can pay it.
          <template v-if="plan.shortfallCents > 0">
            You need about
            <strong class="tabnum">{{ formatRM(plan.shortfallCents) }}/mo</strong>
            more to start making progress.
          </template>
        </p>
        <p class="debt-plan__never-assumption tabnum">
          Assumed extra: {{ formatRM(plan.monthlyExtraCents) }}/mo
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.debt-plan {
  margin-top: 12px;
}

/* ── Debt-free hero ── */
.debt-plan__hero {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0 14px;
}

.debt-plan__hero-eyebrow {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-muted);
}

.debt-plan__hero-date {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--positive);
}

/* ── Payoff order ── */
.debt-plan__order {
  list-style: none;
  margin: 0;
  padding: 0;
}

.debt-plan__order-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
}

.debt-plan__order-row:last-child {
  border-bottom: none;
}

.debt-plan__order-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.debt-plan__order-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.debt-plan__order-date {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

/* ── Assumption note ── */
.debt-plan__note {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.debt-plan__note strong {
  color: var(--text);
  font-weight: 700;
}

/* ── Never-clears state ── */
.debt-plan__never {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(217,119,6,.10);
  color: var(--warning);
}

.debt-plan__never-body {
  min-width: 0;
}

.debt-plan__never-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--warning);
}

.debt-plan__never-sub {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 400;
  color: var(--text);
  line-height: 1.5;
}

.debt-plan__never-sub strong {
  font-weight: 700;
}

.debt-plan__never-assumption {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
