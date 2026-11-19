CREATE TABLE `combat_archive` (
	`review_id` integer PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`damage_deci` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `combat_archive_user_idx` ON `combat_archive` (`user_id`);--> statement-breakpoint
CREATE TABLE `combat_spends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`room_id` integer,
	`target` text NOT NULL,
	`mob_week` text,
	`request_id` text NOT NULL,
	`damage_deci` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `combat_spends_mob_week_idx` ON `combat_spends` (`user_id`,`target`,`mob_week`);--> statement-breakpoint
CREATE UNIQUE INDEX `combat_spends_request_idx` ON `combat_spends` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `combat_spends_room_at_idx` ON `combat_spends` (`room_id`,`at`);--> statement-breakpoint
ALTER TABLE `review_logs` ADD `banked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `bank_damage` integer DEFAULT false NOT NULL;