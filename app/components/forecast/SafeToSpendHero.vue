<!-- app/components/forecast/SafeToSpendHero.vue -->
<!-- §4: Safe-to-Spend hero. cycleCents is always ≥0 (server clamps); negative shown via isNegative+shortfall. -->
<script setup lang="ts">
import { computed } from 'vue'
import { formatRM, type StsResult } from '../../../shared/types'

const props = defineProps<{ sts: StsResult }>()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const untilLabel = computed(() => {
  const [, m, d] = props.sts.nextInflowISO.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
})
</script>

<template>
  <section class="sts-hero">
    <template v-if="sts.isNegative">
      <!-- Never show a negative number. Show RM0 + the shortfall in red. -->
      <p class="sts-hero__until">Safe to spend until {{ untilLabel }}</p>
      <p data-testid="sts-negative" class="sts-hero__amount sts-hero__amount--red">RM0</p>
      <p class="sts-hero__shortfall">{{ formatRM(sts.shortfallCents) }} short this cycle</p>
      <p class="sts-hero__note">You're already committed past your buffer.</p>
    </template>
    <template v-else>
      <p class="sts-hero__until">Safe to spend until {{ untilLabel }}</p>
      <p class="sts-hero__amount">{{ formatRM(sts.cycleCents) }}</p>
      <div class="sts-hero__chips" role="group" aria-label="Spend rate">
        <span class="sts-chip">{{ formatRM(sts.dailyCents) }}<span class="sts-chip__unit">/day</span></span>
        <span class="sts-chip">{{ formatRM(sts.weeklyCents) }}<span class="sts-chip__unit">/week</span></span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sts-hero {
  background: #fff;
  border-radius: 16px;
  padding: 28px 20px 24px;
  text-align: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
}

.sts-hero__until {
  font-size: 0.85rem;
  color: #666;
  margin: 0 0 6px;
  letter-spacing: 0.01em;
}

.sts-hero__amount {
  font-size: 3rem;
  font-weight: 700;
  color: #1a1a2e;
  margin: 0 0 16px;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.sts-hero__amount--red {
  color: #c0392b;
}

.sts-hero__shortfall {
  font-size: 1.05rem;
  font-weight: 600;
  color: #c0392b;
  margin: 0 0 4px;
}

.sts-hero__note {
  font-size: 0.8rem;
  color: #888;
  margin: 0;
}

.sts-hero__chips {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.sts-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  background: #f0f4ff;
  color: #2c5282;
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 1rem;
  font-weight: 600;
  min-height: 44px;
  align-items: center;
}

.sts-chip__unit {
  font-size: 0.75rem;
  font-weight: 400;
  color: #5a7abf;
}
</style>
