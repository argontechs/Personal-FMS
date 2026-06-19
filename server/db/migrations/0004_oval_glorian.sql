CREATE TABLE `money_move_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`move_key` text NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `money_move_state_move_key_unique` ON `money_move_state` (`move_key`);