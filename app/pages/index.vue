<!-- app/pages/index.vue -->
<!-- §4 §5 §7: Dashboard — STS hero → QuickLog → Goals → Debt → Monthly rollup. -->
<!-- Session-gated: all three endpoints return 401 if no valid session (requireSession in handlers). -->
<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
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
const { data: forecast, refresh: refreshForecast, error: forecastError } = await useFetch('/api/forecast')
const { data: debt, error: debtError } = await useFetch('/api/debt')
const { data: goals, refresh: refreshGoals, error: goalsError } = await useFetch('/api/goals/progress')

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

// Resolve the EF savings account and the main bank (checking) account ids from /api/accounts.
const efAccountId = computed(() => {
  if (!accounts.value) return null
  const arr = Array.isArray(accounts.value) ? accounts.value : []
  const ef = arr.find((a: any) => a.type === 'savings')
  return ef?.id ?? null
})

const bankAccountId = computed(() => {
  if (!accounts.value) return null
  const arr = Array.isArray(accounts.value) ? accounts.value : []
  // Primary bank: type === 'checking', or fall back to first non-savings account
  const bank = arr.find((a: any) => a.type === 'checking') ?? arr.find((a: any) => a.type !== 'savings')
  return bank?.id ?? null
})

// After a quick-log: optimistically decrement STS via registerSpend, then re-fetch to reconcile.
async function onLogged(txn: any) {
  const spentCents = Math.abs(txn.amount_cents ?? 0)
  registerSpend(spentCents)
  await refreshForecast()
}

// ─── Dashboard error state ────────────────────────────────────────────────────
const dashboardError = computed(() => forecastError.value ?? goalsError.value ?? null)

async function retryDashboard() {
  await Promise.all([refreshForecast(), refreshGoals()])
}

// ─── Move-to-EF sheet ─────────────────────────────────────────────────────────
const sheetOpen = ref(false)
const sheetAmountRM = ref('')
const sheetError = ref('')
const sheetSubmitting = ref(false)
const sheetInputRef = ref<HTMLInputElement | null>(null)

// Suggested amount = remaining-to-target for this cycle.
const suggestedSavingsCents = computed(() => {
  if (!goals.value?.ef) return 0
  const remaining = goals.value.ef.targetCents - goals.value.ef.currentCents
  return Math.max(0, remaining)
})

const availableCashCents = computed(() => forecast.value?.cashNowCents ?? 0)

function openSheet(prefillCents?: number) {
  const cents = prefillCents ?? suggestedSavingsCents.value
  sheetAmountRM.value = cents > 0 ? (cents / 100).toFixed(2) : ''
  sheetError.value = ''
  sheetSubmitting.value = false
  sheetOpen.value = true
  nextTick(() => sheetInputRef.value?.focus())
}

function closeSheet() {
  sheetOpen.value = false
  sheetError.value = ''
}

async function submitTransfer() {
  sheetError.value = ''
  const rmVal = parseFloat(sheetAmountRM.value)
  if (!sheetAmountRM.value || isNaN(rmVal) || rmVal <= 0) {
    sheetError.value = 'Enter a valid amount greater than RM0.'
    return
  }
  const amountCents = Math.round(rmVal * 100)
  if (amountCents > availableCashCents.value) {
    const available = (availableCashCents.value / 100).toFixed(2)
    sheetError.value = `Amount exceeds available cash (RM${available}).`
    return
  }
  if (!bankAccountId.value || !efAccountId.value) {
    sheetError.value = 'Account information not available. Please refresh.'
    return
  }

  sheetSubmitting.value = true
  try {
    await $fetch('/api/transfers', {
      method: 'POST',
      body: {
        uuid: crypto.randomUUID(),
        date: (forecast.value?.todayISO ?? new Date().toISOString().slice(0, 10)),
        amount_cents: amountCents,
        from_account_id: bankAccountId.value,
        to_account_id: efAccountId.value,
        note: 'Emergency fund',
        source: 'manual',
      },
    })
    closeSheet()
    paydaySkipped.value = true // hide payday prompt after successful move
    await Promise.all([refreshForecast(), refreshGoals()])
  } catch (err: any) {
    sheetError.value = err?.data?.statusMessage ?? err?.message ?? 'Transfer failed. Please try again.'
  } finally {
    sheetSubmitting.value = false
  }
}

// ─── Payday prompt ────────────────────────────────────────────────────────────
const paydaySkipped = ref(false)

// Income landed = rollup.incomeCents > 0 this cycle.
// Savings target not met = EF progress < 1.
// Show prompt when both are true and not skipped/moved.
const showPaydayPrompt = computed(() => {
  if (paydaySkipped.value) return false
  const income = forecast.value?.rollup?.incomeCents ?? 0
  const efProgress = goals.value?.ef?.progress ?? 1
  return income > 0 && efProgress < 1
})

const paydayIncomeCents = computed(() => forecast.value?.rollup?.incomeCents ?? 0)

function skipPayday() {
  paydaySkipped.value = true
}

function movePayday() {
  openSheet(suggestedSavingsCents.value)
  paydaySkipped.value = true
}

function adjustPayday() {
  openSheet(suggestedSavingsCents.value)
}
</script>

<template>
  <div class="dashboard">

    <!-- Dashboard error state — H3 fix: bind error and show retry instead of RM0 shimmer -->
    <div
      v-if="dashboardError"
      class="card dashboard__error"
      role="alert"
      aria-live="assertive"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="dashboard__error-icon">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p class="dashboard__error-msg">Dashboard data couldn't be loaded.</p>
      <button class="btn-primary dashboard__retry-btn" type="button" @click="retryDashboard">
        Retry
      </button>
    </div>

    <template v-else>
      <!-- Payday prompt — shown at top when income landed and EF target not yet met -->
      <div
        v-if="showPaydayPrompt"
        class="card dashboard__payday"
        data-test="payday-prompt"
        role="status"
        aria-live="polite"
      >
        <div class="dashboard__payday-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
          <span class="dashboard__payday-title">Income landed this cycle</span>
        </div>
        <p class="dashboard__payday-body">
          <span class="tabnum">RM{{ (paydayIncomeCents / 100).toFixed(2) }}</span> landed — move
          <span class="tabnum">RM{{ (suggestedSavingsCents / 100).toFixed(2) }}</span> to your emergency fund?
        </p>
        <div class="dashboard__payday-actions">
          <button
            class="btn-primary dashboard__payday-btn"
            type="button"
            aria-label="Move suggested amount to emergency fund"
            @click="movePayday"
          >Move</button>
          <button
            class="dashboard__payday-secondary"
            type="button"
            aria-label="Adjust the amount to move"
            @click="adjustPayday"
          >Adjust</button>
          <button
            class="dashboard__payday-ghost"
            type="button"
            aria-label="Skip this payday prompt for now"
            @click="skipPayday"
          >Skip</button>
        </div>
      </div>

      <!-- 1. Safe-to-Spend Hero — the dominant primary number -->
      <SafeToSpendHero v-if="displaySts" :sts="displaySts" />
      <div v-else class="dashboard__skeleton" aria-label="Loading…" />

      <!-- 2. QuickLog — the daily action, immediately below the hero -->
      <section class="dashboard__section">
        <p class="section-label">Log a transaction</p>
        <div class="card dashboard__quicklog-card">
          <QuickLog
            :account-id="cashAccountId"
            :accounts="Array.isArray(accounts) ? accounts : []"
            @logged="onLogged"
          />
        </div>
      </section>

      <!-- 3. EF + Kill-Card progress -->
      <section v-if="goals" class="dashboard__section">
        <p class="section-label">Goals</p>
        <div class="dashboard__goal-stack">
          <div class="card dashboard__ef-card">
            <GoalProgressBar
              label="Emergency Fund"
              :current-cents="goals.ef.currentCents"
              :target-cents="goals.ef.targetCents"
              :progress="goals.ef.progress"
            />
            <button
              class="btn-primary dashboard__move-btn"
              type="button"
              data-test="move-to-ef"
              aria-label="Move money to emergency fund savings account"
              @click="openSheet()"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7"/>
              </svg>
              Move to savings
            </button>
          </div>
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
        <p class="section-label">Credit Card</p>
        <CardDebtCard :debt="debt" />
      </section>

      <!-- 5. Monthly rollup -->
      <section v-if="forecast" class="dashboard__section">
        <p class="section-label">This month</p>
        <SurplusRollup :rollup="forecast.rollup" :delta-cash-cents="deltaCashCents" />
      </section>
    </template>

    <!-- Move-to-EF bottom sheet overlay -->
    <Teleport to="body">
      <div
        v-if="sheetOpen"
        class="sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Move money to emergency fund"
        @click.self="closeSheet"
        @keydown.esc="closeSheet"
      >
        <div class="sheet">
          <div class="sheet__handle" aria-hidden="true" />
          <div class="sheet__header">
            <h2 class="sheet__title">Move to Emergency Fund</h2>
            <button
              class="sheet__close"
              type="button"
              aria-label="Close sheet"
              @click="closeSheet"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div class="sheet__body">
            <p class="sheet__hint">
              Available: <span class="tabnum">RM{{ (availableCashCents / 100).toFixed(2) }}</span>
            </p>

            <label class="sheet__label" for="ef-amount">Amount (RM)</label>
            <input
              id="ef-amount"
              ref="sheetInputRef"
              v-model="sheetAmountRM"
              class="input sheet__input"
              type="number"
              inputmode="decimal"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              autocomplete="off"
              :disabled="sheetSubmitting"
              @keydown.enter="submitTransfer"
            />

            <p v-if="sheetError" class="sheet__error" role="alert">{{ sheetError }}</p>

            <button
              class="btn-primary sheet__confirm"
              type="button"
              :disabled="sheetSubmitting"
              @click="submitTransfer"
            >
              {{ sheetSubmitting ? 'Moving…' : 'Confirm transfer' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Shimmer skeleton while STS loads */
.dashboard__skeleton {
  height: 200px;
  border-radius: var(--radius-card);
  background: var(--surface-2);
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

.dashboard__section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dashboard__goal-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* QuickLog sits inside a card with no extra padding — QuickLog has its own padding */
.dashboard__quicklog-card {
  padding: 0;
  overflow: hidden;
}

/* ─── EF card ─────────────────────────────────────────── */
.dashboard__ef-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dashboard__move-btn {
  width: 100%;
  min-height: 44px;
}

/* ─── Payday prompt ───────────────────────────────────── */
.dashboard__payday {
  border-left: 4px solid var(--positive);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dashboard__payday-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--positive);
}

.dashboard__payday-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--positive);
}

.dashboard__payday-body {
  font-size: 15px;
  color: var(--text);
  margin: 0;
  line-height: 1.5;
}

.dashboard__payday-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dashboard__payday-btn {
  min-height: 44px;
  height: 44px;
  padding: 0 16px;
  font-size: 15px;
}

.dashboard__payday-secondary {
  min-height: 44px;
  height: 44px;
  padding: 0 16px;
  border: 1.5px solid var(--primary);
  border-radius: var(--radius-btn);
  background: transparent;
  color: var(--primary);
  font-family: var(--font-base);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.dashboard__payday-secondary:hover:not(:disabled) {
  background: rgba(30, 64, 175, 0.06);
}
.dashboard__payday-secondary:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.dashboard__payday-ghost {
  min-height: 44px;
  height: 44px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.dashboard__payday-ghost:hover:not(:disabled) {
  color: var(--text);
}
.dashboard__payday-ghost:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* ─── Dashboard error ─────────────────────────────────── */
.dashboard__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 32px 20px;
}

.dashboard__error-icon {
  color: var(--negative);
  flex-shrink: 0;
}

.dashboard__error-msg {
  margin: 0;
  font-size: 15px;
  color: var(--text-muted);
}

.dashboard__retry-btn {
  min-height: 44px;
  padding: 0 24px;
}

/* ─── Bottom sheet ────────────────────────────────────── */
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
  animation: overlay-in 180ms ease-out;
}

@keyframes overlay-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.sheet {
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  border-radius: 20px 20px 0 0;
  box-shadow: var(--shadow-lg);
  padding: 16px 20px 32px;
  animation: sheet-in 220ms ease-out;
  padding-bottom: max(32px, env(safe-area-inset-bottom));
}

@keyframes sheet-in {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}

.sheet__handle {
  width: 40px;
  height: 4px;
  background: var(--border);
  border-radius: 999px;
  margin: 0 auto 16px;
}

.sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.sheet__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.sheet__close {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--surface-2);
  border-radius: var(--radius-btn);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.sheet__close:hover {
  background: var(--border);
}
.sheet__close:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.sheet__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sheet__hint {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
}

.sheet__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: block;
}

.sheet__input {
  margin-top: 4px;
}

.sheet__error {
  font-size: 14px;
  color: var(--negative);
  margin: 0;
}

.sheet__confirm {
  width: 100%;
  min-height: 44px;
  margin-top: 4px;
}
</style>
