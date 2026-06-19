<!-- app/pages/bills.vue -->
<!-- Bills & Subscriptions — lists, adds, edits, pauses/resumes, and deletes recurring items. -->
<!-- Auth: global middleware (auth.global.ts) guards all pages; DO NOT add definePageMeta auth here. -->
<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useFetch } from '#app'
// Explicit import (not Nuxt auto-import) so the component resolves under the vitest harness too —
// consistent with every other page; the build still statically inlines it.
import RecurringRow from '~/components/RecurringRow.vue'

// ─── Constants (match server validation) ─────────────────────────────────────
const VALID_CADENCES = ['monthly', 'weekly', 'biweekly', 'yearly'] as const
type Cadence = typeof VALID_CADENCES[number]

const VALID_CATEGORIES = ['food', 'transport', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'] as const
type Category = typeof VALID_CATEGORIES[number]

const VALID_DIRECTIONS = ['income', 'expense'] as const
type Direction = typeof VALID_DIRECTIONS[number]

// ─── Types ────────────────────────────────────────────────────────────────────
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

interface Account {
  id: number
  name: string
  type: string
  balance_cents: number
  is_active: boolean
}

// ─── Data fetching ────────────────────────────────────────────────────────────
// `?all=1` so paused items stay listed (and can be resumed) instead of vanishing on refresh.
const { data: rawItems, refresh: refreshItems, error: itemsError } = await useFetch<RecurringItem[]>('/api/recurring', { query: { all: '1' } })
const { data: accounts } = await useFetch<Account[]>('/api/accounts')

const localItems = ref<RecurringItem[]>([])
const hasFetched = ref(false)

function syncFromServer() {
  if (Array.isArray(rawItems.value)) {
    localItems.value = rawItems.value as RecurringItem[]
    hasFetched.value = true
  }
}
syncFromServer()

// ─── Grouped views ────────────────────────────────────────────────────────────
const incomeItems = computed(() =>
  localItems.value.filter(i => i.direction === 'income')
)

const billItems = computed(() =>
  localItems.value.filter(i => i.direction === 'expense' && i.category !== 'debt')
)

const debtItems = computed(() =>
  localItems.value.filter(i => i.direction === 'expense' && i.category === 'debt')
)

// ─── Upcoming charges (next ~14 days) ───────────────────────────────────────────
// Active EXPENSE items (both auto-deduct and reminder-only) whose next_due_date falls
// within today..today+14. Reminder-only ones are the ones the user must act on himself.
const UPCOMING_WINDOW_DAYS = 14

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

interface UpcomingCharge {
  id: number
  name: string
  amount_cents: number
  is_variable: boolean
  next_due_date: string
  auto_post: boolean
}

const upcomingCharges = computed<UpcomingCharge[]>(() => {
  const today = todayISO()
  const horizon = addDaysISO(today, UPCOMING_WINDOW_DAYS)
  return localItems.value
    .filter(i =>
      i.direction === 'expense' &&
      i.is_active &&
      i.next_due_date != null &&
      i.next_due_date >= today &&
      i.next_due_date <= horizon,
    )
    .map(i => ({
      id: i.id,
      name: i.name,
      amount_cents: i.amount_cents,
      is_variable: i.is_variable,
      next_due_date: i.next_due_date as string,
      auto_post: i.auto_post,
    }))
    .sort((a, b) => a.next_due_date.localeCompare(b.next_due_date))
})

function chargeAmount(c: UpcomingCharge): string {
  const prefix = c.is_variable ? '~' : ''
  return prefix + 'RM' + (c.amount_cents / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Card-funded items eligible for flip-off-card
const cardAccountId = computed<number | null>(() => {
  if (!accounts.value) return null
  const arr = Array.isArray(accounts.value) ? accounts.value : []
  const card = arr.find((a: Account) => a.type === 'card' && a.is_active)
  return card?.id ?? null
})

const bankAccountId = computed<number | null>(() => {
  if (!accounts.value) return null
  const arr = Array.isArray(accounts.value) ? accounts.value : []
  const bank = arr.find((a: Account) => a.type === 'bank' && a.is_active)
  return bank?.id ?? null
})

function isCardFunded(item: RecurringItem): boolean {
  if (!cardAccountId.value || !item.funding_account_id) return false
  return item.funding_account_id === cardAccountId.value
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cadenceLabel(c: Cadence): string {
  return { monthly: 'Monthly', weekly: 'Weekly', biweekly: 'Biweekly', yearly: 'Yearly' }[c] ?? c
}

function accountName(id: number | null): string {
  if (!id || !accounts.value) return ''
  const arr = Array.isArray(accounts.value) ? accounts.value : []
  const a = arr.find((x: Account) => x.id === id)
  return a?.name ?? ''
}

function todayISO(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).slice(0, 10)
}

// ─── Add sheet ────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const addNameRef = ref<HTMLInputElement | null>(null)
const addError = ref('')
const addSubmitting = ref(false)

// mode → auto_post: 'auto' = auto-deduct (logs a ledger txn), 'reminder' = reminder-only (user logs it).
type PostMode = 'auto' | 'reminder'

const addForm = ref({
  name: '',
  direction: 'expense' as Direction,
  amount_rm: '',
  is_variable: false,
  cadence: 'monthly' as Cadence,
  day_of_month: '' as string | number,
  weekday: '' as string | number,
  category: 'bills' as Category,
  funding_account_id: '' as string | number,
  start_date: todayISO(),
  mode: 'auto' as PostMode,
})

function openAdd() {
  addForm.value = {
    name: '',
    direction: 'expense',
    amount_rm: '',
    is_variable: false,
    cadence: 'monthly',
    day_of_month: '',
    weekday: '',
    category: 'bills',
    funding_account_id: '',
    start_date: todayISO(),
    mode: 'auto',
  }
  addError.value = ''
  addSubmitting.value = false
  addOpen.value = true
  nextTick(() => addNameRef.value?.focus())
}

function closeAdd() {
  addOpen.value = false
  addError.value = ''
}

async function submitAdd() {
  addError.value = ''
  const rmVal = parseFloat(String(addForm.value.amount_rm))
  if (!addForm.value.name.trim()) { addError.value = 'Name is required.'; return }
  if (isNaN(rmVal) || rmVal < 0) { addError.value = 'Enter a valid amount.'; return }

  const body: Record<string, unknown> = {
    name: addForm.value.name.trim(),
    direction: addForm.value.direction,
    amount_cents: Math.round(rmVal * 100),
    is_variable: addForm.value.is_variable,
    cadence: addForm.value.cadence,
    category: addForm.value.category,
    start_date: addForm.value.start_date || todayISO(),
    // Income always auto-posts (payday credit). For expenses, honour the chosen mode:
    // 'reminder' → auto_post:false (display + remind, user logs it; still counted in Safe-to-Spend).
    auto_post: addForm.value.direction === 'income' ? true : addForm.value.mode === 'auto',
    is_active: true,
  }
  if (addForm.value.day_of_month !== '') body.day_of_month = Number(addForm.value.day_of_month)
  if (addForm.value.weekday !== '') body.weekday = Number(addForm.value.weekday)
  if (addForm.value.funding_account_id !== '') body.funding_account_id = Number(addForm.value.funding_account_id)

  addSubmitting.value = true
  try {
    const newItem = await $fetch<RecurringItem>('/api/recurring', { method: 'POST', body })
    localItems.value = [...localItems.value, newItem]
    closeAdd()
  } catch (err: any) {
    addError.value = err?.data?.statusMessage ?? err?.message ?? 'Failed to add. Please try again.'
  } finally {
    addSubmitting.value = false
  }
}

// ─── Edit sheet ───────────────────────────────────────────────────────────────
const editOpen = ref(false)
const editInputRef = ref<HTMLInputElement | null>(null)
const editError = ref('')
const editSubmitting = ref(false)
const editingId = ref<number | null>(null)

const editForm = ref({
  name: '',
  amount_rm: '',
  is_variable: false,
  cadence: 'monthly' as Cadence,
  day_of_month: '' as string | number,
  weekday: '' as string | number,
  category: 'bills' as Category,
  funding_account_id: '' as string | number,
  direction: 'expense' as Direction,
  mode: 'auto' as PostMode,
})

function openEdit(item: RecurringItem) {
  editingId.value = item.id
  editForm.value = {
    name: item.name,
    amount_rm: (item.amount_cents / 100).toFixed(2),
    is_variable: item.is_variable,
    cadence: item.cadence,
    day_of_month: item.day_of_month ?? '',
    weekday: item.weekday ?? '',
    category: item.category as Category,
    funding_account_id: item.funding_account_id ?? '',
    direction: item.direction,
    mode: item.auto_post ? 'auto' : 'reminder',
  }
  editError.value = ''
  editSubmitting.value = false
  editOpen.value = true
  nextTick(() => editInputRef.value?.focus())
}

function closeEdit() {
  editOpen.value = false
  editError.value = ''
  editingId.value = null
}

async function submitEdit() {
  editError.value = ''
  if (!editingId.value) return
  const rmVal = parseFloat(String(editForm.value.amount_rm))
  if (!editForm.value.name.trim()) { editError.value = 'Name is required.'; return }
  if (isNaN(rmVal) || rmVal < 0) { editError.value = 'Enter a valid amount.'; return }

  const body: Record<string, unknown> = {
    name: editForm.value.name.trim(),
    amount_cents: Math.round(rmVal * 100),
    is_variable: editForm.value.is_variable,
    cadence: editForm.value.cadence,
    category: editForm.value.category,
    day_of_month: editForm.value.day_of_month !== '' ? Number(editForm.value.day_of_month) : null,
    weekday: editForm.value.weekday !== '' ? Number(editForm.value.weekday) : null,
    funding_account_id: editForm.value.funding_account_id !== '' ? Number(editForm.value.funding_account_id) : null,
    // Persist the deduct/reminder choice. Income stays auto_post (payday credit).
    auto_post: editForm.value.direction === 'income' ? true : editForm.value.mode === 'auto',
  }

  editSubmitting.value = true
  try {
    const updated = await $fetch<RecurringItem>(`/api/recurring/${editingId.value}`, { method: 'PATCH', body })
    localItems.value = localItems.value.map(i => i.id === editingId.value ? updated : i)
    closeEdit()
  } catch (err: any) {
    editError.value = err?.data?.statusMessage ?? err?.message ?? 'Failed to update. Please try again.'
  } finally {
    editSubmitting.value = false
  }
}

// ─── Pause / resume ───────────────────────────────────────────────────────────
const pausingId = ref<number | null>(null)

async function toggleActive(item: RecurringItem) {
  pausingId.value = item.id
  try {
    const updated = await $fetch<RecurringItem>(`/api/recurring/${item.id}`, {
      method: 'PATCH',
      body: { is_active: !item.is_active },
    })
    localItems.value = localItems.value.map(i => i.id === item.id ? updated : i)
  } catch {
    // silently ignore — item stays as-is
  } finally {
    pausingId.value = null
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────
const deleteConfirmId = ref<number | null>(null)
const deletingId = ref<number | null>(null)

function promptDelete(item: RecurringItem) {
  deleteConfirmId.value = item.id
}

function cancelDelete() {
  deleteConfirmId.value = null
}

async function confirmDelete(id: number) {
  deletingId.value = id
  try {
    await $fetch(`/api/recurring/${id}`, { method: 'DELETE' })
    localItems.value = localItems.value.filter(i => i.id !== id)
    deleteConfirmId.value = null
  } catch {
    // silently ignore
  } finally {
    deletingId.value = null
  }
}

// ─── Flip off card ────────────────────────────────────────────────────────────
const flipOpen = ref(false)
const flipSubmitting = ref(false)
const flipError = ref('')
const flipResult = ref<{ flipped: number; paused: number } | null>(null)

function openFlip() {
  flipError.value = ''
  flipResult.value = null
  flipOpen.value = true
}

function closeFlip() {
  flipOpen.value = false
  flipError.value = ''
  flipResult.value = null
}

async function submitFlip() {
  if (!cardAccountId.value || !bankAccountId.value) {
    flipError.value = 'Could not determine card / bank account IDs.'
    return
  }
  flipSubmitting.value = true
  flipError.value = ''
  try {
    const res = await $fetch<{ flipped: number; paused: number }>('/api/recurring/flip-off-card', {
      method: 'POST',
      body: {
        card_account_id: cardAccountId.value,
        bank_account_id: bankAccountId.value,
      },
    })
    flipResult.value = res
    await refreshItems()
    syncFromServer()
  } catch (err: any) {
    flipError.value = err?.data?.statusMessage ?? err?.message ?? 'Flip failed. Please try again.'
  } finally {
    flipSubmitting.value = false
  }
}

// RecurringRow is a compiled SFC at app/components/RecurringRow.vue (auto-imported by Nuxt)
</script>

<template>
  <div class="bills-page">

    <!-- Page header -->
    <div class="bills-page__header">
      <h1 class="bills-page__title">Bills &amp; Subscriptions</h1>
      <button
        class="btn-primary bills-page__add-btn"
        type="button"
        aria-label="Add new recurring item"
        @click="openAdd"
      >
        <!-- plus icon -->
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add
      </button>
    </div>

    <!-- Error state -->
    <div
      v-if="itemsError"
      class="card bills-page__error"
      role="alert"
      aria-live="assertive"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="bills-page__error-icon">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p class="bills-page__error-msg">Couldn't load recurring items.</p>
      <button class="btn-primary bills-page__retry-btn" type="button" @click="refreshItems">Retry</button>
    </div>

    <!-- Loading skeleton -->
    <template v-else-if="!hasFetched">
      <div class="bills-page__skeleton" aria-label="Loading…" />
    </template>

    <!-- Content -->
    <template v-else>

      <!-- Flip-off-card banner (only when card-funded items exist) -->
      <div
        v-if="cardAccountId && bankAccountId && localItems.some(i => isCardFunded(i) && i.is_active)"
        class="card bills-page__flip-banner"
        data-test="flip-banner"
        role="region"
        aria-label="Move off credit card"
      >
        <div class="bills-page__flip-row">
          <!-- credit-card icon -->
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="bills-page__flip-icon">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
          <div class="bills-page__flip-body">
            <p class="bills-page__flip-title">Stop feeding the 18% card</p>
            <p class="bills-page__flip-desc">Move all card-funded recurring payments to your bank account in one step.</p>
          </div>
        </div>
        <button
          class="btn-primary bills-page__flip-btn"
          type="button"
          aria-label="Move all card-funded recurring payments to bank account"
          @click="openFlip"
        >
          Move off credit card
        </button>
      </div>

      <!-- Upcoming charges (next 14 days) — both auto-deduct and reminder-only items -->
      <section
        v-if="upcomingCharges.length"
        class="bills-page__group"
        data-test="upcoming-charges"
        aria-label="Upcoming charges"
      >
        <p class="section-label">Upcoming charges · next 14 days</p>
        <div class="card bills-page__upcoming">
          <div
            v-for="c in upcomingCharges"
            :key="'up-' + c.id"
            class="upcoming-row"
            data-test="upcoming-row"
          >
            <div class="upcoming-row__left">
              <span class="upcoming-row__name">{{ c.name }}</span>
              <span class="upcoming-row__date">{{ c.next_due_date }}</span>
            </div>
            <div class="upcoming-row__right">
              <span class="upcoming-row__amount tabnum">{{ chargeAmount(c) }}</span>
              <span
                :class="['badge', c.auto_post ? 'badge--blue' : 'badge--amber', 'upcoming-row__badge']"
                data-test="upcoming-mode-badge"
              >{{ c.auto_post ? 'Auto' : 'Reminder' }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Income group -->
      <section v-if="incomeItems.length" class="bills-page__group" aria-label="Income">
        <p class="section-label">Income</p>
        <div class="card bills-page__list">
          <RecurringRow
            v-for="(item, idx) in incomeItems"
            :key="item.id"
            :item="item"
            :is-last="idx === incomeItems.length - 1"
            :delete-confirm-id="deleteConfirmId"
            :pausing-id="pausingId"
            :deleting-id="deletingId"
            :account-name="accountName(item.funding_account_id)"
            :is-card-funded="isCardFunded(item)"
            @edit="openEdit(item)"
            @toggle-active="toggleActive(item)"
            @prompt-delete="promptDelete(item)"
            @cancel-delete="cancelDelete"
            @confirm-delete="confirmDelete(item.id)"
          />
        </div>
      </section>

      <!-- Bills & Subscriptions group -->
      <section v-if="billItems.length" class="bills-page__group" aria-label="Bills and subscriptions">
        <p class="section-label">Bills &amp; Subscriptions</p>
        <div class="card bills-page__list">
          <RecurringRow
            v-for="(item, idx) in billItems"
            :key="item.id"
            :item="item"
            :is-last="idx === billItems.length - 1"
            :delete-confirm-id="deleteConfirmId"
            :pausing-id="pausingId"
            :deleting-id="deletingId"
            :account-name="accountName(item.funding_account_id)"
            :is-card-funded="isCardFunded(item)"
            @edit="openEdit(item)"
            @toggle-active="toggleActive(item)"
            @prompt-delete="promptDelete(item)"
            @cancel-delete="cancelDelete"
            @confirm-delete="confirmDelete(item.id)"
          />
        </div>
      </section>

      <!-- Debt payments group -->
      <section v-if="debtItems.length" class="bills-page__group" aria-label="Debt payments">
        <p class="section-label">Debt Payments</p>
        <div class="card bills-page__list">
          <RecurringRow
            v-for="(item, idx) in debtItems"
            :key="item.id"
            :item="item"
            :is-last="idx === debtItems.length - 1"
            :delete-confirm-id="deleteConfirmId"
            :pausing-id="pausingId"
            :deleting-id="deletingId"
            :account-name="accountName(item.funding_account_id)"
            :is-card-funded="isCardFunded(item)"
            @edit="openEdit(item)"
            @toggle-active="toggleActive(item)"
            @prompt-delete="promptDelete(item)"
            @cancel-delete="cancelDelete"
            @confirm-delete="confirmDelete(item.id)"
          />
        </div>
      </section>

      <!-- Empty state -->
      <div
        v-if="!incomeItems.length && !billItems.length && !debtItems.length"
        class="card bills-page__empty"
        role="status"
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="bills-page__empty-icon">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <p class="bills-page__empty-msg">No recurring items yet. Tap <strong>Add</strong> to get started.</p>
      </div>

    </template>

    <!-- ── Add sheet ─────────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="addOpen"
        class="sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Add recurring item"
        @click.self="closeAdd"
        @keydown.esc="closeAdd"
      >
        <div class="sheet">
          <div class="sheet__handle" aria-hidden="true" />
          <div class="sheet__header">
            <h2 class="sheet__title">Add recurring item</h2>
            <button class="sheet__close" type="button" aria-label="Close" @click="closeAdd">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="sheet__body">
            <div class="sheet__field">
              <label class="sheet__label" for="add-name">Name</label>
              <input
                id="add-name"
                ref="addNameRef"
                v-model="addForm.name"
                class="input"
                type="text"
                placeholder="e.g. Netflix"
                autocomplete="off"
                :disabled="addSubmitting"
              />
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="add-direction">Type</label>
              <select id="add-direction" v-model="addForm.direction" class="input" :disabled="addSubmitting">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="add-amount">Amount (RM)</label>
              <input
                id="add-amount"
                v-model="addForm.amount_rm"
                class="input"
                type="number"
                inputmode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                autocomplete="off"
                :disabled="addSubmitting"
              />
              <label class="sheet__checkbox-row">
                <input v-model="addForm.is_variable" type="checkbox" :disabled="addSubmitting" />
                <span class="sheet__checkbox-label">Variable amount (~)</span>
              </label>
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="add-cadence">Cadence</label>
              <select id="add-cadence" v-model="addForm.cadence" class="input" :disabled="addSubmitting">
                <option v-for="c in VALID_CADENCES" :key="c" :value="c">{{ cadenceLabel(c) }}</option>
              </select>
            </div>

            <div v-if="addForm.cadence === 'monthly' || addForm.cadence === 'yearly'" class="sheet__field">
              <label class="sheet__label" for="add-dom">Day of month (1–31)</label>
              <input
                id="add-dom"
                v-model.number="addForm.day_of_month"
                class="input"
                type="number"
                inputmode="numeric"
                min="1"
                max="31"
                placeholder="e.g. 15"
                :disabled="addSubmitting"
              />
            </div>

            <div v-if="addForm.cadence === 'weekly' || addForm.cadence === 'biweekly'" class="sheet__field">
              <label class="sheet__label" for="add-weekday">Weekday</label>
              <select id="add-weekday" v-model.number="addForm.weekday" class="input" :disabled="addSubmitting">
                <option value="">— select —</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="add-category">Category</label>
              <select id="add-category" v-model="addForm.category" class="input" :disabled="addSubmitting">
                <option v-for="cat in VALID_CATEGORIES" :key="cat" :value="cat">{{ cat.charAt(0).toUpperCase() + cat.slice(1) }}</option>
              </select>
            </div>

            <div v-if="accounts && (accounts as Account[]).length" class="sheet__field">
              <label class="sheet__label" for="add-account">Funding account</label>
              <select id="add-account" v-model="addForm.funding_account_id" class="input" :disabled="addSubmitting">
                <option value="">— none —</option>
                <option v-for="a in (Array.isArray(accounts) ? accounts as Account[] : [])" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>

            <!-- Auto-deduct vs Reminder-only (expense items only) -->
            <fieldset v-if="addForm.direction === 'expense'" class="sheet__field mode-field" data-test="add-mode">
              <legend class="sheet__label">How should this be handled?</legend>
              <label class="mode-option" :class="{ 'mode-option--active': addForm.mode === 'auto' }">
                <input v-model="addForm.mode" type="radio" value="auto" name="add-mode" :disabled="addSubmitting" />
                <span class="mode-option__body">
                  <span class="mode-option__title">Auto-deduct <span class="badge badge--blue mode-option__badge">Auto</span></span>
                  <span class="mode-option__desc">Logs the transaction for you on the due date.</span>
                </span>
              </label>
              <label class="mode-option" :class="{ 'mode-option--active': addForm.mode === 'reminder' }">
                <input v-model="addForm.mode" type="radio" value="reminder" name="add-mode" :disabled="addSubmitting" />
                <span class="mode-option__body">
                  <span class="mode-option__title">Reminder only <span class="badge badge--amber mode-option__badge">Reminder</span></span>
                  <span class="mode-option__desc">Shows it coming &amp; reminds you — you log the payment yourself. Still counts in Safe-to-Spend.</span>
                </span>
              </label>
            </fieldset>

            <div class="sheet__field">
              <label class="sheet__label" for="add-start">Start date</label>
              <input
                id="add-start"
                v-model="addForm.start_date"
                class="input"
                type="date"
                :disabled="addSubmitting"
              />
            </div>

            <p v-if="addError" class="sheet__error" role="alert">{{ addError }}</p>

            <button
              class="btn-primary sheet__confirm"
              type="button"
              :disabled="addSubmitting"
              @click="submitAdd"
            >
              {{ addSubmitting ? 'Adding…' : 'Add recurring item' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Edit sheet ────────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="editOpen"
        class="sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Edit recurring item"
        @click.self="closeEdit"
        @keydown.esc="closeEdit"
      >
        <div class="sheet">
          <div class="sheet__handle" aria-hidden="true" />
          <div class="sheet__header">
            <h2 class="sheet__title">Edit</h2>
            <button class="sheet__close" type="button" aria-label="Close" @click="closeEdit">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="sheet__body">
            <div class="sheet__field">
              <label class="sheet__label" for="edit-name">Name</label>
              <input
                id="edit-name"
                ref="editInputRef"
                v-model="editForm.name"
                class="input"
                type="text"
                autocomplete="off"
                :disabled="editSubmitting"
              />
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="edit-amount">Amount (RM)</label>
              <input
                id="edit-amount"
                v-model="editForm.amount_rm"
                class="input"
                type="number"
                inputmode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                :disabled="editSubmitting"
              />
              <label class="sheet__checkbox-row">
                <input v-model="editForm.is_variable" type="checkbox" :disabled="editSubmitting" />
                <span class="sheet__checkbox-label">Variable amount (~)</span>
              </label>
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="edit-cadence">Cadence</label>
              <select id="edit-cadence" v-model="editForm.cadence" class="input" :disabled="editSubmitting">
                <option v-for="c in VALID_CADENCES" :key="c" :value="c">{{ cadenceLabel(c) }}</option>
              </select>
            </div>

            <div v-if="editForm.cadence === 'monthly' || editForm.cadence === 'yearly'" class="sheet__field">
              <label class="sheet__label" for="edit-dom">Day of month (1–31)</label>
              <input
                id="edit-dom"
                v-model.number="editForm.day_of_month"
                class="input"
                type="number"
                inputmode="numeric"
                min="1"
                max="31"
                placeholder="e.g. 15"
                :disabled="editSubmitting"
              />
            </div>

            <div v-if="editForm.cadence === 'weekly' || editForm.cadence === 'biweekly'" class="sheet__field">
              <label class="sheet__label" for="edit-weekday">Weekday</label>
              <select id="edit-weekday" v-model.number="editForm.weekday" class="input" :disabled="editSubmitting">
                <option value="">— select —</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
            </div>

            <div class="sheet__field">
              <label class="sheet__label" for="edit-category">Category</label>
              <select id="edit-category" v-model="editForm.category" class="input" :disabled="editSubmitting">
                <option v-for="cat in VALID_CATEGORIES" :key="cat" :value="cat">{{ cat.charAt(0).toUpperCase() + cat.slice(1) }}</option>
              </select>
            </div>

            <div v-if="accounts && (accounts as Account[]).length" class="sheet__field">
              <label class="sheet__label" for="edit-account">Funding account</label>
              <select id="edit-account" v-model="editForm.funding_account_id" class="input" :disabled="editSubmitting">
                <option value="">— none —</option>
                <option v-for="a in (Array.isArray(accounts) ? accounts as Account[] : [])" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>

            <!-- Auto-deduct vs Reminder-only (expense items only) -->
            <fieldset v-if="editForm.direction === 'expense'" class="sheet__field mode-field" data-test="edit-mode">
              <legend class="sheet__label">How should this be handled?</legend>
              <label class="mode-option" :class="{ 'mode-option--active': editForm.mode === 'auto' }">
                <input v-model="editForm.mode" type="radio" value="auto" name="edit-mode" :disabled="editSubmitting" />
                <span class="mode-option__body">
                  <span class="mode-option__title">Auto-deduct <span class="badge badge--blue mode-option__badge">Auto</span></span>
                  <span class="mode-option__desc">Logs the transaction for you on the due date.</span>
                </span>
              </label>
              <label class="mode-option" :class="{ 'mode-option--active': editForm.mode === 'reminder' }">
                <input v-model="editForm.mode" type="radio" value="reminder" name="edit-mode" :disabled="editSubmitting" />
                <span class="mode-option__body">
                  <span class="mode-option__title">Reminder only <span class="badge badge--amber mode-option__badge">Reminder</span></span>
                  <span class="mode-option__desc">Shows it coming &amp; reminds you — you log the payment yourself. Still counts in Safe-to-Spend.</span>
                </span>
              </label>
            </fieldset>

            <p v-if="editError" class="sheet__error" role="alert">{{ editError }}</p>

            <button
              class="btn-primary sheet__confirm"
              type="button"
              :disabled="editSubmitting"
              @click="submitEdit"
            >
              {{ editSubmitting ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ── Flip-off-card confirmation sheet ──────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="flipOpen"
        class="sheet-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Move recurring payments off credit card"
        @click.self="closeFlip"
        @keydown.esc="closeFlip"
      >
        <div class="sheet">
          <div class="sheet__handle" aria-hidden="true" />
          <div class="sheet__header">
            <h2 class="sheet__title">Move off credit card</h2>
            <button class="sheet__close" type="button" aria-label="Close" @click="closeFlip">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="sheet__body">
            <template v-if="!flipResult">
              <p class="sheet__hint">
                All active card-funded recurring items will be switched to your bank account.
                Insurance/ILP templates will be <strong>paused</strong> instead (they can't be auto-debited from bank).
              </p>
              <p v-if="flipError" class="sheet__error" role="alert">{{ flipError }}</p>
              <button
                class="btn-primary sheet__confirm bills-page__flip-confirm"
                type="button"
                :disabled="flipSubmitting"
                data-test="flip-confirm-btn"
                @click="submitFlip"
              >
                {{ flipSubmitting ? 'Flipping…' : 'Yes, move them off card' }}
              </button>
              <button
                class="bills-page__cancel-btn"
                type="button"
                :disabled="flipSubmitting"
                @click="closeFlip"
              >
                Cancel
              </button>
            </template>
            <template v-else>
              <p class="bills-page__flip-result" role="status" aria-live="polite">
                Done — <strong>{{ flipResult.flipped }}</strong> item(s) moved to bank,
                <strong>{{ flipResult.paused }}</strong> item(s) paused (ILP / insurance).
              </p>
              <button class="btn-primary sheet__confirm" type="button" @click="closeFlip">Close</button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
/* ─── Page ───────────────────────────────────────────────────────────────────── */
.bills-page {
  max-width: 480px;
  margin: 0 auto;
  padding: 16px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.bills-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bills-page__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.bills-page__add-btn {
  height: 40px;
  padding: 0 16px;
  font-size: 15px;
  gap: 6px;
}

/* ─── Error / empty / skeleton ───────────────────────────────────────────────── */
.bills-page__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 32px 20px;
}

.bills-page__error-icon { color: var(--negative); }

.bills-page__error-msg {
  margin: 0;
  font-size: 15px;
  color: var(--text-muted);
}

.bills-page__retry-btn {
  min-height: 44px;
  padding: 0 24px;
}

.bills-page__skeleton {
  height: 200px;
  border-radius: var(--radius-card);
  background: var(--surface-2);
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

.bills-page__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 40px 24px;
}

.bills-page__empty-icon { color: var(--text-muted); }

.bills-page__empty-msg {
  margin: 0;
  font-size: 15px;
  color: var(--text-muted);
  line-height: 1.55;
}

/* ─── Groups ──────────────────────────────────────────────────────────────────── */
.bills-page__group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bills-page__list {
  padding: 0;
  overflow: hidden;
}

/* ─── Flip banner ────────────────────────────────────────────────────────────── */
.bills-page__flip-banner {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-left: 4px solid var(--negative);
}

.bills-page__flip-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.bills-page__flip-icon { color: var(--negative); flex-shrink: 0; margin-top: 2px; }

.bills-page__flip-body { display: flex; flex-direction: column; gap: 2px; }

.bills-page__flip-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.bills-page__flip-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.bills-page__flip-btn {
  width: 100%;
  min-height: 44px;
  background: var(--negative);
}
.bills-page__flip-btn:hover:not(:disabled) { background: #b91c1c; }

.bills-page__flip-confirm { background: var(--negative); }
.bills-page__flip-confirm:hover:not(:disabled) { background: #b91c1c; }

.bills-page__flip-result {
  font-size: 15px;
  color: var(--text);
  margin: 0 0 16px;
  line-height: 1.55;
}

.bills-page__cancel-btn {
  width: 100%;
  min-height: 44px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-base);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius-btn);
  transition: color 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}
.bills-page__cancel-btn:hover { color: var(--text); }
.bills-page__cancel-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

/* ─── Bottom sheet ────────────────────────────────────────────────────────────── */
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
  padding-bottom: max(32px, env(safe-area-inset-bottom));
  animation: sheet-in 220ms ease-out;
  max-height: 90dvh;
  overflow-y: auto;
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
  flex-shrink: 0;
}
.sheet__close:hover { background: var(--border); }
.sheet__close:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }

.sheet__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sheet__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sheet__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.sheet__hint {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.55;
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

.sheet__checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  margin-top: 4px;
}

.sheet__checkbox-label {
  font-size: 13px;
  color: var(--text-muted);
}

/* ─── Mode toggle (auto-deduct vs reminder-only) ─────────────────────────────── */
.mode-field {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition: border-color 150ms ease-out, background 150ms ease-out;
  -webkit-tap-highlight-color: transparent;
}

.mode-option--active {
  border-color: var(--primary);
  background: var(--surface-2);
}

.mode-option input[type='radio'] {
  margin-top: 2px;
  flex-shrink: 0;
}

.mode-option__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mode-option__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.mode-option__badge { font-size: 11px; padding: 1px 6px; }

.mode-option__desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

/* ─── Upcoming charges ──────────────────────────────────────────────────────── */
.bills-page__upcoming {
  padding: 0;
  overflow: hidden;
}

.upcoming-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.upcoming-row:last-child { border-bottom: none; }

.upcoming-row__left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.upcoming-row__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upcoming-row__date {
  font-size: 12px;
  color: var(--text-muted);
}

.upcoming-row__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.upcoming-row__amount {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.upcoming-row__badge { font-size: 11px; padding: 2px 7px; }

/* RecurringRow styles live in app/components/RecurringRow.vue (scoped) */
</style>
