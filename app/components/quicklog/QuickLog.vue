<!-- app/components/quicklog/QuickLog.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useOfflineQueue, type QueuedTxn } from '../../composables/useOfflineQueue';

const props = defineProps<{ accountId: number; defaultDate?: string; accounts?: Account[] }>();
const emit = defineEmits<{ logged: [txn: QueuedTxn] }>();

interface Account {
  id: number;
  name: string;
  type: string;
}

const { enqueue } = useOfflineQueue();
const amount = ref('');
const remark = ref('');
const busy = ref(false);

// ── Mode toggle ───────────────────────────────────────────────────────────────
type Mode = 'expense' | 'income';
const mode = ref<Mode>('expense');

// ── Account state ─────────────────────────────────────────────────────────────
const SPENDABLE_TYPES = new Set(['cash', 'bank', 'ewallet', 'savings']);
const spendableAccounts = computed<Account[]>(() => {
  if (!props.accounts) return [];
  return props.accounts.filter(a => SPENDABLE_TYPES.has(a.type));
});

// Mode-aware default: expense → cash, income → bank
function pickDefaultAccount(m: Mode, accs: Account[]): number {
  if (accs.length === 0) return props.accountId;
  if (m === 'expense') {
    const cash = accs.find(a => a.type === 'cash');
    return cash?.id ?? accs[0]!.id;
  } else {
    const bank = accs.find(a => a.type === 'bank');
    return bank?.id ?? accs[0]!.id;
  }
}

const selectedAccountId = ref<number>(props.accountId);
const hasInitialisedAccount = ref(false);

// When accounts first arrive, set mode-aware default
watch(spendableAccounts, (accs) => {
  if (hasInitialisedAccount.value || accs.length === 0) return;
  hasInitialisedAccount.value = true;
  selectedAccountId.value = pickDefaultAccount(mode.value, accs);
}, { immediate: true });

const INCOME_SOURCES = ['Salary', 'Side gig', 'Refund', 'Gift', 'Other'] as const;
type IncomeSource = typeof INCOME_SOURCES[number];
const selectedSource = ref<IncomeSource | null>(null);

// Client MYT date (§14.20). defaultDate lets the test inject; runtime falls back to today.
function clientDate(): string {
  if (props.defaultDate) return props.defaultDate;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // en-CA locale → YYYY-MM-DD
}

function ringgitToSen(rm: number): number {
  return Math.round(rm * 100);
}

type SpendCategory = 'food' | 'transport' | 'car' | 'fuel' | 'groceries' | 'shopping' | 'bills' | 'other';

async function log(category: SpendCategory) {
  const rm = parseFloat(amount.value);
  if (!Number.isFinite(rm) || rm <= 0 || busy.value) return;
  busy.value = true;
  try {
    const txn = await enqueue({
      date: clientDate(),
      amount_cents: -ringgitToSen(rm), // quick-log expense → negative
      direction: 'expense',
      category,
      account_id: selectedAccountId.value,
      note: remark.value.trim() || undefined,
    });
    emit('logged', txn);
    amount.value = '';
    remark.value = '';
  } finally {
    busy.value = false;
  }
}

async function logIncome() {
  const rm = parseFloat(amount.value);
  if (!Number.isFinite(rm) || rm <= 0 || busy.value) return;
  busy.value = true;
  try {
    const txn = await enqueue({
      date: clientDate(),
      amount_cents: ringgitToSen(rm), // income → positive
      direction: 'income',
      category: 'income',
      account_id: selectedAccountId.value,
      note: selectedSource.value ?? undefined,
    });
    emit('logged', txn);
    amount.value = '';
    selectedSource.value = null;
  } finally {
    busy.value = false;
  }
}

function setMode(m: Mode) {
  mode.value = m;
  amount.value = '';
  remark.value = '';
  selectedSource.value = null;
  // Re-pick sensible default for the new mode
  selectedAccountId.value = pickDefaultAccount(m, spendableAccounts.value);
}
</script>

<template>
  <div class="quicklog">

    <!-- ── Mode toggle ──────────────────────────────────────────────────── -->
    <div class="quicklog__toggle" role="group" aria-label="Log mode">
      <button
        data-test="mode-expense"
        type="button"
        class="quicklog__toggle-btn"
        :class="{ 'quicklog__toggle-btn--active': mode === 'expense' }"
        :aria-pressed="mode === 'expense'"
        @click="setMode('expense')"
        @keydown.enter.prevent="setMode('expense')"
        @keydown.space.prevent="setMode('expense')"
      >Expense</button>
      <button
        data-test="mode-income"
        type="button"
        class="quicklog__toggle-btn"
        :class="{ 'quicklog__toggle-btn--active': mode === 'income' }"
        :aria-pressed="mode === 'income'"
        @click="setMode('income')"
        @keydown.enter.prevent="setMode('income')"
        @keydown.space.prevent="setMode('income')"
      >Income</button>
    </div>

    <!-- ── Amount input ─────────────────────────────────────────────────── -->
    <div class="quicklog__input-row">
      <span class="quicklog__currency">RM</span>
      <input
        data-test="amount"
        v-model="amount"
        type="number"
        inputmode="decimal"
        step="0.01"
        min="0.01"
        placeholder="0.00"
        aria-label="Amount in ringgit"
        class="quicklog__amount tabnum"
      />
    </div>

    <!-- ── EXPENSE mode: account picker + category chips ──────────────── -->
    <template v-if="mode === 'expense'">

      <!-- Paid-from account picker (only when >1 spendable account) -->
      <div class="quicklog__field" v-if="spendableAccounts.length > 1">
        <label class="quicklog__field-label" for="expense-account">Paid from</label>
        <select
          id="expense-account"
          data-test="expense-account"
          class="quicklog__select"
          :value="selectedAccountId"
          @change="selectedAccountId = +($event.target as HTMLSelectElement).value"
        >
          <option
            v-for="acc in spendableAccounts"
            :key="acc.id"
            :value="acc.id"
          >{{ acc.name }}</option>
        </select>
      </div>

      <!-- Optional remark (persisted as transaction note) -->
      <input
        data-test="remark"
        v-model="remark"
        type="text"
        class="quicklog__remark"
        placeholder="Remark (optional)"
        aria-label="Optional remark"
        maxlength="120"
      />

      <div class="chips" role="group" aria-label="Expense category">

        <!-- Food — utensils -->
        <button data-test="cat-food" type="button" :disabled="busy" class="chip" @click="log('food')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
            <path d="M7 2v20"/>
            <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h1a2 2 0 0 1 2 2v5"/>
          </svg>
          Food
        </button>

        <!-- Transport — bus -->
        <button data-test="cat-transport" type="button" :disabled="busy" class="chip" @click="log('transport')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M8 6v6"/>
            <path d="M15 6v6"/>
            <path d="M2 12h19.6"/>
            <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
            <circle cx="7" cy="18" r="2"/>
            <path d="M9 18h5"/>
            <circle cx="16" cy="18" r="2"/>
          </svg>
          Transport
        </button>

        <!-- Car — parking, tolls -->
        <button data-test="cat-car" type="button" :disabled="busy" class="chip" @click="log('car')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>
            <rect x="9" y="11" width="14" height="10" rx="2"/>
            <circle cx="12" cy="16" r="1"/>
            <circle cx="20" cy="16" r="1"/>
          </svg>
          Car
        </button>

        <!-- Fuel — fuel -->
        <button data-test="cat-fuel" type="button" :disabled="busy" class="chip" @click="log('fuel')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="22" x2="15" y2="22"/>
            <line x1="4" y1="9" x2="14" y2="9"/>
            <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/>
            <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>
          </svg>
          Fuel
        </button>

        <!-- Groceries — shopping-basket -->
        <button data-test="cat-groceries" type="button" :disabled="busy" class="chip" @click="log('groceries')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="m5 11 4-7"/>
            <path d="m19 11-4-7"/>
            <path d="M2 11h20"/>
            <path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/>
            <path d="m9 11 1 9"/>
            <path d="M4.5 15.5h15"/>
            <path d="m15 11-1 9"/>
          </svg>
          Groceries
        </button>

        <!-- Shopping — shopping-bag -->
        <button data-test="cat-shopping" type="button" :disabled="busy" class="chip" @click="log('shopping')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          Shopping
        </button>

        <!-- Bills — receipt -->
        <button data-test="cat-bills" type="button" :disabled="busy" class="chip" @click="log('bills')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <polyline points="1 6 1 22 23 22 23 6"/>
            <path d="M1 6 12 1l11 5"/>
            <path d="M8 22V12h8v10"/>
          </svg>
          Bills
        </button>

        <!-- Other — circle-dollar-sign -->
        <button data-test="cat-other" type="button" :disabled="busy" class="chip" @click="log('other')">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/>
            <path d="M12 18V6"/>
          </svg>
          Other
        </button>

      </div>
    </template>

    <!-- ── INCOME mode ──────────────────────────────────────────────────── -->
    <template v-else>

      <!-- Funding account picker -->
      <div class="quicklog__field" v-if="spendableAccounts.length > 0">
        <label class="quicklog__field-label" for="income-account">Into account</label>
        <select
          id="income-account"
          data-test="income-account"
          class="quicklog__select"
          :value="selectedAccountId"
          @change="selectedAccountId = +($event.target as HTMLSelectElement).value"
        >
          <option
            v-for="acc in spendableAccounts"
            :key="acc.id"
            :value="acc.id"
          >{{ acc.name }}</option>
        </select>
      </div>

      <!-- Source quick-chips (fills note) -->
      <div class="chips" role="group" aria-label="Income source">
        <button
          v-for="src in INCOME_SOURCES"
          :key="src"
          type="button"
          :data-test="`income-src-${src.toLowerCase().replace(' ', '-')}`"
          class="chip"
          :class="{ 'chip--active': selectedSource === src }"
          :aria-pressed="selectedSource === src"
          @click="selectedSource = selectedSource === src ? null : src"
        >{{ src }}</button>
      </div>

      <!-- Submit -->
      <button
        data-test="log-income"
        type="button"
        class="quicklog__income-btn"
        :disabled="busy"
        @click="logIncome"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
        Log Income
      </button>

    </template>

  </div>
</template>

<style scoped>
.quicklog {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

/* ── Mode toggle ─────────────────────────────────────────────────────────── */
.quicklog__toggle {
  display: flex;
  background: var(--surface-2);
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}

.quicklog__toggle-btn {
  flex: 1;
  height: 40px;
  min-height: 44px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background 150ms ease-out, color 150ms ease-out, box-shadow 150ms ease-out;
}

.quicklog__toggle-btn--active {
  background: var(--primary);
  color: var(--on-primary);
  box-shadow: 0 1px 4px rgba(30, 64, 175, 0.25);
}

.quicklog__toggle-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* ── Amount input row ────────────────────────────────────────────────────── */
.quicklog__input-row {
  display: flex;
  align-items: center;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--surface);
  overflow: hidden;
  transition: border-color 150ms ease-out;
}

.quicklog__input-row:focus-within {
  border-color: var(--ring);
  box-shadow: 0 0 0 3px rgba(30,64,175,.12);
}

.quicklog__currency {
  padding: 0 12px 0 16px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-muted);
  user-select: none;
}

.quicklog__amount {
  flex: 1;
  height: 52px;
  border: none;
  background: transparent;
  font-family: var(--font-base);
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  padding: 0 16px 0 0;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.quicklog__amount::placeholder {
  color: var(--border);
  font-weight: 400;
}

/* ── Remark input ────────────────────────────────────────────────────────── */
.quicklog__remark {
  height: 44px;
  padding: 0 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-base);
  font-size: 14px;
  outline: none;
  transition: border-color 150ms ease-out;
}

.quicklog__remark::placeholder {
  color: var(--text-muted);
}

.quicklog__remark:focus {
  border-color: var(--ring);
  box-shadow: 0 0 0 3px rgba(30,64,175,.12);
}

/* ── Category chips ──────────────────────────────────────────────────────── */
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-chip);
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--font-base);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background 200ms ease-out, color 200ms ease-out, border-color 200ms ease-out, transform 200ms cubic-bezier(.34,1.56,.64,1);
}

.chip:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--surface);
}

.chip:active:not(:disabled) {
  transform: scale(0.95);
  background: var(--primary);
  color: var(--on-primary);
  border-color: var(--primary);
}

.chip--active {
  border-color: var(--positive);
  background: rgba(5, 150, 105, 0.10);
  color: var(--positive);
}

.chip:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.chip:disabled {
  opacity: 0.5;
  cursor: default;
  pointer-events: none;
}

/* ── Account field (shared by expense + income pickers) ─────────────────── */
.quicklog__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quicklog__field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.005em;
}

.quicklog__select {
  height: 48px;
  padding: 0 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-base);
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 40px;
  transition: border-color 150ms ease-out;
}

.quicklog__select:focus {
  border-color: var(--ring);
  box-shadow: 0 0 0 3px rgba(30,64,175,.12);
}

/* ── Income submit button ────────────────────────────────────────────────── */
.quicklog__income-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  border: none;
  border-radius: var(--radius-btn);
  background: var(--positive);
  color: #fff;
  font-family: var(--font-base);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 150ms ease-out, transform 150ms ease-out;
}

.quicklog__income-btn:active:not(:disabled) {
  transform: scale(0.97);
  opacity: 0.9;
}

.quicklog__income-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.quicklog__income-btn:disabled {
  opacity: 0.5;
  cursor: default;
  pointer-events: none;
}
</style>
