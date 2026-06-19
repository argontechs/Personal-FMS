<!-- app/pages/accounts.vue
     Accounts & Debts overview — all account balances (excl. card account) + all 7 debts in
     avalanche order (priority_rank) + Holdings/Investments + TRUE net worth summary at the top.
     Card account is shown under Debts only, never double-counted as an asset. -->
<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useFetch } from '#app'
import { formatRM } from '../../shared/types'

// Auth is enforced globally by app/middleware/auth.global.ts — no per-page middleware needed.

// ── API data ─────────────────────────────────────────────────────────────────
const { data: accounts, error: accountsError, refresh: refreshAccounts } =
  await useFetch('/api/accounts')

const { data: allDebts, error: debtsError, refresh: refreshDebts } =
  await useFetch('/api/debts')

const { data: holdingsData, error: holdingsError, refresh: refreshHoldings } =
  await useFetch('/api/holdings')

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

/** Holdings list */
const holdingsList = computed(() => {
  if (!holdingsData.value) return []
  return holdingsData.value as any[]
})

/** Liquid accounts total (cash, bank, ewallet, savings — excl card) */
const liquidCents = computed(() =>
  assetAccounts.value.reduce((s: number, a: any) => s + (a.balance_cents ?? 0), 0)
)

/** Holdings total */
const holdingsCents = computed(() =>
  holdingsList.value.reduce((s: number, h: any) => s + (h.current_value_cents ?? 0), 0)
)

/** Total assets = liquid accounts + holdings */
const totalAssetsCents = computed(() => liquidCents.value + holdingsCents.value)

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

// ── Holdings kind badge color ─────────────────────────────────────────────────
function holdingKindClass(kind: string): string {
  if (kind === 'investment') return 'badge--blue'
  if (kind === 'insurance') return 'badge--purple'
  if (kind === 'savings') return 'badge--green'
  return ''
}

// ── Holdings edit / add sheet ─────────────────────────────────────────────────
const sheetOpen = ref(false)
const sheetMode = ref<'edit' | 'add'>('edit')
const sheetHolding = ref<any | null>(null)

const formName = ref('')
const formInstitution = ref('')
const formKind = ref<'investment' | 'insurance' | 'savings'>('investment')
const formValueRm = ref('')   // user types RM string, we parse to integer sen
const formLiquid = ref(false) // §AIA lever — can be withdrawn to cash
const formNote = ref('')
const formSaving = ref(false)
const formError = ref('')

// a11y: autofocus the Name input on open + restore focus to the trigger on close.
const nameInputRef = ref<HTMLInputElement | null>(null)
const lastTrigger = ref<HTMLElement | null>(null)

// Delete confirm (edit mode only).
const confirmingDelete = ref(false)
const deleting = ref(false)

function openEditSheet(h: any, ev?: Event) {
  lastTrigger.value = (ev?.currentTarget as HTMLElement) ?? null
  sheetMode.value = 'edit'
  sheetHolding.value = h
  formName.value = h.name
  formInstitution.value = h.institution
  formKind.value = h.kind
  formValueRm.value = (h.current_value_cents / 100).toFixed(2)
  formLiquid.value = !!h.liquid
  formNote.value = h.note ?? ''
  formError.value = ''
  confirmingDelete.value = false
  sheetOpen.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function openAddSheet(ev?: Event) {
  lastTrigger.value = (ev?.currentTarget as HTMLElement) ?? null
  sheetMode.value = 'add'
  sheetHolding.value = null
  formName.value = ''
  formInstitution.value = ''
  formKind.value = 'investment'
  formValueRm.value = ''
  formLiquid.value = false
  formNote.value = ''
  formError.value = ''
  confirmingDelete.value = false
  sheetOpen.value = true
  nextTick(() => nameInputRef.value?.focus())
}

function closeSheet() {
  sheetOpen.value = false
  confirmingDelete.value = false
  // Restore focus to the element that opened the sheet.
  const t = lastTrigger.value
  if (t && typeof t.focus === 'function') nextTick(() => t.focus())
}

function parseSen(rmStr: string): number | null {
  const v = parseFloat(rmStr.replace(/,/g, ''))
  if (!isFinite(v) || v <= 0) return null
  return Math.round(v * 100)
}

async function saveHolding() {
  formError.value = ''
  const valueCents = parseSen(formValueRm.value)
  if (!formName.value.trim()) { formError.value = 'Name is required.'; return }
  if (!formInstitution.value.trim()) { formError.value = 'Institution is required.'; return }
  if (valueCents === null) { formError.value = 'Enter a valid value (e.g. 12345.00).'; return }

  formSaving.value = true
  try {
    if (sheetMode.value === 'edit' && sheetHolding.value) {
      await $fetch(`/api/holdings/${sheetHolding.value.id}`, {
        method: 'PATCH',
        body: {
          name: formName.value.trim(),
          institution: formInstitution.value.trim(),
          kind: formKind.value,
          current_value_cents: valueCents,
          liquid: formLiquid.value ? 1 : 0,
          note: formNote.value.trim() || null,
        },
      })
    } else {
      await $fetch('/api/holdings', {
        method: 'POST',
        body: {
          name: formName.value.trim(),
          institution: formInstitution.value.trim(),
          kind: formKind.value,
          current_value_cents: valueCents,
          liquid: formLiquid.value ? 1 : 0,
          note: formNote.value.trim() || null,
        },
      })
    }
    await refreshHoldings()
    closeSheet()
  } catch (e: any) {
    formError.value = e?.data?.statusMessage ?? 'Save failed. Try again.'
  } finally {
    formSaving.value = false
  }
}

// ── Delete holding (edit mode only) ──────────────────────────────────────────
async function deleteHolding() {
  if (!sheetHolding.value) return
  // First click arms the confirm; second click performs the delete.
  if (!confirmingDelete.value) {
    confirmingDelete.value = true
    return
  }
  formError.value = ''
  deleting.value = true
  try {
    await $fetch(`/api/holdings/${sheetHolding.value.id}`, { method: 'DELETE' })
    await refreshHoldings()
    closeSheet()
  } catch (e: any) {
    formError.value = e?.data?.statusMessage ?? 'Delete failed. Try again.'
    confirmingDelete.value = false
  } finally {
    deleting.value = false
  }
}

// ── Error/loading state ───────────────────────────────────────────────────────
const isLoading = computed(() => accounts.value === null && !accountsError.value)
const hasError = computed(() => !!(accountsError.value || debtsError.value || holdingsError.value))

async function retry() {
  await Promise.all([refreshAccounts(), refreshDebts(), refreshHoldings()])
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
      <!-- Net position summary (TRUE net worth) -->
      <section class="card accts-net" aria-label="Net financial position">
        <p class="section-label">Net worth</p>
        <div class="accts-net__row">
          <div class="accts-net__item">
            <span class="accts-net__item-label">Liquid (accounts)</span>
            <span class="accts-net__item-value tabnum">{{ formatRM(liquidCents) }}</span>
          </div>
          <div class="accts-net__item">
            <span class="accts-net__item-label">Holdings</span>
            <span class="accts-net__item-value tabnum">{{ formatRM(holdingsCents) }}</span>
          </div>
          <div class="accts-net__item accts-net__item--subtotal">
            <span class="accts-net__item-label">Total assets</span>
            <span class="accts-net__item-value tabnum">{{ formatRM(totalAssetsCents) }}</span>
          </div>
          <div class="accts-net__item">
            <span class="accts-net__item-label">Total debts</span>
            <span class="accts-net__item-value tabnum" style="color:var(--negative)">−{{ formatRM(totalDebtsCents) }}</span>
          </div>
          <div class="accts-net__divider" aria-hidden="true"></div>
          <div class="accts-net__item accts-net__item--net">
            <span class="accts-net__item-label">Net worth</span>
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

      <!-- ── Holdings / Investments section ── -->
      <section aria-labelledby="holdings-heading" style="margin-top:24px">
        <div class="accts-section-heading-row">
          <h2 id="holdings-heading" class="accts-section-heading">Holdings &amp; Investments</h2>
          <button
            type="button"
            class="accts-add-btn"
            aria-label="Add holding"
            @click="openAddSheet($event)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </div>

        <div v-if="holdingsList.length" class="card accts-card">
          <!-- Holdings subtotal -->
          <div class="accts-holdings__subtotal">
            <span class="accts-holdings__subtotal-label">Total</span>
            <span class="accts-holdings__subtotal-value tabnum">{{ formatRM(holdingsCents) }}</span>
          </div>
          <ul class="accts-list" role="list">
            <li
              v-for="holding in holdingsList"
              :key="holding.id"
              class="accts-list__row accts-holding__row"
            >
              <!-- holding icon (chart/trending up) -->
              <span class="accts-list__icon-wrap accts-list__icon-wrap--holding" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                  <polyline points="17 6 23 6 23 12"/>
                </svg>
              </span>
              <div class="accts-holding__info">
                <div class="accts-holding__name-row">
                  <span class="accts-list__name">{{ holding.name }}</span>
                  <span :class="['badge', holdingKindClass(holding.kind)]">{{ holding.kind }}</span>
                  <span
                    v-if="holding.liquid"
                    class="badge badge--green accts-holding__liquid-badge"
                    aria-label="Liquid"
                  >liquid</span>
                </div>
                <div class="accts-holding__meta-row">
                  <span class="accts-holding__institution">{{ holding.institution }}</span>
                  <span v-if="holding.note" class="accts-holding__note">{{ holding.note }}</span>
                </div>
              </div>
              <div class="accts-holding__right">
                <span class="accts-list__balance tabnum">{{ formatRM(holding.current_value_cents) }}</span>
                <button
                  type="button"
                  class="accts-holding__edit-btn"
                  :aria-label="`Edit ${holding.name}`"
                  @click="openEditSheet(holding, $event)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            </li>
          </ul>
        </div>

        <!-- Empty state for holdings -->
        <div v-else class="accts-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true" style="color:var(--text-muted)">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            <polyline points="17 6 23 6 23 12"/>
          </svg>
          <p>No holdings yet. Tap + Add to track investments and insurance.</p>
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

    <!-- ── Edit / Add Holding Sheet ── -->
    <div
      v-if="sheetOpen"
      class="holding-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      :aria-label="sheetMode === 'edit' ? 'Edit holding' : 'Add holding'"
      @click.self="closeSheet"
      @keydown.esc="closeSheet"
    >
      <div class="holding-sheet">
        <div class="holding-sheet__header">
          <h3 class="holding-sheet__title">{{ sheetMode === 'edit' ? 'Edit Holding' : 'Add Holding' }}</h3>
          <button
            type="button"
            class="holding-sheet__close"
            aria-label="Close"
            @click="closeSheet"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="holding-sheet__body">
          <p v-if="formError" role="alert" class="holding-sheet__error">{{ formError }}</p>

          <div class="holding-sheet__field">
            <label class="holding-sheet__label" for="holding-name">Name</label>
            <input
              id="holding-name"
              ref="nameInputRef"
              v-model="formName"
              type="text"
              class="holding-sheet__input"
              placeholder="e.g. AIA Takaful"
              autocomplete="off"
            />
          </div>

          <div class="holding-sheet__field">
            <label class="holding-sheet__label" for="holding-institution">Institution</label>
            <input
              id="holding-institution"
              v-model="formInstitution"
              type="text"
              class="holding-sheet__input"
              placeholder="e.g. AIA"
              autocomplete="off"
            />
          </div>

          <div class="holding-sheet__field">
            <label class="holding-sheet__label" for="holding-kind">Kind</label>
            <select id="holding-kind" v-model="formKind" class="holding-sheet__input">
              <option value="investment">Investment</option>
              <option value="insurance">Insurance</option>
              <option value="savings">Savings</option>
            </select>
          </div>

          <div class="holding-sheet__field">
            <label class="holding-sheet__label" for="holding-value">Current value (RM)</label>
            <input
              id="holding-value"
              v-model="formValueRm"
              type="text"
              inputmode="decimal"
              class="holding-sheet__input"
              placeholder="e.g. 12345.00"
              autocomplete="off"
            />
          </div>

          <div class="holding-sheet__field">
            <label class="holding-sheet__toggle">
              <input
                type="checkbox"
                class="holding-sheet__toggle-input"
                v-model="formLiquid"
                aria-describedby="holding-liquid-help"
              />
              <span class="holding-sheet__toggle-track" aria-hidden="true">
                <span class="holding-sheet__toggle-thumb"></span>
              </span>
              <span class="holding-sheet__toggle-text">Liquid — can be withdrawn to cash</span>
            </label>
            <p id="holding-liquid-help" class="holding-sheet__help">
              Liquid holdings power the “clear the card” suggestion.
            </p>
          </div>

          <div class="holding-sheet__field">
            <label class="holding-sheet__label" for="holding-note">Note (optional)</label>
            <input
              id="holding-note"
              v-model="formNote"
              type="text"
              class="holding-sheet__input"
              placeholder="e.g. Maturity 2035"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="holding-sheet__footer">
          <button type="button" class="btn-secondary" @click="closeSheet">Cancel</button>
          <button
            type="button"
            class="btn-primary"
            :disabled="formSaving"
            @click="saveHolding"
          >
            {{ formSaving ? 'Saving…' : (sheetMode === 'edit' ? 'Save changes' : 'Add holding') }}
          </button>
        </div>

        <!-- Destructive zone — edit mode only, visually separated from Save -->
        <div v-if="sheetMode === 'edit'" class="holding-sheet__danger-zone">
          <button
            type="button"
            class="holding-sheet__delete-btn"
            :class="{ 'holding-sheet__delete-btn--armed': confirmingDelete }"
            :disabled="deleting"
            @click="deleteHolding"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
              stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            {{ deleting ? 'Deleting…' : (confirmingDelete ? 'Tap again to confirm delete' : 'Delete holding') }}
          </button>
          <button
            v-if="confirmingDelete && !deleting"
            type="button"
            class="holding-sheet__delete-cancel"
            @click="confirmingDelete = false"
          >Keep</button>
        </div>
      </div>
    </div>
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

.accts-section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.accts-section-heading-row .accts-section-heading {
  margin-bottom: 0;
}

.accts-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  background: var(--surface-2);
  border: none;
  border-radius: var(--radius-btn);
  padding: 6px 12px;
  min-height: 36px;
  cursor: pointer;
  transition: opacity .15s;
}

.accts-add-btn:active { opacity: .7; }

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

.accts-net__item--subtotal {
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  margin-top: 2px;
}

.accts-net__item--net {
  padding-top: 8px;
  margin-top: 2px;
}

.accts-net__item-label {
  font-size: 14px;
  color: var(--text-muted);
}

.accts-net__item--subtotal .accts-net__item-label,
.accts-net__item--subtotal .accts-net__item-value {
  font-weight: 600;
  color: var(--text);
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

.accts-list__icon-wrap--holding {
  color: var(--positive);
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

/* ── Holdings ── */
.accts-holdings__subtotal {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--border);
}

.accts-holdings__subtotal-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}

.accts-holdings__subtotal-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.accts-holding__row {
  align-items: flex-start;
  padding: 12px 0;
}

.accts-holding__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.accts-holding__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.accts-holding__name-row .accts-list__name {
  flex: unset;
}

.accts-holding__meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.accts-holding__institution {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}

.accts-holding__note {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

.accts-holding__liquid-badge {
  font-size: 10px;
  padding: 1px 6px;
}

.accts-holding__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.accts-holding__edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  min-width: 28px;
  border: none;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--text-muted);
  cursor: pointer;
  transition: background .15s, color .15s;
}

.accts-holding__edit-btn:hover {
  background: var(--border);
  color: var(--primary);
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

/* ── Holding sheet (bottom sheet / modal) ── */
.holding-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.holding-sheet {
  background: var(--surface);
  border-radius: 20px 20px 0 0;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 0 0 env(safe-area-inset-bottom, 16px);
  box-shadow: var(--shadow-lg);
}

.holding-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}

.holding-sheet__title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.holding-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 50%;
  margin: -10px -10px -10px 0;
}

.holding-sheet__body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.holding-sheet__error {
  background: rgba(220,38,38,.08);
  color: var(--negative);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  margin: 0;
}

.holding-sheet__field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.holding-sheet__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.holding-sheet__input {
  width: 100%;
  padding: 11px 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--surface-2);
  color: var(--text);
  font-size: 15px;
  font-family: var(--font-base);
  outline: none;
  box-sizing: border-box;
  transition: border-color .15s;
}

.holding-sheet__input:focus {
  border-color: var(--ring);
}

/* ── Liquid toggle ── */
.holding-sheet__toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}

.holding-sheet__toggle-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.holding-sheet__toggle-track {
  position: relative;
  flex-shrink: 0;
  width: 44px;
  height: 26px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1.5px solid var(--border);
  transition: background .15s, border-color .15s;
}

.holding-sheet__toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: transform .15s, background .15s;
}

.holding-sheet__toggle-input:checked + .holding-sheet__toggle-track {
  background: var(--primary);
  border-color: var(--primary);
}

.holding-sheet__toggle-input:checked + .holding-sheet__toggle-track .holding-sheet__toggle-thumb {
  transform: translateX(18px);
  background: var(--on-primary);
}

.holding-sheet__toggle-input:focus-visible + .holding-sheet__toggle-track {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.holding-sheet__toggle-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.holding-sheet__help {
  font-size: 12px;
  color: var(--text-muted);
  margin: 6px 0 0 54px;
  line-height: 1.4;
}

.holding-sheet__footer {
  display: flex;
  gap: 10px;
  padding: 12px 20px 20px;
  border-top: 1px solid var(--border);
}

.holding-sheet__footer .btn-secondary {
  flex: 1;
}

.holding-sheet__footer .btn-primary {
  flex: 2;
}

/* ── Destructive zone (edit mode) ── */
.holding-sheet__danger-zone {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px 20px;
  margin-top: -4px;
  border-top: 1px dashed var(--border);
  padding-top: 16px;
}

.holding-sheet__delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  min-height: 44px;
  padding: 0 16px;
  border: 1.5px solid var(--negative);
  border-radius: var(--radius-btn);
  background: transparent;
  color: var(--negative);
  font-family: var(--font-base);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s, transform .15s, opacity .15s;
  -webkit-tap-highlight-color: transparent;
}

.holding-sheet__delete-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.holding-sheet__delete-btn:disabled {
  opacity: .5;
  cursor: not-allowed;
}

.holding-sheet__delete-btn:focus-visible {
  outline: 2px solid var(--negative);
  outline-offset: 2px;
}

.holding-sheet__delete-btn--armed {
  background: var(--negative);
  color: var(--on-primary);
}

.holding-sheet__delete-cancel {
  min-height: 44px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.holding-sheet__delete-cancel:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* badge color variants used by holdings */
.badge--blue {
  background: rgba(30,64,175,.1);
  color: var(--primary);
}

.badge--purple {
  background: rgba(109,40,217,.1);
  color: #7C3AED;
}

@media (prefers-reduced-motion: reduce) {
  .accts-loading__spinner {
    animation: none;
  }
}
</style>
