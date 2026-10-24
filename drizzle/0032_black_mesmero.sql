CREATE TABLE `set_decisions` (
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`decision` text NOT NULL,
	`word_id` integer,
	`decided_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `set_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `set_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`set_id` integer NOT NULL,
	`term` text NOT NULL,
	`translation` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`example` text DEFAULT '' NOT NULL,
	`transcription_uk` text DEFAULT '' NOT NULL,
	`transcription_us` text DEFAULT '' NOT NULL,
	`usefulness` integer,
	`usefulness_note` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `word_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `set_items_set_idx` ON `set_items` (`set_id`);--> statement-breakpoint
CREATE TABLE `word_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_sets_slug_unique` ON `word_sets` (`slug`);