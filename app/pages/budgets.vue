<!-- app/pages/budgets.vue
     Per-category monthly budgets: progress bars, inline editing, status badges.
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFetch } from '#app'
import CategoryIcon from '~/components/CategoryIcon.vue'
import { SPEND_CATEGORIES } from '../../shared/categories'
import { formatRM } from '../../shared/types'

interface BudgetRow {
  category: string
  limit_cents: number | null
  spent_cents: number
}

const { data: budgetData, refresh } = await useFetch<BudgetRow[]>('/api/budgets')

const rows = computed<BudgetRow[]>(() => budgetData.value ?? [])

// ── Summary totals ────────────────────────────────────────────────────
const totalSpent = computed(() =>
  rows.value.filter(r => r.limit_cents !== null).reduce((s, r) => s + r.spent_cents, 0)
)
const totalBudgeted = computed(() =>
  rows.value.filter(r => r.limit_cents !== null).reduce((s, r) => s + (r.limit_cents ?? 0), 0)
)
const hasAnyBudget = computed(() => rows.value.some(r => r.limit_cents !== null))
const allNoBudget = computed(() => rows.value.every(r => r.limit_cents === null))

// ── Inline edit state ─────────────────────────────────────────────────
const editingCategory = ref<string | null>(null)
const editAmountRm = ref('')
const editError = ref('')
const saving = ref(false)

function categoryLabel(key: string): string {
  return SPEND_CATEGORIES.find(c => c.key === key)?.label ?? key
}

function openEdit(category: string) {
  const row = rows.value.find(r => r.category === category)
  editingCategory.value = category
  editAmountRm.value = row?.limit_cents != null
    ? (row.limit_cents / 100).toFixed(2)
    : ''
  editError.value = ''
}

function closeEdit() {
  editingCategory.value = null
  editAmountRm.value = ''
  editError.value = ''
}

async function saveEdit(category: string) {
  const rm = parseFloat(editAmountRm.value)
  if (!editAmountRm.value || isNaN(rm) || rm <= 0) {
    editError.value = 'Enter a positive amount'
    return
  }
  saving.value = true
  editError.value = ''
  try {
    await $fetch('/api/budgets', {
      method: 'PUT',
      body: { category, limit_cents: Math.round(rm * 100) },
    })
    closeEdit()
    await refresh()
  } catch (e: any) {
    editError.value = e?.data?.statusMessage ?? 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function removeBudget(category: string) {
  saving.value = true
  try {
    await $fetch(`/api/budgets/${category}`, { method: 'DELETE' })
    closeEdit()
    await refresh()
  } catch {
    // silently ignore
  } finally {
    saving.value = false
  }
}

// ── Progress helpers ──────────────────────────────────────────────────
function pct(row: BudgetRow): number {
  if (!row.limit_cents) return 0
  return Math.min(Math.round((row.spent_cents / row.limit_cents) * 100), 100)
}

function progressClass(row: BudgetRow): string {
  if (!row.limit_cents) return ''
  const p = (row.spent_cents / row.limit_cents) * 100
  if (p > 100) return 'fill--over'
  if (p >= 90) return 'fill--warn'
  return 'fill--ok'
}

function statusText(row: BudgetRow): string {
  if (!row.limit_cents) return ''
  const left = row.limit_cents - row.spent_cents
  if (left < 0) return `Over by ${formatRM(Math.abs(left))}`
  const p = (row.spent_cents / row.limit_cents) * 100
  if (p >= 90) return `${formatRM(left)} left — near limit`
  return `${formatRM(left)} left`
}

function statusClass(row: BudgetRow): string {
  if (!row.limit_cents) return ''
  const left = row.limit_cents - row.spent_cents
  if (left < 0) return 'status--over'
  const p = (row.spent_cents / row.limit_cents) * 100
  if (p >= 90) return 'status--warn'
  return 'status--ok'
}
</script>

<template>
  <div class="budgets">

    <!-- ── Header card ──────────────────────────────────────────────── -->
    <div class="card budgets__header">
      <h1 class="budgets__title">Budgets</h1>
      <p v-if="hasAnyBudget" class="budgets__summary tabnum">
        Total: {{ formatRM(totalSpent) }} spent of {{ formatRM(totalBudgeted) }} budgeted
      </p>
    </div>

    <!-- ── Empty state ──────────────────────────────────────────────── -->
    <div v-if="allNoBudget" class="budgets__empty" data-testid="empty-state">
      <p class="budgets__empty-text">No budgets set yet. Tap a category to set a monthly limit.</p>
    </div>

    <!-- ── Category rows ────────────────────────────────────────────── -->
    <div class="budgets__list">
      <div
        v-for="row in rows"
        :key="row.category"
        class="card budgets__row"
        :data-testid="`budget-row-${row.category}`"
      >
        <!-- Main row: icon + label left, amounts right -->
        <button
          class="budgets__row-main"
          :aria-label="`Edit ${categoryLabel(row.category)} budget`"
          @click="openEdit(row.category)"
        >
          <span class="budgets__icon">
            <CategoryIcon :category="row.category" />
          </span>
          <span class="budgets__label">{{ categoryLabel(row.category) }}</span>
          <span class="budgets__amounts tabnum">
            {{ formatRM(row.spent_cents) }}
            <span class="budgets__amounts-sep"> / </span>
            <span v-if="row.limit_cents !== null">{{ formatRM(row.limit_cents) }}</span>
            <span v-else class="budgets__amounts-dash">—</span>
          </span>
        </button>

        <!-- Progress bar (only if limit set) -->
        <div v-if="row.limit_cents !== null" class="progress-track budgets__track">
          <div
            class="progress-fill budgets__fill"
            :class="progressClass(row)"
            :style="{ width: pct(row) + '%' }"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="pct(row)"
            :aria-label="`${categoryLabel(row.category)} budget progress`"
          />
        </div>

        <!-- Status badge (only if limit set) -->
        <p
          v-if="row.limit_cents !== null"
          class="budgets__status tabnum"
          :class="statusClass(row)"
          :data-testid="`budget-status-${row.category}`"
        >
          {{ statusText(row) }}
        </p>

        <!-- No budget set label + set button -->
        <div v-if="row.limit_cents === null && editingCategory !== row.category" class="budgets__no-budget">
          <span class="budgets__no-budget-label">No budget set</span>
          <button class="btn-secondary budgets__set-btn" @click="openEdit(row.category)">
            Set budget
          </button>
        </div>

        <!-- Inline edit form -->
        <div v-if="editingCategory === row.category" class="budgets__edit-form">
          <label class="budgets__edit-label" :for="`budget-input-${row.category}`">
            Monthly limit (RM)
          </label>
          <div class="budgets__edit-input-wrap">
            <span class="budgets__edit-prefix" aria-hidden="true">RM</span>
            <input
              :id="`budget-input-${row.category}`"
              class="input budgets__edit-input"
              type="number"
              inputmode="decimal"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              :value="editAmountRm"
              @input="editAmountRm = ($event.target as HTMLInputElement).value"
            />
          </div>
          <span v-if="editError" class="budgets__edit-error" role="alert">{{ editError }}</span>
          <div class="budgets__edit-actions">
            <button
              class="btn-primary budgets__save-btn"
              :disabled="saving"
              @click="saveEdit(row.category)"
            >
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
            <button class="budgets__cancel-link" @click="closeEdit">Cancel</button>
          </div>
          <button
            v-if="row.limit_cents !== null"
            class="budgets__remove-btn"
            :disabled="saving"
            @click="removeBudget(row.category)"
          >
            Remove budget
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ───────────────────────────────────────────────────────── */
.budgets {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Header card ──────────────────────────────────────────────────── */
.budgets__header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 20px;
}

.budgets__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
  letter-spacing: -0.01em;
}

.budgets__summary {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
}

/* ── Empty state ──────────────────────────────────────────────────── */
.budgets__empty {
  text-align: center;
  padding: 32px 24px;
}
.budgets__empty-text {
  font-size: 15px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}

/* ── Category rows ────────────────────────────────────────────────── */
.budgets__row {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
}

.budgets__row-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.budgets__row-main:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
  border-radius: var(--radius-card);
}

.budgets__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text-muted);
  flex-shrink: 0;
}

.budgets__label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
}

.budgets__amounts {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
}
.budgets__amounts-sep {
  color: var(--border);
}
.budgets__amounts-dash {
  color: var(--text-muted);
}

/* ── Progress bar ─────────────────────────────────────────────────── */
.budgets__track {
  margin: 0 16px 6px;
}

.budgets__fill {
  transition: width 400ms ease-out;
}
.budgets__fill.fill--ok   { background: var(--positive); }
.budgets__fill.fill--warn { background: var(--warning); }
.budgets__fill.fill--over { background: var(--negative); }

@media (prefers-reduced-motion: reduce) {
  .budgets__fill {
    transition: none !important;
  }
}

/* ── Status text ──────────────────────────────────────────────────── */
.budgets__status {
  font-size: 12px;
  font-weight: 500;
  margin: 0 16px 10px;
}
.budgets__status.status--ok   { color: var(--text-muted); }
.budgets__status.status--warn { color: var(--warning); }
.budgets__status.status--over { color: var(--negative); }

/* ── No budget / Set budget button ───────────────────────────────── */
.budgets__no-budget {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 12px;
  gap: 8px;
}
.budgets__no-budget-label {
  font-size: 13px;
  color: var(--text-muted);
}

/* .btn-secondary is now defined globally in tokens.css (promoted in v2). */

/* ── Inline edit form ─────────────────────────────────────────────── */
.budgets__edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 16px 16px;
  border-top: 1px solid var(--border);
}

.budgets__edit-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.budgets__edit-input-wrap {
  position: relative;
}
.budgets__edit-prefix {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  color: var(--text-muted);
  pointer-events: none;
}
.budgets__edit-input {
  padding-left: 42px;
}

.budgets__edit-error {
  font-size: 12px;
  color: var(--negative);
  font-weight: 500;
}

.budgets__edit-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.budgets__save-btn {
  flex: 1;
  min-height: 44px;
}

.budgets__cancel-link {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 8px 4px;
  -webkit-tap-highlight-color: transparent;
  min-height: 44px;
}
.budgets__cancel-link:hover { color: var(--text); }
.budgets__cancel-link:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 4px;
}

.budgets__remove-btn {
  border: none;
  background: transparent;
  color: var(--negative);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 0;
  text-align: left;
  min-height: 44px;
  -webkit-tap-highlight-color: transparent;
}
.budgets__remove-btn:hover { opacity: 0.8; }
.budgets__remove-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 4px;
}
.budgets__remove-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
