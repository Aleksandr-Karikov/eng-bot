CREATE TABLE `trophies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`week` text NOT NULL,
	`room_id` integer,
	`room_name` text DEFAULT '' NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trophies_user_idx` ON `trophies` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trophies_user_kind_week_idx` ON `trophies` (`user_id`,`kind`,`week`);