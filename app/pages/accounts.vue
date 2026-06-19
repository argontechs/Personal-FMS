<!-- app/pages/accounts.vue
     Accounts & Debts overview — all account balances (excl. card account) + all 7 debts in
     avalanche order (priority_rank) + net position summary at the top.
     Card account is shown under Debts only, never double-counted as an asset. -->
<script setup lang="ts">
import { computed } from 'vue'
import { useFetch } from '#app'
import { formatRM } from '../../shared/types'

definePageMeta({ middleware: 'auth' })

// ── API data ─────────────────────────────────────────────────────────────────
const { data: accounts, error: accountsError, refresh: refreshAccounts } =
  await useFetch('/api/accounts')

const { data: allDebts, error: debtsError, refresh: refreshDebts } =
  await useFetch('/api/debts')

// ── Derived values ────────────────────────────────────────────────────────────

/** Accounts that are NOT credit cards (never double-count the card as an asset) */
const assetAccounts = computed(() => {
  if (!accounts.value) return []
  return (accounts.value as any[]).filter(a => a.type !== 'card' && a.is_active !== false)
})

const spendableAccounts = computed(() =>
  assetAccounts.value.filter(a => ['cash', 'bank', 'ewallet'].includes(a.type))
)

const savingsAccounts = computed(() =>
  assetAccounts.value.filter(a => a.type === 'savings')
)

/** Total assets = sum of spendable + savings (no card) */
const totalAssetsCents = computed(() =>
  assetAccounts.value.reduce((s: number, a: any) => s + (a.balance_cents ?? 0), 0)
)

/** Total debts = sum of all debt balances */
const totalDebtsCents = computed(() => {
  if (!allDebts.value) return 0
  return (allDebts.value as any[]).reduce((s: number, d: any) => s + (d.balance_cents ?? 0), 0)
})

/** Net = assets − debts (can be negative) */
const netCents = computed(() => totalAssetsCents.value - totalDebtsCents.value)
const netIsPositive = computed(() => netCents.value >= 0)

// ── Debt display helpers ──────────────────────────────────────────────────────

function rateLabel(debt: any): string {
  if (debt.rate_type === 'apr' && debt.apr_bps != null) {
    return `${(debt.apr_bps / 100).toFixed(2).replace(/\.?0+$/, '')}% APR`
  }
  if (debt.rate_type === 'flat' && debt.flat_rate_bps != null) {
    return `${(debt.flat_rate_bps / 100).toFixed(2).replace(/\.?0+$/, '')}% flat`
  }
  return '—'
}

function payoffProgress(debt: any): number {
  const baseline = debt.payoff_baseline_cents
  const current = debt.balance_cents
  if (!baseline || baseline <= 0) return 0
  return Math.min(1, Math.max(0, (baseline - current) / baseline))
}

function hasProgress(debt: any): boolean {
  return debt.payoff_baseline_cents != null && debt.payoff_baseline_cents > 0
}

/** The top-priority debt (rank 1 = the kill target, usually the 18% card) */
const topPriorityId = computed(() => {
  if (!allDebts.value || !(allDebts.value as any[]).length) return null
  const ranked = (allDebts.value as any[]).filter(d => d.priority_rank != null)
  if (!ranked.length) return null
  return ranked.reduce((a: any, b: any) => (a.priority_rank < b.priority_rank ? a : b)).id
})

// ── Account type icon lookup ─────────────────────────────────────────────────
// Returns one of: 'bank', 'cash', 'ewallet', 'savings'
function accountIconType(type: string): string {
  return type
}

// ── Error/loading state ───────────────────────────────────────────────────────
const isLoading = computed(() => accounts.value === null && !accountsError.value)
const hasError = computed(() => !!(accountsError.value || debtsError.value))

async function retry() {
  await Promise.all([refreshAccounts(), refreshDebts()])
}
</script>

<template>
  <div class="accts-page">
    <h1 class="accts-page__title">Accounts &amp; Debts</h1>

    <!-- ── Loading ── -->
    <div v-if="isLoading" class="accts-loading" aria-live="polite" aria-label="Loading accounts">
      <div class="accts-loading__spinner" aria-hidden="true"></div>
      <span>Loading…</span>
    </div>

    <!-- ── Error ── -->
    <div v-else-if="hasError" role="alert" class="card accts-error">
      <p class="accts-error__msg">Data couldn't be loaded. Check your connection and try again.</p>
      <button type="button" class="btn-primary" style="margin-top:12px" @click="retry">Retry</button>
    </div>

    <!-- ── Content ── -->
    <template v-else>
      <!-- Net position summary -->
      <section class="card accts-net" aria-label="Net financial position">
        <p class="section-label">Net position</p>
        <div class="accts-net__row">
          <div class="accts-net__item">
            <span class="accts-net__item-label">Total assets</span>
            <span class="accts-net__item-value tabnum">{{ formatRM(totalAssetsCents) }}</span>
          </div>
          <div class="accts-net__item">
            <span class="accts-net__item-label">Total debts</span>
            <span class="accts-net__item-value tabnum" style="color:var(--negative)">{{ formatRM(totalDebtsCents) }}</span>
          </div>
          <div class="accts-net__divider" aria-hidden="true"></div>
          <div class="accts-net__item accts-net__item--net">
            <span class="accts-net__item-label">Net</span>
            <span
              class="accts-net__item-value accts-net__item-value--net tabnum"
              :class="netIsPositive ? 'accts-net__item-value--pos' : 'accts-net__item-value--neg'"
            >
              <span class="accts-net__sign" aria-hidden="true">{{ netIsPositive ? '▲' : '▼' }}</span>
              {{ netIsPositive ? '' : '−' }}{{ formatRM(Math.abs(netCents)) }}
              <span class="accts-net__sign-label">{{ netIsPositive ? 'surplus' : 'deficit' }}</span>
            </span>
          </div>
        </div>
        <p class="accts-net__caveat">
          Investment &amp; insurance holdings (AIA, GE, ASNB) aren't tracked yet — coming in a later update.
        </p>
      </section>

      <!-- ── Accounts section ── -->
      <section aria-labelledby="accts-heading">
        <h2 id="accts-heading" class="accts-section-heading">Accounts</h2>

        <!-- Spendable group -->
        <div v-if="spendableAccounts.length" class="card accts-card" style="margin-bottom:12px">
          <p class="section-label">Spendable</p>
          <ul class="accts-list" role="list">
            <li
              v-for="acct in spendableAccounts"
              :key="acct.id"
              class="accts-list__row"
            >
              <span class="accts-list__icon-wrap" :aria-label="acct.type + ' account'" aria-hidden="true">
                <!-- bank icon -->
                <svg v-if="accountIconType(acct.type) === 'bank'"
                  xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <line x1="3" y1="22" x2="21" y2="22"/>
                  <line x1="6" y1="18" x2="6" y2="11"/>
                  <line x1="10" y1="18" x2="10" y2="11"/>
                  <line x1="14" y1="18" x2="14" y2="11"/>
                  <line x1="18" y1="18" x2="18" y2="11"/>
                  <polygon points="12 2 20 7 4 7"/>
                </svg>
                <!-- cash/wallet icon -->
                <svg v-else-if="accountIconType(acct.type) === 'cash'"
                  xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
                <!-- ewallet / smartphone icon -->
                <svg v-else-if="accountIconType(acct.type) === 'ewallet'"
                  xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                  <line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
                <!-- fallback -->
                <svg v-else
                  xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v8M8 12h8"/>
                </svg>
              </span>
              <span class="accts-list__name">{{ acct.name }}</span>
              <span class="accts-list__type-badge badge">{{ acct.type }}</span>
              <span class="accts-list__balance tabnum">{{ formatRM(acct.balance_cents) }}</span>
            </li>
          </ul>
        </div>

        <!-- Savings group -->
        <div v-if="savingsAccounts.length" class="card accts-card">
          <p class="section-label">Savings</p>
          <ul class="accts-list" role="list">
            <li
              v-for="acct in savingsAccounts"
              :key="acct.id"
              class="accts-list__row"
            >
              <span class="accts-list__icon-wrap" aria-hidden="true">
                <!-- piggy-bank / leaf icon for savings -->
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.8 3-2.6 3-6 0-2-2-3.5-2-3.5z"/>
                  <path d="M2 9.5C2 4 8 .6 12 5"/>
                </svg>
              </span>
              <span class="accts-list__name">{{ acct.name }}</span>
              <span class="accts-list__type-badge badge badge--green">{{ acct.type }}</span>
              <span class="accts-list__balance tabnum">{{ formatRM(acct.balance_cents) }}</span>
            </li>
          </ul>
        </div>

        <!-- Empty state -->
        <div v-if="!spendableAccounts.length && !savingsAccounts.length" class="accts-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" style="color:var(--text-muted)">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          <p>No accounts found.</p>
        </div>
      </section>

      <!-- ── Debts section ── -->
      <section aria-labelledby="debts-heading" style="margin-top:24px">
        <h2 id="debts-heading" class="accts-section-heading">Debts</h2>

        <div v-if="allDebts && (allDebts as any[]).length" class="card accts-card">
          <ul class="accts-list accts-list--debts" role="list">
            <li
              v-for="debt in (allDebts as any[])"
              :key="debt.id"
              class="accts-list__row accts-list__row--debt"
              :class="{ 'accts-list__row--priority': debt.id === topPriorityId }"
            >
              <div class="accts-debt__main">
                <div class="accts-debt__left">
                  <!-- debt type icon -->
                  <span class="accts-list__icon-wrap accts-list__icon-wrap--debt" aria-hidden="true">
                    <!-- revolving = credit card -->
                    <svg v-if="debt.type === 'revolving'"
                      xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                      stroke-linejoin="round" aria-hidden="true">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                      <line x1="1" y1="10" x2="23" y2="10"/>
                    </svg>
                    <!-- installment = car / personal loan -->
                    <svg v-else-if="debt.type === 'installment'"
                      xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                      stroke-linejoin="round" aria-hidden="true">
                      <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>
                      <rect x="9" y="11" width="14" height="10" rx="2"/>
                      <circle cx="12" cy="20" r="1"/>
                      <circle cx="20" cy="20" r="1"/>
                    </svg>
                    <!-- flat_loan / reducing_loan = generic loan -->
                    <svg v-else
                      xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                      fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                      stroke-linejoin="round" aria-hidden="true">
                      <line x1="12" y1="1" x2="12" y2="23"/>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                    </svg>
                  </span>
                  <div class="accts-debt__info">
                    <span class="accts-debt__name">
                      {{ debt.name }}
                      <span
                        v-if="debt.id === topPriorityId"
                        class="badge badge--red accts-debt__priority-badge"
                        aria-label="Priority kill target"
                      >Priority</span>
                    </span>
                    <span class="accts-debt__meta tabnum">
                      {{ rateLabel(debt) }}
                      <template v-if="debt.due_day"> · Due {{ debt.due_day }}</template>
                    </span>
                  </div>
                </div>
                <span class="accts-debt__balance tabnum">{{ formatRM(debt.balance_cents) }}</span>
              </div>

              <!-- Payoff progress bar (only when baseline exists) -->
              <div v-if="hasProgress(debt)" class="accts-debt__progress" style="margin-top:8px">
                <div
                  class="progress-track"
                  role="progressbar"
                  :aria-valuenow="Math.round(payoffProgress(debt) * 100)"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="`${debt.name} payoff progress: ${Math.round(payoffProgress(debt) * 100)}%`"
                >
                  <div
                    class="progress-fill progress-fill--kill-card"
                    :style="{ width: `${Math.round(payoffProgress(debt) * 100)}%` }"
                  ></div>
                </div>
                <span class="accts-debt__progress-pct tabnum">{{ Math.round(payoffProgress(debt) * 100) }}% paid off</span>
              </div>
            </li>
          </ul>
        </div>

        <!-- Empty state for debts -->
        <div v-else class="accts-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" style="color:var(--text-muted)">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>No debts found.</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.accts-page {
  padding: 16px;
}

.accts-page__title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 16px;
  letter-spacing: -0.01em;
}

/* ── Section headings ── */
.accts-section-heading {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 12px;
}

/* ── Card spacing ── */
.accts-card {
  margin-bottom: 0;
}

/* ── Loading spinner ── */
.accts-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 15px;
}

.accts-loading__spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Error ── */
.accts-error {
  text-align: center;
}
.accts-error__msg {
  color: var(--text-muted);
  margin: 0;
  font-size: 15px;
}

/* ── Net position ── */
.accts-net {
  margin-bottom: 20px;
}

.accts-net__row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}

.accts-net__item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.accts-net__item--net {
  padding-top: 8px;
  margin-top: 2px;
}

.accts-net__item-label {
  font-size: 14px;
  color: var(--text-muted);
}

.accts-net__item-value {
  font-size: 16px;
  font-weight: 600;
}

.accts-net__item-value--net {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.accts-net__item-value--pos {
  color: var(--positive);
}

.accts-net__item-value--neg {
  color: var(--negative);
}

.accts-net__sign {
  font-size: 13px;
}

.accts-net__sign-label {
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: .04em;
  opacity: .75;
}

.accts-net__divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

.accts-net__caveat {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

/* ── Account / Debt list ── */
.accts-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.accts-list__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.accts-list__row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.accts-list__row:first-child {
  padding-top: 0;
}

.accts-list__icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--surface-2);
  flex-shrink: 0;
  color: var(--primary);
}

.accts-list__icon-wrap--debt {
  color: var(--negative);
}

.accts-list__name {
  flex: 1;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
}

.accts-list__type-badge {
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 2px 7px;
  border-radius: var(--radius-chip);
}

.accts-list__balance {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  text-align: right;
}

/* ── Debt rows ── */
.accts-list--debts .accts-list__row--debt {
  flex-direction: column;
  align-items: stretch;
  min-height: 44px;
  padding: 12px 0;
}

.accts-debt__main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.accts-debt__left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.accts-debt__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.accts-debt__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.accts-debt__priority-badge {
  font-size: 10px;
  padding: 1px 6px;
}

.accts-debt__meta {
  font-size: 12px;
  color: var(--text-muted);
}

.accts-debt__balance {
  font-size: 15px;
  font-weight: 600;
  color: var(--negative);
  white-space: nowrap;
}

.accts-debt__progress {
  padding-left: 46px; /* align with text, after icon */
}

.accts-debt__progress-pct {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* ── Priority highlight ── */
.accts-list__row--priority {
  background: rgba(220,38,38,.04);
  border-radius: 10px;
  padding-left: 10px;
  padding-right: 10px;
  margin: 0 -10px;
}

/* ── Empty state ── */
.accts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
}

.accts-empty p {
  margin: 0;
}

@media (prefers-reduced-motion: reduce) {
  .accts-loading__spinner {
    animation: none;
  }
}
</style>
