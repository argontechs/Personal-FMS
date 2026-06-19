<!-- app/components/quicklog/QuickLog.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { useOfflineQueue, type QueuedTxn } from '../../composables/useOfflineQueue';

const props = defineProps<{ accountId: number; defaultDate?: string }>();
const emit = defineEmits<{ logged: [txn: QueuedTxn] }>();

const { enqueue } = useOfflineQueue();
const amount = ref('');
const busy = ref(false);

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

type SpendCategory = 'food' | 'transport' | 'fuel' | 'groceries' | 'shopping' | 'bills' | 'other';

async function log(category: SpendCategory) {
  const rm = parseFloat(amount.value);
  if (!Number.isFinite(rm) || rm <= 0 || busy.value) return;
  busy.value = true;
  try {
    const txn = await enqueue({
      date: clientDate(),
      amount_cents: -ringgitToSen(rm), // quick-log is always an expense
      direction: 'expense',
      category,
      account_id: props.accountId,
    });
    emit('logged', txn);
    amount.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="quicklog">
    <input
      data-test="amount"
      v-model="amount"
      type="number"
      inputmode="decimal"
      step="0.01"
      min="0.01"
      placeholder="RM amount"
      aria-label="Amount in ringgit"
      class="quicklog__amount"
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
  </div>
</template>

<style scoped>
.quicklog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.quicklog__amount {
  font-size: 1.5rem;
  padding: 12px 16px;
  border: 1px solid var(--border, #ccc);
  border-radius: 12px;
  width: 100%;
  box-sizing: border-box;
  -webkit-appearance: none;
  appearance: none;
}

.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Design-system chip spec: pill, ≥44px, SVG icon + label */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: var(--surface-2, #f0f0f0);
  color: var(--text, #0f172a);
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background 150ms ease-out, color 150ms ease-out, transform 150ms ease-out;
}

.chip:active:not(:disabled) {
  transform: scale(0.97);
  background: var(--primary, #1e40af);
  color: var(--on-primary, #ffffff);
}

.chip:focus-visible {
  outline: 2px solid var(--ring, #1e40af);
  outline-offset: 2px;
}

.chip:disabled {
  opacity: 0.5;
  cursor: default;
  pointer-events: none;
}
</style>
