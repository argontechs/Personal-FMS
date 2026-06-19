<!-- app/pages/settings.vue
     Settings screen — correct cash balance, EF target, reminders, bills link, logout.
     Auth is global (auth.global.ts); do NOT add definePageMeta({ middleware: 'auth' }). -->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useFetch, navigateTo } from '#app'
import { usePush } from '~/composables/usePush'

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatRM(cents: number): string {
  return 'RM' + (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Goals data (EF target) ─────────────────────────────────────────────────────
const { data: goalsData, refresh: refreshGoals } = await useFetch('/api/goals/progress')
const currentEfTarget = computed(() => (goalsData.value as any)?.ef?.targetCents ?? 0)
const currentEfCents = computed(() => (goalsData.value as any)?.ef?.currentCents ?? 0)

// ── Accounts data (cash balance) ───────────────────────────────────────────────
const { data: accountsData, refresh: refreshAccounts } = await useFetch('/api/accounts')
const cashAccounts = computed(() => {
  const list = (accountsData.value as any[]) ?? []
  return list.filter((a: any) => a.type === 'cash' && a.is_active)
})
const primaryCashAccount = computed(() => cashAccounts.value[0] ?? null)

// ── Section 1: Correct Cash Balance ───────────────────────────────────────────
const cashAmountRM = ref('')
const cashSubmitting = ref(false)
const cashSuccess = ref(false)
const cashError = ref('')

async function submitCashCorrection() {
  if (!primaryCashAccount.value) return
  const rmVal = parseFloat(cashAmountRM.value)
  if (isNaN(rmVal) || rmVal < 0) {
    cashError.value = 'Enter a valid amount (0 or more).'
    return
  }
  const target_cents = Math.round(rmVal * 100)
  cashError.value = ''
  cashSubmitting.value = true
  cashSuccess.value = false
  try {
    await $fetch('/api/accounts/correct-cash', {
      method: 'POST',
      body: { account_id: primaryCashAccount.value.id, target_cents },
    })
    cashSuccess.value = true
    cashAmountRM.value = ''
    await refreshAccounts()
  } catch (e: any) {
    cashError.value = e?.data?.statusMessage ?? e?.message ?? 'Failed to correct cash balance.'
  } finally {
    cashSubmitting.value = false
  }
}

// ── Section 2: Emergency Fund Target ──────────────────────────────────────────
const efCustomRM = ref('')
const efSubmitting = ref(false)
const efSuccess = ref(false)
const efError = ref('')

async function setEfTarget(cents: number) {
  efError.value = ''
  efSuccess.value = false
  efSubmitting.value = true
  try {
    await $fetch('/api/goals/ef-target', {
      method: 'PATCH',
      body: { targetAmountCents: cents },
    })
    efSuccess.value = true
    efCustomRM.value = ''
    await refreshGoals()
  } catch (e: any) {
    efError.value = e?.data?.statusMessage ?? e?.message ?? 'Failed to update EF target.'
  } finally {
    efSubmitting.value = false
  }
}

async function submitEfCustom() {
  const rmVal = parseFloat(efCustomRM.value)
  if (isNaN(rmVal) || rmVal <= 0) {
    efError.value = 'Enter a positive amount.'
    return
  }
  await setEfTarget(Math.round(rmVal * 100))
}

// ── Section 3: Reminders (push notifications) ─────────────────────────────────
const push = usePush()
const pushEnabling = ref(false)
const pushError = ref('')
const pushSuccess = ref(false)

async function handleEnablePush() {
  pushError.value = ''
  pushSuccess.value = false
  pushEnabling.value = true
  try {
    const result = await push.enable()
    if (result.ok) {
      pushSuccess.value = true
    } else {
      pushError.value =
        result.reason === 'denied' ? 'Permission denied by browser.' :
        result.reason === 'install-first' ? 'Add to Home Screen first (see note below).' :
        result.reason === 'no-vapid-key' ? 'Push not configured on server.' :
        'Could not enable notifications.'
    }
  } catch (e: any) {
    pushError.value = e?.message ?? 'Unknown error enabling notifications.'
  } finally {
    pushEnabling.value = false
  }
}

// ── Section 5: Log out ─────────────────────────────────────────────────────────
const logoutLoading = ref(false)
async function handleLogout() {
  logoutLoading.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
  } finally {
    logoutLoading.value = false
  }
  await navigateTo('/login')
}
</script>

<template>
  <div class="settings-page">
    <h1 class="settings-page__title">Settings</h1>

    <!-- ── Section 1: Correct Cash Balance ─────────────────────────────────── -->
    <section class="settings-section" aria-labelledby="cash-heading">
      <h2 id="cash-heading" class="section-label">Correct Cash Balance</h2>
      <div class="card">
        <p class="settings-card__meta" v-if="primaryCashAccount">
          Current:
          <span class="tabnum settings-card__meta-value">
            {{ formatRM(primaryCashAccount.balance_cents) }}
          </span>
          <span class="settings-card__account-name">({{ primaryCashAccount.name }})</span>
        </p>
        <p class="settings-card__meta settings-card__meta--muted" v-else>
          No cash account found.
        </p>

        <form class="settings-form" @submit.prevent="submitCashCorrection" novalidate>
          <label class="settings-form__label" for="cash-amount">
            Set new cash balance (RM)
          </label>
          <input
            id="cash-amount"
            v-model="cashAmountRM"
            class="input settings-form__input"
            type="number"
            inputmode="decimal"
            min="0"
            step="0.01"
            placeholder="e.g. 150.00"
            :disabled="cashSubmitting || !primaryCashAccount"
            autocomplete="off"
          />
          <p v-if="cashError" class="settings-form__error" role="alert">{{ cashError }}</p>
          <p v-if="cashSuccess" class="settings-form__success" role="status">Cash balance updated.</p>
          <button
            type="submit"
            class="btn-primary settings-form__btn"
            :disabled="cashSubmitting || !primaryCashAccount"
          >
            {{ cashSubmitting ? 'Saving…' : 'Update Cash Balance' }}
          </button>
        </form>
      </div>
    </section>

    <!-- ── Section 2: Emergency Fund Target ────────────────────────────────── -->
    <section class="settings-section" aria-labelledby="ef-heading">
      <h2 id="ef-heading" class="section-label">Emergency Fund Target</h2>
      <div class="card">
        <p class="settings-card__meta">
          Current target:
          <span class="tabnum settings-card__meta-value">{{ formatRM(currentEfTarget) }}</span>
        </p>
        <p class="settings-card__meta settings-card__meta--muted">
          Saved so far:
          <span class="tabnum settings-card__meta-value--positive">{{ formatRM(currentEfCents) }}</span>
        </p>

        <div class="settings-presets">
          <button
            type="button"
            class="settings-preset-btn"
            :disabled="efSubmitting"
            @click="setEfTarget(100000)"
          >
            RM 1,000
          </button>
          <button
            type="button"
            class="settings-preset-btn"
            :disabled="efSubmitting"
            @click="setEfTarget(1500000)"
          >
            RM 15,000
          </button>
        </div>

        <form class="settings-form settings-form--inline" @submit.prevent="submitEfCustom" novalidate>
          <label class="settings-form__label" for="ef-custom">Custom target (RM)</label>
          <div class="settings-form__row">
            <input
              id="ef-custom"
              v-model="efCustomRM"
              class="input settings-form__input"
              type="number"
              inputmode="decimal"
              min="0.01"
              step="0.01"
              placeholder="e.g. 5000.00"
              :disabled="efSubmitting"
              autocomplete="off"
            />
            <button
              type="submit"
              class="btn-primary settings-form__btn settings-form__btn--compact"
              :disabled="efSubmitting"
            >
              {{ efSubmitting ? 'Saving…' : 'Set' }}
            </button>
          </div>
        </form>
        <p v-if="efError" class="settings-form__error" role="alert">{{ efError }}</p>
        <p v-if="efSuccess" class="settings-form__success" role="status">EF target updated.</p>
      </div>
    </section>

    <!-- ── Section 3: Reminders ─────────────────────────────────────────────── -->
    <section class="settings-section" aria-labelledby="reminders-heading">
      <h2 id="reminders-heading" class="section-label">Reminders</h2>
      <div class="card">
        <div class="settings-push-status">
          <span class="settings-push-status__label">Push notifications</span>
          <span
            class="badge"
            :class="{
              'badge--green': push.permission.value === 'granted',
              'badge--amber': push.permission.value === 'default',
              'badge--red':   push.permission.value === 'denied' || push.permission.value === 'unsupported',
            }"
          >
            {{
              push.permission.value === 'granted'    ? 'Enabled' :
              push.permission.value === 'denied'     ? 'Blocked' :
              push.permission.value === 'unsupported'? 'Unsupported' :
              'Not enabled'
            }}
          </span>
        </div>

        <!-- iOS non-standalone banner -->
        <div v-if="push.showInstallBanner.value" class="settings-ios-banner" role="note">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" class="settings-ios-banner__icon">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p class="settings-ios-banner__text">
            <strong>iPhone users:</strong> Tap the Share button in Safari, then
            <strong>Add to Home Screen</strong>, and open the app from there to enable push notifications.
          </p>
        </div>

        <button
          v-if="push.canEnable.value && push.permission.value !== 'granted'"
          type="button"
          class="btn-primary settings-push-btn"
          :disabled="pushEnabling"
          @click="handleEnablePush"
        >
          {{ pushEnabling ? 'Requesting…' : 'Enable Notifications' }}
        </button>
        <p v-if="pushError" class="settings-form__error" role="alert">{{ pushError }}</p>
        <p v-if="pushSuccess" class="settings-form__success" role="status">Notifications enabled!</p>
      </div>
    </section>

    <!-- ── Section 4: Bills & Subscriptions ─────────────────────────────────── -->
    <section class="settings-section" aria-labelledby="bills-heading">
      <h2 id="bills-heading" class="section-label">Bills &amp; Subscriptions</h2>
      <div class="card settings-link-card" role="button" tabindex="0"
        @click="navigateTo('/bills')"
        @keydown.enter.prevent="navigateTo('/bills')"
        @keydown.space.prevent="navigateTo('/bills')"
      >
        <div class="settings-link-row">
          <div class="settings-link-row__content">
            <!-- receipt icon -->
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true" class="settings-link-row__icon">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            <span class="settings-link-row__label">Manage Bills &amp; Subscriptions</span>
          </div>
          <!-- chevron right -->
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" class="settings-link-row__chevron">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    </section>

    <!-- ── Section 5: Log out ───────────────────────────────────────────────── -->
    <section class="settings-section settings-section--danger" aria-labelledby="logout-heading">
      <h2 id="logout-heading" class="section-label">Account</h2>
      <div class="card">
        <button
          type="button"
          class="settings-logout-btn"
          :disabled="logoutLoading"
          @click="handleLogout"
        >
          <!-- log-out icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {{ logoutLoading ? 'Logging out…' : 'Log out' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 460px;
  margin: 0 auto;
  padding: 20px var(--gutter) 88px;
}

.settings-page__title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.02em;
  margin: 0 0 24px;
}

/* ── Sections ─────────────────────────────────────────────── */
.settings-section {
  margin-bottom: var(--section-gap);
}

/* ── Card meta lines ──────────────────────────────────────── */
.settings-card__meta {
  font-size: 14px;
  color: var(--text);
  margin: 0 0 4px;
}
.settings-card__meta--muted {
  color: var(--text-muted);
}
.settings-card__meta-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.settings-card__meta-value--positive {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--positive);
}
.settings-card__account-name {
  color: var(--text-muted);
  font-size: 13px;
  margin-left: 4px;
}

/* ── Forms ────────────────────────────────────────────────── */
.settings-form {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-form--inline {
  margin-top: 12px;
}
.settings-form__label {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
}
.settings-form__input {
  /* inherits .input from tokens.css */
}
.settings-form__btn {
  width: 100%;
}
.settings-form__btn--compact {
  width: auto;
  flex-shrink: 0;
}
.settings-form__row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.settings-form__row .settings-form__input {
  flex: 1;
}
.settings-form__error {
  font-size: 13px;
  color: var(--negative);
  margin: 0;
}
.settings-form__success {
  font-size: 13px;
  color: var(--positive);
  font-weight: 500;
  margin: 0;
}

/* ── EF presets ───────────────────────────────────────────── */
.settings-presets {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.settings-preset-btn {
  flex: 1;
  min-width: 100px;
  height: 44px;
  padding: 0 12px;
  border: 1.5px solid var(--primary);
  border-radius: var(--radius-btn);
  background: transparent;
  color: var(--primary);
  font-family: var(--font-base);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.settings-preset-btn:hover:not(:disabled) {
  background: var(--primary);
  color: var(--on-primary);
}
.settings-preset-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.settings-preset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.settings-preset-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* ── Push notifications ───────────────────────────────────── */
.settings-push-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.settings-push-status__label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.settings-push-btn {
  width: 100%;
}
.settings-ios-banner {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--surface-2);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 16px;
}
.settings-ios-banner__icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--warning);
}
.settings-ios-banner__text {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

/* ── Bills link card ──────────────────────────────────────── */
.settings-link-card {
  cursor: pointer;
  transition: box-shadow 150ms ease-out;
}
.settings-link-card:hover {
  box-shadow: var(--shadow-lg);
}
.settings-link-card:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: var(--radius-card);
}
.settings-link-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
}
.settings-link-row__content {
  display: flex;
  align-items: center;
  gap: 12px;
}
.settings-link-row__icon {
  color: var(--primary);
  flex-shrink: 0;
}
.settings-link-row__label {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}
.settings-link-row__chevron {
  color: var(--text-muted);
}

/* ── Logout ───────────────────────────────────────────────── */
.settings-logout-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 20px;
  border: 1.5px solid var(--negative);
  border-radius: var(--radius-btn);
  background: transparent;
  color: var(--negative);
  font-family: var(--font-base);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  width: 100%;
  justify-content: center;
}
.settings-logout-btn:hover:not(:disabled) {
  background: var(--negative);
  color: #fff;
}
.settings-logout-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.settings-logout-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.settings-logout-btn:focus-visible {
  outline: 2px solid var(--negative);
  outline-offset: 2px;
}
</style>
