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
  <section class="surplus-rollup">
    <h2 class="surplus-rollup__title">This month</h2>

    <div class="surplus-rollup__row">
      <span class="surplus-rollup__label">Income</span>
      <span class="surplus-rollup__value surplus-rollup__value--income">{{ formatRM(rollup.incomeCents) }}</span>
    </div>
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__label">Living costs</span>
      <span class="surplus-rollup__value">{{ formatRM(rollup.livingCents) }}</span>
    </div>
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__label">Debt service</span>
      <span class="surplus-rollup__value">{{ formatRM(rollup.debtServiceCents) }}</span>
    </div>
    <div class="surplus-rollup__row">
      <span class="surplus-rollup__label">Card interest <span class="surplus-rollup__sub">(carrying cost)</span></span>
      <span class="surplus-rollup__value surplus-rollup__value--interest">{{ formatRM(rollup.interestCents) }}</span>
    </div>

    <div class="surplus-rollup__divider" />

    <div class="surplus-rollup__row surplus-rollup__row--surplus">
      <span class="surplus-rollup__label surplus-rollup__label--strong">Surplus after interest</span>
      <span class="surplus-rollup__value surplus-rollup__value--surplus">{{ formatRM(rollup.surplusAfterInterestCents) }}</span>
    </div>

    <!-- §14 D2: leak insight — surplus > 0 but cash didn't rise -->
    <div v-if="leaking" class="surplus-rollup__leak">
      <span class="surplus-rollup__leak-icon">~</span>
      <span>
        You cleared {{ formatRM(rollup.rawSurplusCents) }} but it didn't land in savings.
      </span>
    </div>
  </section>
</template>

<style scoped>
.surplus-rollup {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.surplus-rollup__title {
  font-size: 0.78rem;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 14px;
}

.surplus-rollup__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px solid #f5f5f5;
}

.surplus-rollup__row--surplus {
  border-bottom: none;
  padding-top: 12px;
}

.surplus-rollup__label {
  font-size: 0.85rem;
  color: #777;
}

.surplus-rollup__label--strong {
  font-weight: 600;
  color: #333;
}

.surplus-rollup__sub {
  font-size: 0.72rem;
  color: #aaa;
}

.surplus-rollup__value {
  font-size: 0.9rem;
  font-weight: 600;
  color: #1a1a2e;
}

.surplus-rollup__value--income {
  color: #276749;
}

.surplus-rollup__value--interest {
  color: #c0392b;
}

.surplus-rollup__value--surplus {
  font-size: 1.1rem;
  color: #2c5282;
}

.surplus-rollup__divider {
  height: 1px;
  background: #e8e8e8;
  margin: 4px 0;
}

.surplus-rollup__leak {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  background: #fff8e1;
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 0.85rem;
  color: #7d5a00;
  line-height: 1.5;
}

.surplus-rollup__leak-icon {
  font-weight: 800;
  font-size: 1.1rem;
  flex-shrink: 0;
  color: #b7791f;
}
</style>
