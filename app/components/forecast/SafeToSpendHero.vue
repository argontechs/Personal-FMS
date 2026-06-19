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
  <section class="sts-hero card">
    <template v-if="sts.isNegative">
      <p class="sts-hero__until">Safe to spend until {{ untilLabel }}</p>
      <p data-testid="sts-negative" class="sts-hero__amount sts-hero__amount--negative tabnum">RM0</p>
      <p class="sts-hero__shortfall tabnum">{{ formatRM(sts.shortfallCents) }} short this cycle</p>
      <p class="sts-hero__note">You're already committed past your buffer.</p>
    </template>
    <template v-else>
      <p class="sts-hero__until">Safe to spend until {{ untilLabel }}</p>
      <p class="sts-hero__amount tabnum">{{ formatRM(sts.cycleCents) }}</p>
      <div class="sts-hero__chips" role="group" aria-label="Spend rate">
        <span class="sts-chip tabnum">
          {{ formatRM(sts.dailyCents) }}<span class="sts-chip__unit">/day</span>
        </span>
        <span class="sts-chip tabnum">
          {{ formatRM(sts.weeklyCents) }}<span class="sts-chip__unit">/week</span>
        </span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sts-hero {
  text-align: center;
  padding: 32px 24px 28px;
  /* Faint blue-tinted gradient + elevated tinted shadow for hero presence */
  background:
    radial-gradient(140% 110% at 50% -20%, color-mix(in srgb, var(--primary) 9%, var(--surface)) 0%, var(--surface) 62%);
  box-shadow: var(--shadow-hero);
}

.sts-hero__until {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-muted);
  margin: 0 0 10px;
  letter-spacing: 0.005em;
}

.sts-hero__amount {
  font-size: clamp(44px, 13vw, 60px);
  font-weight: 700;
  color: var(--text);
  margin: 0 0 18px;
  line-height: 1.0;
  letter-spacing: -0.03em;
}

.sts-hero__amount--negative {
  color: var(--negative);
}

.sts-hero__shortfall {
  font-size: 16px;
  font-weight: 600;
  color: var(--negative);
  margin: 0 0 4px;
}

.sts-hero__note {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.sts-hero__chips {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.sts-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--primary-tint);
  color: var(--primary);
  border-radius: var(--radius-chip);
  padding: 8px 16px;
  font-size: 15px;
  font-weight: 600;
  min-height: 44px;
}

.sts-chip__unit {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 1px;
}
</style>
