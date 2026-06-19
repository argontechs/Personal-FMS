<!-- app/pages/index.vue -->
<!-- §4 §5 §7: Dashboard — STS hero → EF/Kill-Card progress → debt card → monthly rollup → QuickLog. -->
<!-- Session-gated: all three endpoints return 401 if no valid session (requireSession in handlers). -->
<script setup lang="ts">
import { computed } from 'vue'
import { useFetch } from '#app'
import SafeToSpendHero from '~/components/forecast/SafeToSpendHero.vue'
import SurplusRollup from '~/components/forecast/SurplusRollup.vue'
import CardDebtCard from '~/components/debt/CardDebtCard.vue'
import GoalProgressBar from '~/components/forecast/GoalProgressBar.vue'
import QuickLog from '~/components/quicklog/QuickLog.vue'
import { useSafeToSpend } from '~/composables/useSafeToSpend'
import { navigateTo } from '#app'

// All three fetches are online-first; Nuxt will throw on 401 → redirect handled by nuxtjs session
// layer or app-level error handler.
const { data: forecast, refresh: refreshForecast } = await useFetch('/api/forecast')
const { data: debt } = await useFetch('/api/debt')
const { data: goals } = await useFetch('/api/goals/progress')

// §4 §14 #20: client-side STS mirror — seed from server value, optimistic on quick-log.
// useSafeToSpend computes STS live with registerSpend reducing daily immediately.
const { sts: liveSts, registerSpend } = useSafeToSpend(() => ({
  cashNowCents: forecast.value?.cashNowCents ?? 0,
  expectedInflowsBeforeNextCents: 0,
  committedOutflowsCents: 0, // committed outflows already baked into forecast.sts from server
  savingsTargetRemainingCents: 0, // ditto — use the pre-computed sts from server for parity
  spentTodayVariableCents: 0,
  todayISO: forecast.value?.todayISO ?? new Date().toISOString().slice(0, 10),
}))

// The server-authoritative STS (from the fetch) is the primary display value on load.
// liveSts is used ONLY to drive the post-QuickLog optimistic update.
const displaySts = computed(() => {
  if (!forecast.value) return null
  return forecast.value.sts
})

// §14 D2: Δcash from the server — used by SurplusRollup to show the leak flag.
const deltaCashCents = computed(() => forecast.value?.deltaCashThisMonthCents ?? 0)

// Detect the cash account id from the first account returned by accounts endpoint.
// QuickLog needs an accountId. Use a stable fallback (1) if not yet loaded.
const { data: accounts } = await useFetch('/api/accounts')
const cashAccountId = computed(() => {
  if (!accounts.value) return 1
  const arr = Array.isArray(accounts.value) ? accounts.value : []
  const cash = arr.find((a: any) => a.type === 'cash')
  return cash?.id ?? arr[0]?.id ?? 1
})

// Logout: clear server session then redirect to login page.
async function handleLogout() {
  await $fetch('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}

// After a quick-log: optimistically decrement STS via registerSpend, then re-fetch to reconcile.
async function onLogged(txn: any) {
  const spentCents = Math.abs(txn.amount_cents ?? 0)
  registerSpend(spentCents)
  await refreshForecast()
}
</script>

<template>
  <main class="dashboard">
    <!-- Top bar: logout affordance -->
    <div class="dashboard__topbar">
      <button class="dashboard__logout" type="button" @click="handleLogout">Log out</button>
    </div>

    <!-- 1. Safe-to-Spend Hero — dominant primary number -->
    <SafeToSpendHero v-if="displaySts" :sts="displaySts" />
    <div v-else class="dashboard__skeleton" aria-label="Loading…" />

    <!-- 2. QuickLog — the daily action, placed immediately after the hero so it's always visible -->
    <section class="dashboard__section">
      <h2 class="dashboard__section-title">Log a spend</h2>
      <QuickLog :account-id="cashAccountId" @logged="onLogged" />
    </section>

    <!-- 3. EF + Kill-Card progress -->
    <section v-if="goals" class="dashboard__section">
      <h2 class="dashboard__section-title">Goals</h2>
      <div class="dashboard__goal-stack">
        <GoalProgressBar
          label="Emergency Fund"
          :current-cents="goals.ef.currentCents"
          :target-cents="goals.ef.targetCents"
          :progress="goals.ef.progress"
        />
        <GoalProgressBar
          label="Kill Credit Card"
          :current-cents="goals.killCard.currentCents"
          :target-cents="goals.killCard.baselineCents"
          :progress="goals.killCard.progress"
        />
      </div>
    </section>

    <!-- 4. Debt card -->
    <section v-if="debt" class="dashboard__section">
      <CardDebtCard :debt="debt" />
    </section>

    <!-- 5. Monthly rollup -->
    <section v-if="forecast" class="dashboard__section">
      <SurplusRollup :rollup="forecast.rollup" :delta-cash-cents="deltaCashCents" />
    </section>
  </main>
</template>

<style scoped>
.dashboard {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #f4f6fb;
  min-height: 100dvh;
}

.dashboard__skeleton {
  height: 180px;
  border-radius: 16px;
  background: #e8edf5;
  animation: shimmer 1.4s infinite;
}

@keyframes shimmer {
  0%   { opacity: 1; }
  50%  { opacity: 0.5; }
  100% { opacity: 1; }
}

.dashboard__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dashboard__section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
  padding: 0 2px;
}

.dashboard__goal-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dashboard__topbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-height: 32px;
}

.dashboard__logout {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
}

.dashboard__logout:hover {
  color: #dc2626;
  border-color: #fca5a5;
}
</style>
