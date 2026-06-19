CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`net_worth_cents` integer NOT NULL,
	`total_debt_cents` integer NOT NULL,
	`card_balance_cents` integer NOT NULL,
	`ef_balance_cents` integer NOT NULL,
	`liquid_cents` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_date_unique` ON `snapshots` (`date`);