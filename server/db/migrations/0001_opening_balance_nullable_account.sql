-- Make transactions.account_id nullable so that debt-only opening-balance ledger rows
-- (rows that set an initial debt balance with no matching cash-account movement) can be
-- stored without a phantom account_id.  SQLite does not support ALTER COLUMN, so we
-- recreate the table.
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `transactions_new` (
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
INSERT INTO `transactions_new` SELECT * FROM `transactions`;
--> statement-breakpoint
DROP TABLE `transactions`;
--> statement-breakpoint
ALTER TABLE `transactions_new` RENAME TO `transactions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_uuid_unique` ON `transactions` (`uuid`);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_recurring_item_id_date_unique` ON `transactions` (`recurring_item_id`,`date`);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
