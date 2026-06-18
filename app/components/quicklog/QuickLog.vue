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

async function log(category: 'food' | 'transport' | 'other') {
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
      <button
        data-test="cat-food"
        type="button"
        :disabled="busy"
        class="chip"
        @click="log('food')"
      >
        Food
      </button>
      <button
        data-test="cat-transport"
        type="button"
        :disabled="busy"
        class="chip"
        @click="log('transport')"
      >
        Transport
      </button>
      <button
        data-test="cat-other"
        type="button"
        :disabled="busy"
        class="chip"
        @click="log('other')"
      >
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
  border: 1px solid #ccc;
  border-radius: 8px;
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

.chip {
  flex: 1;
  min-width: 80px;
  padding: 14px 12px;
  font-size: 1rem;
  border: none;
  border-radius: 10px;
  background: #f0f0f0;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}

.chip:active:not(:disabled) {
  background: #d0d0d0;
}

.chip:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
