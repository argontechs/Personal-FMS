// server/db/schema.ts
import { sqliteTable, integer, text, unique } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['cash', 'bank', 'card', 'ewallet', 'savings'] }).notNull(),
  balance_cents: integer('balance_cents').notNull().default(0),
  credit_limit_cents: integer('credit_limit_cents'),
  // DERIVED at read time (limit − card balance); never seeded. Nullable column kept for cache use only.
  available_credit_cents: integer('available_credit_cents'),
  debt_id: integer('debt_id'),
  currency: text('currency').notNull().default('MYR'),
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const debts = sqliteTable('debts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['revolving', 'installment', 'flat_loan', 'reducing_loan'] }).notNull(),
  balance_cents: integer('balance_cents').notNull(),
  original_principal_cents: integer('original_principal_cents'),
  payoff_baseline_cents: integer('payoff_baseline_cents'), // frozen at goal creation (§14.3)
  rate_type: text('rate_type', { enum: ['apr', 'flat', 'none'] }).notNull(),
  apr_bps: integer('apr_bps'),
  flat_rate_bps: integer('flat_rate_bps'),
  min_payment_cents: integer('min_payment_cents'),
  scheduled_payment_cents: integer('scheduled_payment_cents'),
  due_day: integer('due_day'),
  statement_day: integer('statement_day'),
  payments_made: integer('payments_made').notNull().default(0),
  payments_total: integer('payments_total'),
  remaining_installments_json: text('remaining_installments_json'), // SPayLater installment array (§B2)
  priority_rank: integer('priority_rank'),
  never_prepay: integer('never_prepay', { mode: 'boolean' }).notNull().default(false),
  bt_status: text('bt_status', { enum: ['none', 'applied', 'active', 'declined'] }).notNull().default('none'),
  bt_promo_end_date: text('bt_promo_end_date'),
  linked_account_id: integer('linked_account_id'),
  is_closed: integer('is_closed', { mode: 'boolean' }).notNull().default(false),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const recurringItems = sqliteTable('recurring_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  direction: text('direction', { enum: ['income', 'expense'] }).notNull(),
  amount_cents: integer('amount_cents').notNull(),
  is_variable: integer('is_variable', { mode: 'boolean' }).notNull().default(false),
  cadence: text('cadence', { enum: ['monthly', 'weekly', 'biweekly', 'yearly'] }).notNull().default('monthly'),
  day_of_month: integer('day_of_month'),
  weekday: integer('weekday'),
  category: text('category').notNull(),
  funding_account_id: integer('funding_account_id').references(() => accounts.id),
  debt_id: integer('debt_id').references(() => debts.id),
  auto_post: integer('auto_post', { mode: 'boolean' }).notNull().default(true),
  start_date: text('start_date').notNull(),
  end_date: text('end_date'),
  remaining_occurrences: integer('remaining_occurrences'),
  last_posted_date: text('last_posted_date'),
  next_due_date: text('next_due_date'), // single "when due" field (§14.11)
  remaining_installments_json: text('remaining_installments_json'), // SPayLater installment array (§B2 — also on recurringItems)
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const goals = sqliteTable('goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['savings', 'debt_payoff'] }).notNull(),
  target_amount_cents: integer('target_amount_cents').notNull(),
  account_id: integer('account_id').references(() => accounts.id),
  debt_id: integer('debt_id').references(() => debts.id),
  target_date: text('target_date'),
  monthly_contribution_cents: integer('monthly_contribution_cents'),
  status: text('status', { enum: ['active', 'achieved', 'paused'] }).notNull().default('active'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uuid: text('uuid').notNull().unique(), // client-generated offline idempotency key
  date: text('date').notNull(),
  amount_cents: integer('amount_cents').notNull(),
  direction: text('direction', { enum: ['income', 'expense', 'transfer'] }).notNull(),
  category: text('category', {
    enum: ['food', 'transport', 'fuel', 'groceries', 'shopping', 'bills', 'debt', 'income', 'savings', 'interest', 'adjustment', 'other'],
  }).notNull(),
  // Nullable: debt-only opening-balance rows omit the account leg (account_id = null).
  account_id: integer('account_id').references(() => accounts.id),
  counter_account_id: integer('counter_account_id').references(() => accounts.id),
  debt_id: integer('debt_id').references(() => debts.id),
  goal_id: integer('goal_id').references(() => goals.id),
  note: text('note'),
  is_estimate: integer('is_estimate', { mode: 'boolean' }).notNull().default(false), // §14.17 estimated bills
  source: text('source', { enum: ['auto', 'manual', 'adjustment'] }).notNull(),
  recurring_item_id: integer('recurring_item_id').references(() => recurringItems.id),
  created_at: integer('created_at').notNull(),
}, (t) => ({
  uniqRecurring: unique().on(t.recurring_item_id, t.date),
}))

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  user_agent: text('user_agent'),
  created_at: integer('created_at').notNull(),
  last_ok_at: integer('last_ok_at'),
  failed_at: integer('failed_at'),
})

export const notificationsSent = sqliteTable('notifications_sent', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['bill_due', 'payday_save', 'weekly_checkin', 'milestone'] }).notNull(),
  ref_id: integer('ref_id'),
  scheduled_for: text('scheduled_for').notNull(),
  sent_at: integer('sent_at'),
}, (t) => ({
  uniqFire: unique().on(t.kind, t.ref_id, t.scheduled_for),
}))

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(), // argon2id
  session_epoch: integer('session_epoch').notNull().default(0), // bulk-invalidation counter
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // opaque random id (the authority; cookie only carries it)
  user_id: integer('user_id').notNull().references(() => users.id),
  session_epoch: integer('session_epoch').notNull(), // snapshot; mismatch with users.session_epoch revokes
  created_at: integer('created_at').notNull(),
  expires_at: integer('expires_at').notNull(), // 30-day rolling, UTC epoch ms
  last_seen_at: integer('last_seen_at').notNull(),
})

export const budgets = sqliteTable('budgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category', {
    enum: ['food', 'transport', 'fuel', 'groceries', 'shopping', 'bills', 'other'],
  }).notNull().unique(),
  limit_cents: integer('limit_cents').notNull(),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})

export const holdings = sqliteTable('holdings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  institution: text('institution').notNull(),
  kind: text('kind', { enum: ['investment', 'insurance', 'savings'] }).notNull(),
  current_value_cents: integer('current_value_cents').notNull(),
  liquid: integer('liquid').notNull().default(0), // boolean 0/1
  note: text('note'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
})
