<!-- app/components/forecast/SurplusRollup.vue -->
<!-- §4: Monthly surplus breakdown + surplus-leak flag when surplus>0 but Δcash didn't rise. -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM } from '../../../shared/types'

interface Rollup {
  incomeCents: number
  livingCents: number
  debtServiceCents: number
  interestCents: number
  rawSurplusCents: number
  surplusAfterInterestCents: number
}

const props = defineProps<{
  rollup: Rollup
  deltaCashCents: number
}>()

// §14 D2: surplus exists (rawSurplus > 0) but cash didn't rise (deltaCash ≤ 0) → money leaked somewhere.
const leaking = computed(() => props.rollup.rawSurplusCents > 0 && props.deltaCashCents <= 0)
</script>

<template>
  <section class="surplus-rollup card">
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__row-label">Income</span>
      <span class="surplus-rollup__row-value surplus-rollup__row-value--income tabnum">{{ formatRM(rollup.incomeCents) }}</span>
    </div>
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__row-label">Living costs</span>
      <span class="surplus-rollup__row-value tabnum">{{ formatRM(rollup.livingCents) }}</span>
    </div>
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__row-label">Debt service</span>
      <span class="surplus-rollup__row-value tabnum">{{ formatRM(rollup.debtServiceCents) }}</span>
    </div>
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__row-label">
        Card interest
        <span class="surplus-rollup__row-sub">carrying cost</span>
      </span>
      <span class="surplus-rollup__row-value surplus-rollup__row-value--negative tabnum">{{ formatRM(rollup.interestCents) }}</span>
    </div>

    <div class="surplus-rollup__divider" />

    <div class="surplus-rollup__row surplus-rollup__row--surplus">
      <span class="surplus-rollup__row-label surplus-rollup__row-label--strong">Surplus after interest</span>
      <span class="surplus-rollup__row-value surplus-rollup__row-value--surplus tabnum">{{ formatRM(rollup.surplusAfterInterestCents) }}</span>
    </div>

    <!-- §14 D2: leak insight -->
    <div v-if="leaking" class="surplus-rollup__leak">
      <!-- trending-down -->
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
        <polyline points="17 18 23 18 23 12"/>
      </svg>
      <span>
        You cleared <span class="tabnum">{{ formatRM(rollup.rawSurplusCents) }}</span> but it didn't land in savings.
      </span>
    </div>
  </section>
</template>

<style scoped>
.surplus-rollup {
  /* uses .card globally */
}

.surplus-rollup__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.surplus-rollup__row--surplus {
  border-bottom: none;
  padding-top: 12px;
}

.surplus-rollup__row-label {
  font-size: 14px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.surplus-rollup__row-label--strong {
  font-weight: 600;
  color: var(--text);
}

.surplus-rollup__row-sub {
  font-size: 11px;
  color: var(--text-muted);
  opacity: .7;
}

.surplus-rollup__row-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.surplus-rollup__row-value--income {
  color: var(--positive);
}

.surplus-rollup__row-value--negative {
  color: var(--negative);
}

.surplus-rollup__row-value--surplus {
  font-size: 18px;
  color: var(--primary);
}

.surplus-rollup__divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.surplus-rollup__leak {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  background: rgba(217,119,6,.08);
  border: 1px solid rgba(217,119,6,.2);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--warning);
  line-height: 1.5;
}
</style>
