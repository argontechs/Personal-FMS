CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`limit_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_category_unique` ON `budgets` (`category`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`account_id` integer,
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
INSERT INTO `__new_transactions`("id", "uuid", "date", "amount_cents", "direction", "category", "account_id", "counter_account_id", "debt_id", "goal_id", "note", "is_estimate", "source", "recurring_item_id", "created_at") SELECT "id", "uuid", "date", "amount_cents", "direction", "category", "account_id", "counter_account_id", "debt_id", "goal_id", "note", "is_estimate", "source", "recurring_item_id", "created_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_uuid_unique` ON `transactions` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_recurring_item_id_date_unique` ON `transactions` (`recurring_item_id`,`date`);