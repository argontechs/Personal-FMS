<!-- app/pages/activity.vue
     Activity screen — monthly transaction list with date-group headers,
     edit (bottom sheet), delete+undo, empty state, system-row filter.
-->
<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import CategoryIcon from '~/components/CategoryIcon.vue'
import { SPEND_CATEGORIES } from '../../shared/categories'

// ── Transaction shape from GET /api/transactions ──────────────────────────
interface Transaction {
  id: number
  uuid: string
  date: string          // YYYY-MM-DD
  amount_cents: number  // negative = expense, positive = income
  direction: string
  category: string
  account_id: number
  counter_account_id: number | null
  debt_id: number | null
  goal_id: number | null
  note: string | null
  source: string
  is_estimate: boolean
}

// ── System categories to hide ─────────────────────────────────────────────
const SYSTEM_CATS = new Set(['opening-balance', 'adjustment', 'transfer'])

// ── Month state ───────────────────────────────────────────────────────────
const today = new Date()
const currentYear = ref(today.getFullYear())
const currentMonth = ref(today.getMonth() + 1) // 1-based

const monthISO = computed(() => {
  const mm = String(currentMonth.value).padStart(2, '0')
  return `${currentYear.value}-${mm}`
})

const monthLabel = computed(() => {
  const d = new Date(currentYear.value, currentMonth.value - 1, 1)
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
})

function prevMonth() {
  if (currentMonth.value === 1) {
    currentMonth.value = 12
    currentYear.value--
  } else {
    currentMonth.value--
  }
}

function nextMonth() {
  // Don't allow navigating beyond current month
  const now = new Date()
  if (currentYear.value === now.getFullYear() && currentMonth.value === now.getMonth() + 1) return
  if (currentMonth.value === 12) {
    currentMonth.value = 1
    currentYear.value++
  } else {
    currentMonth.value++
  }
}

const isCurrentMonth = computed(() => {
  const now = new Date()
  return currentYear.value === now.getFullYear() && currentMonth.value === now.getMonth() + 1
})

// ── Data fetch ────────────────────────────────────────────────────────────
const loading = ref(false)
const transactions = ref<Transaction[]>([])

async function loadTransactions() {
  loading.value = true
  try {
    const data = await $fetch<Transaction[]>(`/api/transactions?month=${monthISO.value}`)
    transactions.value = Array.isArray(data) ? data : []
  } catch {
    transactions.value = []
  } finally {
    loading.value = false
  }
}

// Initial load
loadTransactions()

// Reload when month changes
watch(monthISO, loadTransactions)

// ── Filtered + grouped transactions ──────────────────────────────────────
const userTransactions = computed(() =>
  transactions.value.filter(t => !SYSTEM_CATS.has(t.category))
)

/** Format YYYY-MM-DD → "Monday, 19 Jun" */
function formatDateHeader(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

interface DateGroup {
  dateISO: string
  label: string
  rows: Transaction[]
}

const grouped = computed((): DateGroup[] => {
  const map = new Map<string, Transaction[]>()
  for (const t of userTransactions.value) {
    const arr = map.get(t.date) ?? []
    arr.push(t)
    map.set(t.date, arr)
  }
  // Sort dates descending (newest first)
  const sorted = [...map.keys()].sort((a, b) => b.localeCompare(a))
  return sorted.map(dateISO => ({
    dateISO,
    label: formatDateHeader(dateISO),
    rows: map.get(dateISO)!,
  }))
})

// ── Category label lookup ─────────────────────────────────────────────────
function categoryLabel(key: string): string {
  return SPEND_CATEGORIES.find(c => c.key === key)?.label ?? key
}

// ── Amount formatting ─────────────────────────────────────────────────────
function formatAmount(cents: number): string {
  const abs = Math.abs(cents) / 100
  return abs.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isExpense(t: Transaction): boolean {
  return t.amount_cents < 0 || t.direction === 'expense'
}

// ── Delete + Undo ─────────────────────────────────────────────────────────
interface ToastState {
  visible: boolean
  message: string
  undoFn: (() => Promise<void>) | null
  timer: ReturnType<typeof setTimeout> | null
}

const toast = ref<ToastState>({ visible: false, message: '', undoFn: null, timer: null })

function showToast(message: string, undoFn: () => Promise<void>) {
  if (toast.value.timer) clearTimeout(toast.value.timer)
  toast.value = {
    visible: true,
    message,
    undoFn,
    timer: setTimeout(() => {
      toast.value.visible = false
      toast.value.undoFn = null
    }, 5000),
  }
}

async function deleteTransaction(txn: Transaction) {
  // Optimistically remove from list
  const idx = transactions.value.findIndex(t => t.id === txn.id)
  if (idx !== -1) transactions.value.splice(idx, 1)

  try {
    await $fetch(`/api/transactions/${txn.id}`, { method: 'DELETE' })
  } catch {
    // Restore on failure
    transactions.value.splice(idx, 0, txn)
    return
  }

  // Show undo toast
  showToast('Transaction deleted', async () => {
    try {
      await $fetch<{ id: number }>('/api/transactions', {
        method: 'POST',
        body: {
          uuid: crypto.randomUUID(),
          date: txn.date,
          amount_cents: txn.amount_cents,
          direction: txn.direction,
          category: txn.category,
          account_id: txn.account_id,
          counter_account_id: txn.counter_account_id ?? null,
          debt_id: txn.debt_id ?? null,
          goal_id: txn.goal_id ?? null,
          note: txn.note ?? null,
          source: txn.source,
          is_estimate: txn.is_estimate ?? false,
        },
      })
      toast.value.visible = false
      await loadTransactions()
    } catch {
      // Silently fail undo to avoid UX noise
    }
  })
}

async function handleUndo() {
  if (toast.value.undoFn) {
    if (toast.value.timer) clearTimeout(toast.value.timer)
    await toast.value.undoFn()
  }
}

// ── Edit sheet ────────────────────────────────────────────────────────────
const editSheet = ref(false)
const editTarget = ref<Transaction | null>(null)

// Form fields
const editAmountRm = ref('')
const editCategory = ref('')
const editNote = ref('')
const editDate = ref('')
const editErrors = ref<Record<string, string>>({})
const editSaving = ref(false)

function openEdit(txn: Transaction) {
  editTarget.value = txn
  editAmountRm.value = (Math.abs(txn.amount_cents) / 100).toFixed(2)
  editCategory.value = txn.category
  editNote.value = txn.note ?? ''
  editDate.value = txn.date
  editErrors.value = {}
  editSheet.value = true
  nextTick(() => {
    ;(document.querySelector('.edit-sheet__amount') as HTMLElement)?.focus()
  })
}

function closeEdit() {
  editSheet.value = false
  editTarget.value = null
}

function validateEdit(): boolean {
  const errs: Record<string, string> = {}
  const amt = parseFloat(editAmountRm.value)
  if (!editAmountRm.value || isNaN(amt) || amt <= 0) {
    errs.amount = 'Enter a positive amount'
  }
  if (!SPEND_CATEGORIES.find(c => c.key === editCategory.value)) {
    errs.category = 'Select a category'
  }
  if (!editDate.value || !/^\d{4}-\d{2}-\d{2}$/.test(editDate.value)) {
    errs.date = 'Enter a valid date (YYYY-MM-DD)'
  }
  editErrors.value = errs
  return Object.keys(errs).length === 0
}

async function saveEdit() {
  if (!editTarget.value) return
  if (!validateEdit()) return
  editSaving.value = true

  const newAmountCents = Math.round(parseFloat(editAmountRm.value) * 100)
  const signedCents = isExpense(editTarget.value) ? -newAmountCents : newAmountCents

  try {
    const updated = await $fetch<Transaction>(`/api/transactions/${editTarget.value.id}`, {
      method: 'PATCH',
      body: {
        amount_cents: signedCents,
        category: editCategory.value,
        note: editNote.value || null,
        date: editDate.value,
      },
    })
    // Update in-place
    const idx = transactions.value.findIndex(t => t.id === editTarget.value!.id)
    if (idx !== -1) transactions.value[idx] = updated
    closeEdit()
  } catch (e: any) {
    editErrors.value.save = e?.data?.statusMessage ?? 'Failed to save'
  } finally {
    editSaving.value = false
  }
}
</script>

<template>
  <div class="activity">

    <!-- ── Month switcher ─────────────────────────────────────────────── -->
    <header class="activity__header">
      <button
        class="activity__month-btn"
        aria-label="Previous month"
        @click="prevMonth"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h1 class="activity__month-label">{{ monthLabel }}</h1>
      <button
        class="activity__month-btn"
        aria-label="Next month"
        :disabled="isCurrentMonth"
        @click="nextMonth"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </header>

    <!-- ── Loading skeleton ───────────────────────────────────────────── -->
    <div v-if="loading" class="activity__skeleton" aria-label="Loading transactions…" />

    <!-- ── Empty state ────────────────────────────────────────────────── -->
    <div
      v-else-if="!loading && userTransactions.length === 0"
      class="activity__empty"
      data-testid="empty-state"
    >
      <div class="activity__empty-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
          stroke-linejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2"/>
          <line x1="2" y1="10" x2="22" y2="10"/>
        </svg>
      </div>
      <p class="activity__empty-title">No spending logged yet</p>
      <p class="activity__empty-hint">Use the <strong>+</strong> on Home to log your first transaction.</p>
    </div>

    <!-- ── Grouped list ───────────────────────────────────────────────── -->
    <div v-else class="activity__list" role="list">
      <section
        v-for="group in grouped"
        :key="group.dateISO"
        class="activity__group"
      >
        <p class="activity__date-header section-label">{{ group.label }}</p>

        <div class="card activity__group-card">
          <div
            v-for="(txn, i) in group.rows"
            :key="txn.id"
            class="list-row"
            role="listitem"
          >
            <!-- ── Icon + name/note ───────────────────────────────────── -->
            <button
              class="list-row__main"
              :aria-label="`Edit ${categoryLabel(txn.category)} transaction`"
              @click="openEdit(txn)"
            >
              <span class="list-row__icon">
                <CategoryIcon :category="txn.category" />
              </span>
              <span class="list-row__info">
                <span class="list-row__name">{{ categoryLabel(txn.category) }}</span>
                <span v-if="txn.note" class="list-row__note">{{ txn.note }}</span>
              </span>
            </button>

            <!-- ── Amount + delete ────────────────────────────────────── -->
            <div class="list-row__right">
              <span
                class="list-row__amount tabnum"
                :class="isExpense(txn) ? 'list-row__amount--expense' : 'list-row__amount--income'"
              >
                {{ isExpense(txn) ? '-' : '+' }}RM{{ formatAmount(txn.amount_cents) }}
              </span>
              <button
                class="list-row__delete"
                :aria-label="`Delete ${categoryLabel(txn.category)} transaction`"
                @click="deleteTransaction(txn)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            </div>

            <!-- Divider between rows -->
            <div v-if="i < group.rows.length - 1" class="list-row__divider" aria-hidden="true" />
          </div>
        </div>
      </section>
    </div>

    <!-- ── Undo toast ──────────────────────────────────────────────────── -->
    <div
      v-if="toast.visible"
      class="activity__toast"
      role="status"
      aria-live="polite"
      data-testid="undo-toast"
    >
      <span class="activity__toast-msg">{{ toast.message }}</span>
      <button class="activity__toast-undo" @click="handleUndo">Undo</button>
    </div>

    <!-- ── Edit bottom sheet ──────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="editSheet"
        class="edit-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Edit transaction"
        @click.self="closeEdit"
      >
        <div class="edit-sheet" data-testid="edit-sheet">
          <div class="edit-sheet__handle" aria-hidden="true" />

          <h2 class="edit-sheet__title">Edit transaction</h2>

          <!-- Amount -->
          <div class="edit-sheet__field">
            <label class="edit-sheet__label" for="edit-amount">Amount (RM)</label>
            <div class="edit-sheet__prefix-wrap">
              <span class="edit-sheet__prefix" aria-hidden="true">RM</span>
              <input
                id="edit-amount"
                class="input edit-sheet__amount"
                type="number"
                inputmode="decimal"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                :value="editAmountRm"
                @input="editAmountRm = ($event.target as HTMLInputElement).value"
                aria-describedby="edit-amount-err"
              />
            </div>
            <span v-if="editErrors.amount" id="edit-amount-err" class="edit-sheet__error" role="alert">{{ editErrors.amount }}</span>
          </div>

          <!-- Category chips -->
          <div class="edit-sheet__field">
            <p class="edit-sheet__label">Category</p>
            <div class="edit-sheet__chips" role="group" aria-label="Select category">
              <button
                v-for="cat in SPEND_CATEGORIES"
                :key="cat.key"
                class="edit-sheet__chip"
                :class="{ 'edit-sheet__chip--active': editCategory === cat.key }"
                :aria-pressed="editCategory === cat.key"
                :data-test="`edit-cat-${cat.key}`"
                @click="editCategory = cat.key"
              >
                <CategoryIcon :category="cat.key" />
                {{ cat.label }}
              </button>
            </div>
            <span v-if="editErrors.category" class="edit-sheet__error" role="alert">{{ editErrors.category }}</span>
          </div>

          <!-- Note -->
          <div class="edit-sheet__field">
            <label class="edit-sheet__label" for="edit-note">Note (optional)</label>
            <input
              id="edit-note"
              class="input"
              type="text"
              placeholder="e.g. Lunch at Old Town"
              :value="editNote"
              @input="editNote = ($event.target as HTMLInputElement).value"
            />
          </div>

          <!-- Date -->
          <div class="edit-sheet__field">
            <label class="edit-sheet__label" for="edit-date">Date</label>
            <input
              id="edit-date"
              class="input"
              type="date"
              :value="editDate"
              @input="editDate = ($event.target as HTMLInputElement).value"
              aria-describedby="edit-date-err"
            />
            <span v-if="editErrors.date" id="edit-date-err" class="edit-sheet__error" role="alert">{{ editErrors.date }}</span>
          </div>

          <!-- Save error -->
          <span v-if="editErrors.save" class="edit-sheet__error" role="alert">{{ editErrors.save }}</span>

          <!-- Actions -->
          <div class="edit-sheet__actions">
            <button class="edit-sheet__cancel" @click="closeEdit">Cancel</button>
            <button
              class="btn-primary edit-sheet__save"
              :disabled="editSaving"
              @click="saveEdit"
            >{{ editSaving ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────────── */
.activity {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 80px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Header / month switcher ─────────────────────────────────────────── */
.activity__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0 16px;
}

.activity__month-label {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
  letter-spacing: -0.01em;
}

.activity__month-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--radius-btn);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: background 120ms ease-out;
}
.activity__month-btn:hover:not(:disabled) {
  background: var(--surface-2);
}
.activity__month-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.activity__month-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* ── Loading skeleton ─────────────────────────────────────────────────── */
.activity__skeleton {
  height: 200px;
  border-radius: var(--radius-card);
  background: var(--surface-2);
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

/* ── Empty state ──────────────────────────────────────────────────────── */
.activity__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 56px 24px;
  gap: 12px;
}
.activity__empty-icon {
  color: var(--text-muted);
  opacity: 0.5;
}
.activity__empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}
.activity__empty-hint {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
  max-width: 260px;
}

/* ── Group sections ───────────────────────────────────────────────────── */
.activity__group {
  margin-bottom: 20px;
}
.activity__date-header {
  padding: 0 4px;
  margin-bottom: 8px;
}

.activity__group-card {
  padding: 0;
  overflow: hidden;
}

/* ── List rows ────────────────────────────────────────────────────────── */
.list-row {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 56px;
  padding: 0 4px 0 0;
}

.list-row__main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  color: inherit;
}
.list-row__main:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
  border-radius: var(--radius-input);
}

.list-row__icon {
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

.list-row__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.list-row__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-row__note {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-row__right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding-right: 8px;
}

.list-row__amount {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}
.list-row__amount--expense {
  color: var(--text);
}
.list-row__amount--income {
  color: var(--positive);
}

.list-row__delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: var(--negative);
  cursor: pointer;
  border-radius: var(--radius-btn);
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: background 120ms ease-out;
}
.list-row__delete:hover {
  background: rgba(220, 38, 38, 0.08);
}
.list-row__delete:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.list-row__divider {
  position: absolute;
  bottom: 0;
  left: 60px;
  right: 0;
  height: 1px;
  background: var(--border);
}

/* ── Undo toast ───────────────────────────────────────────────────────── */
.activity__toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--text);
  color: var(--surface);
  border-radius: var(--radius-btn);
  padding: 12px 16px;
  font-size: 14px;
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  white-space: nowrap;
  animation: toast-in 200ms ease-out;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.activity__toast-msg {
  font-weight: 500;
}

.activity__toast-undo {
  border: none;
  background: transparent;
  color: #60A5FA;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}
.activity__toast-undo:focus-visible {
  outline: 2px solid #60A5FA;
  outline-offset: 2px;
  border-radius: 4px;
}

/* ── Edit overlay + sheet ─────────────────────────────────────────────── */
.edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  z-index: 500;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.edit-sheet {
  background: var(--surface);
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  padding: 12px 20px 32px;
  max-height: 90dvh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: var(--shadow-lg);
}

.edit-sheet__handle {
  width: 40px;
  height: 4px;
  background: var(--border);
  border-radius: var(--radius-track);
  align-self: center;
  margin-bottom: 4px;
}

.edit-sheet__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
  letter-spacing: -0.01em;
}

.edit-sheet__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-sheet__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0;
}

.edit-sheet__prefix-wrap {
  position: relative;
}
.edit-sheet__prefix {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 16px;
  color: var(--text-muted);
  pointer-events: none;
}
.edit-sheet__amount {
  padding-left: 38px;
}

.edit-sheet__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.edit-sheet__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-chip);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: border-color 120ms ease-out, background 120ms ease-out, color 120ms ease-out;
  min-height: 44px;
}
.edit-sheet__chip--active {
  border-color: var(--primary);
  background: rgba(30, 64, 175, 0.08);
  color: var(--primary);
}
.edit-sheet__chip:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.edit-sheet__error {
  font-size: 12px;
  color: var(--negative);
  font-weight: 500;
}

.edit-sheet__actions {
  display: flex;
  gap: 12px;
}

.edit-sheet__cancel {
  flex: 1;
  height: 48px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-btn);
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-base);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 120ms ease-out;
}
.edit-sheet__cancel:hover {
  background: var(--surface-2);
}
.edit-sheet__cancel:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

.edit-sheet__save {
  flex: 2;
}

/* ── Reduced motion ───────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .activity__skeleton,
  .activity__toast {
    animation: none !important;
  }
}
</style>
