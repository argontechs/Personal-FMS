<!-- app/components/RecurringRow.vue -->
<!-- Compiled SFC — must NOT use a runtime string template (runtimeCompiler is off in Nuxt). -->
<script setup lang="ts">
import { computed } from 'vue'

// ─── Types ────────────────────────────────────────────────────────────────────
type Cadence = 'monthly' | 'weekly' | 'biweekly' | 'yearly'
type Category = 'food' | 'transport' | 'bills' | 'debt' | 'income' | 'savings' | 'interest' | 'adjustment' | 'other'
type Direction = 'income' | 'expense'

interface RecurringItem {
  id: number
  name: string
  direction: Direction
  amount_cents: number
  is_variable: boolean
  cadence: Cadence
  day_of_month: number | null
  weekday: number | null
  category: Category
  funding_account_id: number | null
  debt_id: number | null
  auto_post: boolean
  start_date: string
  end_date: string | null
  remaining_occurrences: number | null
  last_posted_date: string | null
  next_due_date: string | null
  remaining_installments_json: string | null
  is_active: boolean
  created_at: number
  updated_at: number
}

// ─── Props & emits ────────────────────────────────────────────────────────────
const props = withDefaults(defineProps<{
  item: RecurringItem
  isLast?: boolean
  deleteConfirmId?: number | null
  pausingId?: number | null
  deletingId?: number | null
  accountName?: string
  isCardFunded?: boolean
}>(), {
  isLast: false,
  deleteConfirmId: null,
  pausingId: null,
  deletingId: null,
  accountName: '',
  isCardFunded: false,
})

const emit = defineEmits<{
  edit: []
  'toggle-active': []
  'prompt-delete': []
  'cancel-delete': []
  'confirm-delete': []
}>()

// ─── Computeds ────────────────────────────────────────────────────────────────
const amountDisplay = computed(() => {
  const prefix = props.item.is_variable ? '~' : ''
  const val = 'RM' + (props.item.amount_cents / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return prefix + val
})

const cadenceShort = computed(() => {
  return ({ monthly: 'mo', weekly: 'wk', biweekly: 'biwk', yearly: 'yr' } as Record<string, string>)[props.item.cadence] ?? props.item.cadence
})

const dueLine = computed(() => {
  const i = props.item
  if (i.cadence === 'weekly' || i.cadence === 'biweekly') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return i.weekday != null ? `Every ${days[i.weekday] ?? ''}` : ''
  }
  if (i.cadence === 'yearly') return i.next_due_date ? `Due ${i.next_due_date}` : ''
  return i.day_of_month ? `Day ${i.day_of_month}` : ''
})
</script>

<template>
  <div :class="['rrow', { 'rrow--paused': !item.is_active, 'rrow--last': isLast }]">
    <div class="rrow__main">
      <div class="rrow__left">
        <div
          class="rrow__icon-wrap"
          :class="item.direction === 'income' ? 'rrow__icon-wrap--income' : 'rrow__icon-wrap--expense'"
        >
          <svg
            v-if="item.category === 'income'"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
          </svg>
          <svg
            v-else-if="item.category === 'bills'"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="1 6 1 22 23 22 23 6" /><path d="M1 6 12 1l11 5" /><path d="M8 22V12h8v10" />
          </svg>
          <svg
            v-else-if="item.category === 'debt'"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <svg
            v-else
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 18V6" />
          </svg>
        </div>
        <div class="rrow__info">
          <span class="rrow__name">{{ item.name }}</span>
          <span class="rrow__meta">
            <span>{{ cadenceShort }}</span>
            <span v-if="dueLine"> · {{ dueLine }}</span>
            <span v-if="accountName"> · {{ accountName }}</span>
            <span v-if="isCardFunded" class="rrow__card-tag">card</span>
          </span>
        </div>
      </div>
      <div class="rrow__right">
        <span
          :class="['rrow__amount', 'tabnum', item.direction === 'income' ? 'rrow__amount--income' : 'rrow__amount--expense']"
        >
          {{ item.direction === 'income' ? '+' : '-' }}{{ amountDisplay }}
        </span>
        <!-- Mode badge: expense items only. Auto = auto-deducted; Reminder = you log it yourself. -->
        <span
          v-if="item.direction === 'expense'"
          :class="['badge', item.auto_post ? 'badge--blue' : 'badge--amber', 'rrow__mode-badge']"
          data-test="mode-badge"
          :title="item.auto_post ? 'Auto-deducted — a transaction is logged for you' : 'Reminder only — you log the payment yourself'"
        >{{ item.auto_post ? 'Auto' : 'Reminder' }}</span>
        <span v-if="!item.is_active" class="badge badge--amber rrow__paused-badge">Paused</span>
      </div>
    </div>

    <div class="rrow__actions">
      <button
        class="rrow__action-btn rrow__action-btn--edit"
        type="button"
        :aria-label="'Edit ' + item.name"
        @click="emit('edit')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit
      </button>
      <button
        class="rrow__action-btn rrow__action-btn--pause"
        type="button"
        :disabled="pausingId === item.id"
        :aria-label="(item.is_active ? 'Pause ' : 'Resume ') + item.name"
        @click="emit('toggle-active')"
      >
        <svg v-if="item.is_active" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {{ pausingId === item.id ? '…' : (item.is_active ? 'Pause' : 'Resume') }}
      </button>

      <template v-if="deleteConfirmId === item.id">
        <button
          class="rrow__action-btn rrow__action-btn--delete-confirm"
          type="button"
          :disabled="deletingId === item.id"
          :aria-label="'Confirm delete ' + item.name"
          @click="emit('confirm-delete')"
        >
          {{ deletingId === item.id ? '…' : 'Confirm delete' }}
        </button>
        <button
          class="rrow__action-btn rrow__action-btn--cancel"
          type="button"
          @click="emit('cancel-delete')"
        >Cancel</button>
      </template>
      <button
        v-else
        class="rrow__action-btn rrow__action-btn--delete"
        type="button"
        :aria-label="'Delete ' + item.name"
        @click="emit('prompt-delete')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" /><path d="M14 11v6" />
          <path d="M9 6V4h6v2" />
        </svg>
        Delete
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ─── RecurringRow ───────────────────────────────────────────────────────────── */
.rrow {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rrow--last { border-bottom: none; }

.rrow--paused { opacity: 0.6; }

.rrow__main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.rrow__left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.rrow__icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rrow__icon-wrap--income {
  background: rgba(5, 150, 105, 0.12);
  color: var(--positive);
}

.rrow__icon-wrap--expense {
  background: rgba(30, 64, 175, 0.10);
  color: var(--primary);
}

.rrow__info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.rrow__name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rrow__meta {
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.rrow__card-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: var(--radius-chip);
  background: rgba(220, 38, 38, 0.10);
  color: var(--negative);
}

.rrow__right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.rrow__amount {
  font-size: 15px;
  font-weight: 600;
}

.rrow__amount--income { color: var(--positive); }
.rrow__amount--expense { color: var(--text); }

.rrow__paused-badge { font-size: 11px; padding: 2px 7px; }
.rrow__mode-badge { font-size: 11px; padding: 2px 7px; }

.rrow__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.rrow__action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease-out, color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}

.rrow__action-btn:hover:not(:disabled) {
  background: var(--border);
  color: var(--text);
}

.rrow__action-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.rrow__action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rrow__action-btn--edit:hover:not(:disabled) { color: var(--primary); }

.rrow__action-btn--delete {
  margin-left: auto;
}

.rrow__action-btn--delete:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.08);
  color: var(--negative);
  border-color: var(--negative);
}

.rrow__action-btn--delete-confirm {
  background: rgba(220, 38, 38, 0.10);
  color: var(--negative);
  border-color: var(--negative);
}

.rrow__action-btn--delete-confirm:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.18);
}
</style>
