CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`credit_limit_cents` integer,
	`available_credit_cents` integer,
	`debt_id` integer,
	`currency` text DEFAULT 'MYR' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `debts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`original_principal_cents` integer,
	`payoff_baseline_cents` integer,
	`rate_type` text NOT NULL,
	`apr_bps` integer,
	`flat_rate_bps` integer,
	`min_payment_cents` integer,
	`scheduled_payment_cents` integer,
	`due_day` integer,
	`statement_day` integer,
	`payments_made` integer DEFAULT 0 NOT NULL,
	`payments_total` integer,
	`remaining_installments_json` text,
	`priority_rank` integer,
	`never_prepay` integer DEFAULT false NOT NULL,
	`bt_status` text DEFAULT 'none' NOT NULL,
	`bt_promo_end_date` text,
	`linked_account_id` integer,
	`is_closed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`target_amount_cents` integer NOT NULL,
	`account_id` integer,
	`debt_id` integer,
	`target_date` text,
	`monthly_contribution_cents` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications_sent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer,
	`scheduled_for` text NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_sent_kind_ref_id_scheduled_for_unique` ON `notifications_sent` (`kind`,`ref_id`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_ok_at` integer,
	`failed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `recurring_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`direction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`is_variable` integer DEFAULT false NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`day_of_month` integer,
	`weekday` integer,
	`category` text NOT NULL,
	`funding_account_id` integer,
	`debt_id` integer,
	`auto_post` integer DEFAULT true NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`remaining_occurrences` integer,
	`last_posted_date` text,
	`next_due_date` text,
	`remaining_installments_json` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`funding_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`session_epoch` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`account_id` integer NOT NULL,
	`counter_account_id` integer,
	`debt_id` integer,
	`goal_id` integer,
	`note` text,
	`is_estimate` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`recurring_item_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurring_item_id`) REFERENCES `recurring_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_uuid_unique` ON `transactions` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_recurring_item_id_date_unique` ON `transactions` (`recurring_item_id`,`date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`session_epoch` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);